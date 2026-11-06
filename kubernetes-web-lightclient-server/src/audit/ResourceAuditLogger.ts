export type ResourceAuditAction =
  | "kubectl.delete"
  | "kubectl.scale"
  | "kubectl.rollout-restart"
  | "kubectl.create-job";

export type ResourceAuditFailureReason = "queue_full" | "not_found" | "error";

export interface ResourceAuditEvent {
  action: ResourceAuditAction;
  outcome: "success" | "failure";
  actorName?: string;
  actorId?: string;
  route: string;
  object: string;
  namespace?: string;
  target?: string;
  replicas?: number;
  source?: string;
  reason?: ResourceAuditFailureReason;
  requestId?: string;
  ip?: string;
}

interface AuditLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * Formats a resource mutation as a single readable audit line. Events only
 * carry route/actor/target identifiers: never request bodies, manifests or
 * kubectl output.
 */
export function FormatResourceAuditEvent(event: ResourceAuditEvent): string {
  const parts = [event.action, `outcome=${event.outcome}`];
  if (event.reason) {
    parts.push(`reason=${event.reason}`);
  }
  if (event.actorName) {
    parts.push(`actor=${event.actorName}`);
  }
  if (event.actorId) {
    parts.push(`actorId=${event.actorId}`);
  }
  if (event.route) {
    parts.push(`route=${event.route}`);
  }
  if (event.object) {
    parts.push(`object=${event.object}`);
  }
  if (event.namespace) {
    parts.push(`namespace=${event.namespace}`);
  }
  if (event.target) {
    parts.push(`target=${event.target}`);
  }
  if (event.replicas !== undefined) {
    parts.push(`replicas=${event.replicas}`);
  }
  if (event.source) {
    parts.push(`source=${event.source}`);
  }
  if (event.requestId) {
    parts.push(`requestId=${event.requestId}`);
  }
  if (event.ip) {
    parts.push(`ip=${event.ip}`);
  }
  return parts.join(" ");
}

export function CreateResourceAuditHandler(
  logger: AuditLogger,
): (event: ResourceAuditEvent) => void {
  return (event: ResourceAuditEvent) => {
    const line = FormatResourceAuditEvent(event);
    if (event.outcome === "failure") {
      logger.warn(line);
    } else {
      logger.info(line);
    }
  };
}
