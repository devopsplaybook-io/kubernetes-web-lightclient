/**
 * Shared utility functions for Kubernetes object display.
 */

export function getPodStatus(pod: any): string {
  const phase = pod.status?.phase || "Unknown";
  if (pod.metadata?.deletionTimestamp) return "Terminating";
  const initStatuses = pod.status?.initContainerStatuses || [];
  for (const cs of initStatuses) {
    if (cs.state?.waiting?.reason) return `Init:${cs.state.waiting.reason}`;
    if (
      cs.state?.terminated?.reason &&
      cs.state.terminated.reason !== "Completed"
    ) {
      return `Init:${cs.state.terminated.reason}`;
    }
  }
  const containerStatuses = pod.status?.containerStatuses || [];
  for (const cs of containerStatuses) {
    if (cs.state?.waiting?.reason) return cs.state.waiting.reason;
    if (cs.state?.terminated?.reason) return cs.state.terminated.reason;
  }
  return phase;
}

export function podStatusClass(status: string): string {
  if (!status) return "status-neutral";
  const s = status.toLowerCase();
  if (s === "running" || s === "succeeded" || s === "completed")
    return "status-ok";
  if (
    s === "pending" ||
    s === "containercreating" ||
    s === "podscheduled" ||
    s === "terminating" ||
    s.startsWith("init:")
  )
    return "status-warning";
  if (
    s === "failed" ||
    s === "unknown" ||
    s === "crashloopbackoff" ||
    s === "imagepullbackoff" ||
    s === "errimagepull" ||
    s === "oomkilled" ||
    s === "error" ||
    s === "evicted" ||
    s === "startuperror" ||
    s === "createcontainerconfigerror" ||
    s === "invalidimagename"
  )
    return "status-error";
  return "status-neutral";
}
