/**
 * Shared utility functions for Kubernetes object display.
 */
import axios from "axios";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { KubernetesObjectStore } from "~~/stores/KubernetesObjectStore";

export function isObjectNotFoundError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/**
 * Handles the "object vanished since the list was loaded" case: show an
 * actionable message and refresh that type's cache instead of surfacing the
 * raw kubectl error. Returns true when the error was handled.
 */
export function handleStaleObjectError(
  error: unknown,
  objectType: string,
): boolean {
  if (!isObjectNotFoundError(error)) {
    return false;
  }
  EventBus.emit(EventTypes.ALERT_MESSAGE, {
    type: "warning",
    text: `This ${objectType} no longer exists — the list has been refreshed.`,
  });
  KubernetesObjectStore().invalidateAndRefresh(objectType);
  return true;
}

/**
 * Returns a promise-rejection handler treating 404s on kubectl actions as
 * stale-object signals for the given type; other errors fall through to the
 * standard error handling.
 */
export function staleAwareHandler(objectType: string) {
  return (error: unknown) => {
    if (!handleStaleObjectError(error, objectType)) {
      handleError(error);
    }
  };
}

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

/**
 * Ready and total container counts of a pod, shared by the Ready cell display
 * and the list sort accessors so they cannot drift apart.
 */
export function getPodReadyCount(pod: any): { ready: number; total: number } {
  const statuses = pod.status?.containerStatuses || [];
  return {
    ready: statuses.filter((s) => s.ready).length,
    total: statuses.length,
  };
}

export function getPodRestartCount(pod: any): number {
  const statuses = pod.status?.containerStatuses || [];
  return statuses.reduce((sum, s) => sum + (s.restartCount || 0), 0);
}

export function getPodLastRestartAt(pod: any): string {
  const statuses = pod.status?.containerStatuses || [];
  // Find the latest restart time among all containers
  return (
    statuses
      .map(
        (s) =>
          s.state?.terminated?.finishedAt ||
          s.lastState?.terminated?.finishedAt,
      )
      .filter(Boolean)
      .sort()
      .reverse()[0] || ""
  );
}
