import type { AuthAuditEvent, AuthAuditHandler } from "@devopsplaybook.io/common-utils";

interface AuditLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * Formats library auth audit events as single readable log lines. Events
 * never carry passwords, JWTs, API-token values or hashes, so only the
 * action, outcome, reason, actor/target names, IP and route are logged.
 */
export function CreateAuthAuditHandler(logger: AuditLogger): AuthAuditHandler {
  return (event: AuthAuditEvent) => {
    const isLogin =
      event.action === "login_success" || event.action === "login_failure";
    const parts = [`auth.${event.action}`, `outcome=${event.outcome}`];
    if (event.reason) {
      parts.push(`reason=${event.reason}`);
    }
    if (event.actorName) {
      parts.push(`actor=${event.actorName}`);
    }
    if (event.targetUserName) {
      parts.push(`target=${event.targetUserName}`);
    }
    if (event.ip) {
      parts.push(`ip=${event.ip}`);
    }
    if (isLogin) {
      parts.push("route=POST /api/users/session");
    }
    const line = parts.join(" ");
    if (event.outcome === "failure") {
      logger.warn(line);
    } else {
      logger.info(line);
    }
  };
}
