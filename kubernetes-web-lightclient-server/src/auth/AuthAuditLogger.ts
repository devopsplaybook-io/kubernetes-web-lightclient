import type { AuthAuditEvent, AuthAuditHandler } from "@devopsplaybook.io/common-utils";

interface AuditLogger {
  info(message: string): void;
  warn(message: string): void;
}

const ROUTES: Partial<Record<AuthAuditEvent["action"], string>> = {
  login_success: "POST /api/users/session",
  login_failure: "POST /api/users/session",
  user_create: "POST /api/users",
  user_update: "PUT /api/users/:id",
  user_delete: "DELETE /api/users/:id",
  api_token_create: "POST /api/users/tokens",
  api_token_revoke: "DELETE /api/users/tokens/:id",
};

function RouteForEvent(event: AuthAuditEvent): string | undefined {
  if (event.action === "password_change") {
    return event.reason === "admin_reset"
      ? "PUT /api/users/:id"
      : "PUT /api/users/password";
  }
  return ROUTES[event.action];
}

/**
 * Formats library auth audit events as single readable log lines. Events
 * never carry passwords, JWTs, API-token values or hashes, so only the
 * action, outcome, reason, actor/target identities, changed field names, IP
 * and route are logged.
 */
export function CreateAuthAuditHandler(logger: AuditLogger): AuthAuditHandler {
  return (event: AuthAuditEvent) => {
    const parts = [`auth.${event.action}`, `outcome=${event.outcome}`];
    if (event.reason) {
      parts.push(`reason=${event.reason}`);
    }
    if (event.actorName) {
      parts.push(`actor=${event.actorName}`);
    }
    if (event.actorId) {
      parts.push(`actorId=${event.actorId}`);
    }
    if (event.targetUserName) {
      parts.push(`target=${event.targetUserName}`);
    }
    if (event.targetUserId) {
      parts.push(`targetId=${event.targetUserId}`);
    }
    if (event.tokenId) {
      parts.push(`tokenId=${event.tokenId}`);
    }
    if (event.fields && event.fields.length > 0) {
      parts.push(`fields=${event.fields.join(",")}`);
    }
    if (event.ip) {
      parts.push(`ip=${event.ip}`);
    }
    const route = RouteForEvent(event);
    if (route) {
      parts.push(`route=${route}`);
    }
    const line = parts.join(" ");
    if (event.outcome === "failure") {
      logger.warn(line);
    } else {
      logger.info(line);
    }
  };
}
