import { CrdScannerGetAvailableResources } from "../crds/CrdScanner";

// RFC 1123 labels/subdomains: lowercase alphanumerics, '-' and '.', must
// start and end with an alphanumeric character.
const RESOURCE_TYPE_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const OBJECT_NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const NAMESPACE_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME_LENGTH = 253;

// Kubernetes label syntax: the key prefix is a DNS subdomain, the key name is
// an RFC 1035 label segment, and values allow upper case, '.', '-' and '_'.
const LABEL_KEY_NAME_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const LABEL_VALUE_REGEX = /^([A-Za-z0-9]([A-Za-z0-9._-]{0,61}[A-Za-z0-9])?)?$/;
const MAX_LABEL_KEY_LENGTH = 253 + 1 + 63;
const MAX_LABEL_SELECTOR_LENGTH = 512;
const MAX_LABEL_SELECTOR_TERMS = 16;
const MAX_LABEL_SELECTOR_VALUES = 10;

function HasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export type ValidationErrorField =
  | "command"
  | "object"
  | "namespace"
  | "argument"
  | "pod"
  | "container"
  | "selector"
  | "payload";

export type ArgumentBuildResult =
  | { ok: true; argv: string[] }
  | { ok: false; error: string; field: ValidationErrorField };

// Rejected values are embedded via JSON.stringify so control characters and
// newlines from a hostile payload cannot forge extra lines in the message.
function rejected(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

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
  selector?: string;
  noJson?: boolean;
}

export type LabelSelectorResult =
  | { ok: true; selector: string }
  | { ok: false; error: string };

function IsValidLabelKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_LABEL_KEY_LENGTH) {
    return false;
  }
  const parts = key.split("/");
  if (parts.length === 1) {
    return LABEL_KEY_NAME_REGEX.test(parts[0]);
  }
  if (parts.length !== 2) {
    return false;
  }
  const [prefix, name] = parts;
  return (
    prefix.length > 0 &&
    prefix.length <= MAX_NAME_LENGTH &&
    OBJECT_NAME_REGEX.test(prefix) &&
    LABEL_KEY_NAME_REGEX.test(name)
  );
}

function IsValidLabelValue(value: string): boolean {
  return value.length <= 63 && LABEL_VALUE_REGEX.test(value);
}

function SplitSelectorTerms(selector: string): string[] | null {
  const terms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const character = selector[i];
    if (character === "(") {
      depth++;
      if (depth > 1) {
        return null;
      }
    } else if (character === ")") {
      depth--;
      if (depth < 0) {
        return null;
      }
    } else if (character === "," && depth === 0) {
      terms.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) {
    return null;
  }
  terms.push(selector.slice(start));
  return terms;
}

/**
 * Parse and canonicalize a Kubernetes label selector for `kubectl get -l`.
 * Only comma-separated equality (`key=value`, `key==value`) and set-based
 * (`key in (v1,v2)`) terms are accepted; every key and value is validated
 * against the Kubernetes label syntax and length caps. The selector is always
 * re-serialized from the validated parts, so the raw request string never
 * reaches the argument vector.
 */
export function NormalizeLabelSelector(selector: unknown): LabelSelectorResult {
  if (typeof selector !== "string" || selector.trim() === "") {
    return { ok: false, error: "label selector is required" };
  }
  if (selector.length > MAX_LABEL_SELECTOR_LENGTH) {
    return {
      ok: false,
      error: `label selector exceeds ${MAX_LABEL_SELECTOR_LENGTH} characters`,
    };
  }
  if (HasControlCharacters(selector)) {
    return { ok: false, error: "label selector contains control characters" };
  }
  const rawTerms = SplitSelectorTerms(selector);
  if (!rawTerms) {
    return { ok: false, error: "malformed label selector" };
  }
  if (rawTerms.length > MAX_LABEL_SELECTOR_TERMS) {
    return {
      ok: false,
      error: `label selector exceeds ${MAX_LABEL_SELECTOR_TERMS} terms`,
    };
  }

  const canonicalTerms: string[] = [];
  const seenKeys = new Set<string>();
  for (const rawTerm of rawTerms) {
    const term = rawTerm.trim();
    if (term === "") {
      return { ok: false, error: "empty label selector term" };
    }

    let key: string;
    let canonical: string;
    const setMatch = /^([^\s()=!,]+) in \(([^()]*)\)$/.exec(term);
    if (setMatch) {
      key = setMatch[1];
      if (setMatch[2] === "") {
        return { ok: false, error: "empty label selector set term" };
      }
      const rawValues = setMatch[2].split(",");
      if (rawValues.length > MAX_LABEL_SELECTOR_VALUES) {
        return {
          ok: false,
          error: `label selector set term exceeds ${MAX_LABEL_SELECTOR_VALUES} values`,
        };
      }
      for (const value of rawValues) {
        if (value === "" || !IsValidLabelValue(value)) {
          return {
            ok: false,
            error: `invalid label value ${rejected(value)}`,
          };
        }
      }
      canonical = `${key} in (${rawValues.join(",")})`;
    } else {
      const doubleEquals = term.indexOf("==");
      const equals = term.indexOf("=");
      if (equals < 0) {
        return {
          ok: false,
          error: `unsupported label selector term ${rejected(term)}, allowed: key=value, key==value, key in (v1,v2)`,
        };
      }
      const separatorIndex = doubleEquals >= 0 ? doubleEquals : equals;
      key = term.slice(0, separatorIndex);
      const value = term.slice(
        separatorIndex + (doubleEquals >= 0 ? 2 : 1),
      );
      if (!IsValidLabelValue(value)) {
        return {
          ok: false,
          error: `invalid label value ${rejected(value)}`,
        };
      }
      canonical = `${key}=${value}`;
    }

    if (!IsValidLabelKey(key)) {
      return { ok: false, error: `invalid label key ${rejected(key)}` };
    }
    if (seenKeys.has(key)) {
      return { ok: false, error: `duplicate label key ${rejected(key)}` };
    }
    seenKeys.add(key);
    canonicalTerms.push(canonical);
  }
  return { ok: true, selector: canonicalTerms.join(",") };
}

