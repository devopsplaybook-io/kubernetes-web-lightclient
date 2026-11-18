/**
 * Turns a `403 Forbidden` response into a user-facing explanation naming the
 * scope (or role) the server requires. Dependency-free on purpose: the same
 * helpers are used by the EventBus wrapper, the Pinia stores and the pages.
 *
 * Server output is never echoed: the message is built from the request URL
 * and body command only.
 */

import type { AppScope } from "~~/services/Scopes";

export type PermissionScope = AppScope | "admin-role" | null;

export interface PermissionDenial {
  scope: PermissionScope;
  title: string;
  message: string;
}

interface ErrorLike {
  response?: { status?: unknown };
  config?: { url?: unknown; data?: unknown };
}

const MESSAGES: Record<AppScope, string> = {
  "k8s:read":
    "You need the k8s:read scope to view cluster resources. Ask an administrator to grant k8s:read in Settings → Users.",
  "k8s:write":
    "You need the k8s:write scope to run this action. Ask an administrator to grant k8s:write in Settings → Users.",
  "stats:read":
    "You need the stats:read scope to view cluster metrics. Ask an administrator to grant stats:read in Settings → Users.",
  admin:
    "This action requires the admin scope. Ask an administrator to grant admin in Settings → Users.",
};

const ADMIN_ROLE_MESSAGE =
  "User administration requires the administrator role. Ask an administrator to promote your account in Settings → Users.";

const GENERIC_MESSAGE =
  "You do not have permission to perform this action. Ask an administrator to review your role and scopes in Settings → Users.";

const GENERIC_TITLE = "Access denied";

/**
 * Builds the denial for a scope (or the `admin-role` marker). Returns null
 * for the unclassified (no scope) case.
 */
export function denialForScope(
  scope: PermissionScope,
): PermissionDenial | null {
  if (scope === "admin-role") {
    return {
      scope,
      title: "Administrator role required",
      message: ADMIN_ROLE_MESSAGE,
    };
  }
  if (scope) {
    return {
      scope,
      title: "Missing scope",
      message: MESSAGES[scope],
    };
  }
  return null;
}

export function isForbidden(error: unknown): boolean {
  const candidate = error as ErrorLike | null | undefined;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.response?.status === 403
  );
}

function requestUrl(error: unknown): string {
  const url = (error as ErrorLike | null | undefined)?.config?.url;
  return typeof url === "string" ? url : "";
}

function requestCommand(error: unknown): string | null {
  let data = (error as ErrorLike | null | undefined)?.config?.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const command = (data as { command?: unknown }).command;
  return typeof command === "string" ? command : null;
}

function scopeForKubectlCommand(command: string | null): AppScope {
  switch (command) {
    case "rollout restart":
    case "scale":
    case "create":
      return "k8s:write";
    case "delete":
    case "exec":
      return "admin";
    case "get":
    case "describe":
    default:
      return "k8s:read";
  }
}

/**
 * Maps a failed request to the scope that would unlock it, or null when the
 * error is not a 403. Unclassified 403s still get an actionable message.
 */
export function permissionDenialForError(
  error: unknown,
): PermissionDenial | null {
  if (!isForbidden(error)) {
    return null;
  }

  const url = requestUrl(error);
  const path = url.split(/[?#]/, 1)[0] ?? url;

  if (path.includes("/users/tokens")) {
    return { scope: null, title: GENERIC_TITLE, message: GENERIC_MESSAGE };
  }
  if (path.includes("/users")) {
    return denialForScope("admin-role");
  }
  if (path.includes("/stats/recommendation/regenerate")) {
    return denialForScope("admin");
  }
  if (path.includes("/resources/refresh")) {
    return denialForScope("admin");
  }
  if (path.includes("/stats")) {
    return denialForScope("stats:read");
  }
  if (path.includes("/resources")) {
    return denialForScope("k8s:read");
  }
  if (path.includes("/kubectl/logs")) {
    return denialForScope("k8s:read");
  }
  if (path.includes("/kubectl/command")) {
    return denialForScope(scopeForKubectlCommand(requestCommand(error)));
  }

  return { scope: null, title: GENERIC_TITLE, message: GENERIC_MESSAGE };
}
