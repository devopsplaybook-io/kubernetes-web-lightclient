import { CrdScannerGetAvailableResources } from "../crds/CrdScanner";

// RFC 1123 labels/subdomains: lowercase alphanumerics, '-' and '.', must
// start and end with an alphanumeric character.
const RESOURCE_TYPE_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const OBJECT_NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const NAMESPACE_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME_LENGTH = 253;

export type ArgumentBuildResult = { ok: true; argv: string[] } | { ok: false };

/**
 * A resource type is only accepted when it matches an anchored name pattern
 * AND it is a known resource id (built-ins plus scanned CRDs). This prevents
 * any value that is not a plain resource name from reaching kubectl.
 */
export function IsAllowedResourceType(type: string): boolean {
  if (typeof type !== "string" || type.length === 0) {
    return false;
  }
  if (type.length > MAX_NAME_LENGTH || !RESOURCE_TYPE_REGEX.test(type)) {
    return false;
  }
  return CrdScannerGetAvailableResources().some((resource) => resource.id === type);
}

export function IsValidObjectName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    OBJECT_NAME_REGEX.test(name)
  );
}

export function IsValidNamespace(namespace: string): boolean {
  return (
    typeof namespace === "string" &&
    namespace.length > 0 &&
    namespace.length <= 63 &&
    NAMESPACE_REGEX.test(namespace)
  );
}

export interface CommandPayload {
  command: string;
  object: string;
  namespace?: string;
  argument?: string;
  noJson?: boolean;
}

/**
 * Rebuild a validated kubectl argument vector for POST /api/kubectl/command.
 * The raw request strings are never passed through: every accepted payload is
 * re-serialized into a fixed argument shape for the allowed commands.
 */
export function BuildCommandArgs(payload: CommandPayload): ArgumentBuildResult {
  if (!payload || typeof payload.command !== "string") {
    return { ok: false };
  }
  if (!IsAllowedResourceType(payload.object)) {
    return { ok: false };
  }

  const namespace = payload.namespace;
  if (
    namespace !== undefined &&
    namespace !== null &&
    namespace !== "" &&
    !IsValidNamespace(namespace)
  ) {
    return { ok: false };
  }
  const namespaceArg = namespace ? ["-n", namespace] : [];
  const argument = payload.argument ?? "";

  switch (payload.command) {
    case "get": {
      const argv = ["get", payload.object];
      if (argument === "-A" || argument === "--all-namespaces") {
        argv.push("-A");
      } else if (argument !== "") {
        if (!IsValidObjectName(argument)) {
          return { ok: false };
        }
        argv.push(argument);
        argv.push(...namespaceArg);
      } else {
        argv.push(...namespaceArg);
      }
      if (payload.noJson !== true) {
        argv.push("-o", "json");
      }
      return { ok: true, argv };
    }

    case "describe": {
      if (!IsValidObjectName(argument)) {
        return { ok: false };
      }
      return { ok: true, argv: ["describe", payload.object, argument, ...namespaceArg] };
    }

    case "delete": {
      if (!IsValidObjectName(argument)) {
        return { ok: false };
      }
      return { ok: true, argv: ["delete", payload.object, argument, ...namespaceArg] };
    }

    case "rollout restart": {
      if (!IsValidObjectName(argument)) {
        return { ok: false };
      }
      return {
        ok: true,
        argv: ["rollout", "restart", payload.object, argument, ...namespaceArg],
      };
    }

    case "scale": {
      const match = /^([a-z0-9]([a-z0-9.-]*[a-z0-9])?) --replicas=(\d{1,4})$/.exec(
        argument,
      );
      if (!match) {
        return { ok: false };
      }
      return {
        ok: true,
        argv: [
          "scale",
          payload.object,
          match[1],
          `--replicas=${parseInt(match[3], 10)}`,
          ...namespaceArg,
        ],
      };
    }

    case "create": {
      // Only "create job --from=cronjob/<name> <jobName>" is supported.
      if (payload.object !== "job") {
        return { ok: false };
      }
      const match =
        /^--from=cronjob\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?) ([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.exec(
          argument,
        );
      if (!match) {
        return { ok: false };
      }
      return {
        ok: true,
        argv: [
          "create",
          "job",
          match[2],
          `--from=cronjob/${match[1]}`,
          ...namespaceArg,
        ],
      };
    }

    default:
      return { ok: false };
  }
}

export interface LogsPayload {
  namespace: string;
  pod: string;
  container?: string;
  argument?: string;
  timestamps?: boolean;
}

const LOGS_SINCE_REGEX = /^--since=(10m|1h|24h)$/;

/**
 * Rebuild a validated kubectl argument vector for POST /api/kubectl/logs.
 * The optional argument string only accepts the exact option tokens the logs
 * dialog produces (`--since=10m|1h|24h`, `--previous`).
 */
export function BuildLogsArgs(payload: LogsPayload): ArgumentBuildResult {
  if (!payload) {
    return { ok: false };
  }
  const { namespace, pod, container, argument, timestamps } = payload;
  if (!IsValidNamespace(namespace)) {
    return { ok: false };
  }
  if (!IsValidObjectName(pod)) {
    return { ok: false };
  }
  if (container !== undefined && container !== null && container !== "") {
    if (!IsValidObjectName(container)) {
      return { ok: false };
    }
  }

  const argv = ["logs", "-n", namespace, pod];
  if (container) {
    argv.push("-c", container);
  }
  if (argument) {
    const tokens = argument.trim().split(/\s+/).filter((token) => token !== "");
    for (const token of tokens) {
      if (token === "--previous") {
        argv.push("--previous");
        continue;
      }
      if (LOGS_SINCE_REGEX.test(token)) {
        argv.push(token);
        continue;
      }
      return { ok: false };
    }
  }
  if (timestamps !== false) {
    argv.push("--timestamps");
  }
  return { ok: true, argv };
}
