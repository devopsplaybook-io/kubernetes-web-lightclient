import type { Config } from "../Config";
import { KubeCtlExecutorGetInstance } from "../kubectl/KubeCtlExecutor";

const KUBECTL_TIMEOUT_MS = 20000;
const PODS_LIST_ARGS = ["get", "pods", "-A", "-o", "json"];

let podsSnapshotTtlMs = 60000;
let podsSnapshot: { promise: Promise<string>; startedAt: number } | null = null;

/**
 * Configure the shared pods snapshot cache. The TTL follows the stats fetch
 * frequency, so the pod-usage loop and recommendations normally reuse the
 * snapshot taken by the metrics loop instead of running another
 * `kubectl get pods`.
 */
export function StatsDataUtilsInit(config: Config): void {
  podsSnapshotTtlMs = Math.max(
    1000,
    (config.STATS_FETCH_FREQUENCY || 60) * 1000,
  );
  podsSnapshot = null;
}

/**
 * Run kubectl with an argument vector (no shell) and return the raw stdout.
 * All executions go through the bounded request queue.
 */
export async function kubernetesCommand(args: string[]): Promise<string> {
  const executor = KubeCtlExecutorGetInstance();
  if (!IsPodsListCommand(args)) {
    return executor.executeRawCommand(args, KUBECTL_TIMEOUT_MS);
  }

  const now = Date.now();
  if (podsSnapshot && now - podsSnapshot.startedAt < podsSnapshotTtlMs) {
    return podsSnapshot.promise;
  }

  // Start a single shared in-flight promise; concurrent callers arriving in
  // the same tick reuse it before the first await resolves.
  const promise = executor.executeRawCommand(args, KUBECTL_TIMEOUT_MS);
  const entry = { promise, startedAt: now };
  podsSnapshot = entry;
  promise.catch(() => {
    // Do not cache failures: the next caller retries.
    if (podsSnapshot === entry) {
      podsSnapshot = null;
    }
  });
  return promise;
}

function IsPodsListCommand(args: string[]): boolean {
  return (
    args.length === PODS_LIST_ARGS.length &&
    PODS_LIST_ARGS.every((token, index) => args[index] === token)
  );
}