/**
 * Rebuild a validated kubectl argument vector for POST /api/kubectl/command.
 * The raw request strings are never passed through: every accepted payload is
 * re-serialized into a fixed argument shape for the allowed commands.
 */
export function BuildCommandArgs(payload: CommandPayload): ArgumentBuildResult {
  if (!payload || typeof payload.command !== "string") {
    return { ok: false, error: "missing or invalid command", field: "command" };
  }
  if (!IsAllowedResourceType(payload.object)) {
    return {
      ok: false,
      error: `unknown resource type ${rejected(payload.object)}`,
      field: "object",
    };
  }
  if (payload.selector !== undefined && payload.command !== "get") {
    return {
      ok: false,
      error: "selector is only supported for command get",
      field: "selector",
    };
  }

  const namespace = payload.namespace;
  if (
    namespace !== undefined &&
    namespace !== null &&
    namespace !== "" &&
    !IsValidNamespace(namespace)
  ) {
    return {
      ok: false,
      error: `invalid namespace ${rejected(namespace)}`,
      field: "namespace",
    };
  }
  const namespaceArg = namespace ? ["-n", namespace] : [];
  const argument = payload.argument ?? "";

  switch (payload.command) {
    case "get": {
      if (payload.selector !== undefined) {
        if (payload.object !== "pod") {
          return {
            ok: false,
            error: "selector is only supported for object pod",
            field: "selector",
          };
        }
        if (argument !== "") {
          return {
            ok: false,
            error: "argument cannot be combined with selector",
            field: "argument",
          };
        }
        if (!payload.namespace) {
          return {
            ok: false,
            error: "namespace is required with a label selector",
            field: "namespace",
          };
        }
        const normalized = NormalizeLabelSelector(payload.selector);
        if (normalized.ok === false) {
          return {
            ok: false,
            error: normalized.error,
            field: "selector",
          };
        }
        const argv = [
          "get",
          "pod",
          "-n",
          payload.namespace,
          "-l",
          normalized.selector,
        ];
        if (payload.noJson !== true) {
          argv.push("-o", "json");
        }
        return { ok: true, argv };
      }
      const argv = ["get", payload.object];
      if (argument === "-A" || argument === "--all-namespaces") {
        argv.push("-A");
      } else if (argument !== "") {
        if (!IsValidObjectName(argument)) {
          return {
            ok: false,
            error: `invalid object name ${rejected(argument)}`,
            field: "argument",
          };
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
        return {
          ok: false,
          error: `invalid object name ${rejected(argument)}`,
          field: "argument",
        };
      }
      return { ok: true, argv: ["describe", payload.object, argument, ...namespaceArg] };
    }

    case "delete": {
      if (!IsValidObjectName(argument)) {
        return {
          ok: false,
          error: `invalid object name ${rejected(argument)}`,
          field: "argument",
        };
      }
      return { ok: true, argv: ["delete", payload.object, argument, ...namespaceArg] };
    }

    case "rollout restart": {
      if (!IsValidObjectName(argument)) {
        return {
          ok: false,
          error: `invalid object name ${rejected(argument)}`,
          field: "argument",
        };
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
        return {
          ok: false,
          error: `invalid scale argument ${rejected(argument)}, expected <name> --replicas=<n>`,
          field: "argument",
        };
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
        return {
          ok: false,
          error: "command create is only supported for object job",
          field: "object",
        };
      }
      const match =
        /^--from=cronjob\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?) ([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.exec(
          argument,
        );
      if (!match) {
        return {
          ok: false,
          error: `invalid create argument ${rejected(argument)}, expected --from=cronjob/<cronjob> <jobname>`,
          field: "argument",
        };
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
      return {
        ok: false,
        error: `unsupported command ${rejected(payload.command)}`,
        field: "command",
      };
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
// Pod logs are capped server-side so a follow/auto-refresh poll never
// re-sends an unbounded payload (a pod can have gigabytes of history).
const LOG_TAIL_LINES = 5000;

/**
 * Rebuild a validated kubectl argument vector for POST /api/kubectl/logs.
 * The optional argument string only accepts the exact option tokens the logs
 * dialog produces (`--since=10m|1h|24h`, `--previous`).
 */
export function BuildLogsArgs(payload: LogsPayload): ArgumentBuildResult {
  if (!payload) {
    return { ok: false, error: "missing request payload", field: "payload" };
  }
  const { namespace, pod, container, argument, timestamps } = payload;
  if (!IsValidNamespace(namespace)) {
    return {
      ok: false,
      error: `invalid namespace ${rejected(namespace)}`,
      field: "namespace",
    };
  }
  if (!IsValidObjectName(pod)) {
    return {
      ok: false,
      error: `invalid pod name ${rejected(pod)}`,
      field: "pod",
    };
  }
  if (container !== undefined && container !== null && container !== "") {
    if (!IsValidObjectName(container)) {
      return {
        ok: false,
        error: `invalid container name ${rejected(container)}`,
        field: "container",
      };
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
      return {
        ok: false,
        error: `unsupported logs option ${rejected(token)}, allowed: --previous, --since=10m|1h|24h`,
        field: "argument",
      };
    }
  }
  argv.push(`--tail=${LOG_TAIL_LINES}`);
  if (timestamps !== false) {
    argv.push("--timestamps");
  }
  return { ok: true, argv };
}
