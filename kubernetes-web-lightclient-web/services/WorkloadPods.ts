/**
 * Pure helpers for the workload -> pods drill-down and the merged multi-pod
 * log stream. Kept free of I/O so the routing, ownership and merge rules are
 * unit-testable without a cluster.
 */

export const WORKLOAD_KINDS = [
  "deployment",
  "statefulset",
  "daemonset",
  "job",
  "cronjob",
] as const;

export type WorkloadKind = (typeof WORKLOAD_KINDS)[number];

export interface WorkloadRoute {
  kind: WorkloadKind;
  name: string;
  namespace: string;
}

export const MERGED_LOG_POD_CAP = 10;
export const MERGED_LOG_CONCURRENCY = 3;

const KIND_LABELS: Record<string, string> = {
  deployment: "Deployment",
  statefulset: "StatefulSet",
  daemonset: "DaemonSet",
  job: "Job",
  cronjob: "CronJob",
};

export function WorkloadKindLabel(kind: string): string {
  if (KIND_LABELS[kind]) {
    return KIND_LABELS[kind];
  }
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Workload";
}

const OBJECT_NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const NAMESPACE_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const LABEL_KEY_NAME_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const LABEL_VALUE_REGEX = /^([A-Za-z0-9]([A-Za-z0-9._-]{0,61}[A-Za-z0-9])?)?$/;
const MAX_NAME_LENGTH = 253;

const WAITING_REASONS = new Set([
  "ImagePullBackOff",
  "ErrImagePull",
  "InvalidImageName",
  "ErrImageNeverPull",
  "RegistryUnavailable",
  "CreateContainerConfigError",
  "CreateContainerError",
  "RunContainerError",
  "ContainerCreating",
  "PodInitializing",
  "CrashLoopBackOff",
]);

export function ClientLabelKeyIsValid(key: string): boolean {
  if (!key || key.length > 317) {
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

export function ClientLabelValueIsValid(value: string): boolean {
  return value.length <= 63 && LABEL_VALUE_REGEX.test(value);
}

function isValidObjectName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NAME_LENGTH &&
    OBJECT_NAME_REGEX.test(value)
  );
}

function isValidNamespace(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 63 &&
    NAMESPACE_REGEX.test(value)
  );
}

/**
 * Read the drill-down parameters from a route query. Malformed links are
 * ignored (null) so an edited URL can never open a partial drill-down.
 */
export function ParseWorkloadRoute(query: unknown): WorkloadRoute | null {
  if (!query || typeof query !== "object") {
    return null;
  }
  const params = query as Record<string, unknown>;
  const kind = params.workload;
  const name = params.workloadName;
  const namespace = params.namespace;
  if (
    typeof kind !== "string" ||
    !WORKLOAD_KINDS.includes(kind as WorkloadKind)
  ) {
    return null;
  }
  if (!isValidObjectName(name) || !isValidNamespace(namespace)) {
    return null;
  }
  return {
    kind: kind as WorkloadKind,
    name: name as string,
    namespace: namespace as string,
  };
}

/**
 * Build a label selector from a workload's `spec.selector.matchLabels`.
 * `matchExpressions` cannot be expressed as an equality selector, and a
 * CronJob has no pod selector at all, so both return null (the caller falls
 * back to the owner chain).
 */
export function BuildPodSelector(workload: any): string | null {
  if (!workload || workload.kind === "CronJob") {
    return null;
  }
  const matchLabels = workload.spec?.selector?.matchLabels;
  if (!matchLabels || typeof matchLabels !== "object") {
    return null;
  }
  const entries = Object.entries(matchLabels).filter(
    ([key, value]) =>
      ClientLabelKeyIsValid(key) &&
      typeof value === "string" &&
      ClientLabelValueIsValid(value),
  );
  if (entries.length === 0 || entries.length !== Object.keys(matchLabels).length) {
    return null;
  }
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function SelectorLabels(selector: string): Array<[string, string]> {
  if (!selector) {
    return [];
  }
  return selector.split(",").map((term) => {
    const index = term.indexOf("=");
    return [term.slice(0, index), term.slice(index + 1)];
  });
}

function OwnedBy(item: any, uid: string): boolean {
  return (item?.metadata?.ownerReferences || []).some(
    (reference: any) => reference.uid === uid,
  );
}

function OwnerResolvedPods(input: {
  kind: WorkloadKind;
  workload: any;
  pods: any[];
  replicasets: any[];
  jobs: any[];
}): any[] {
  const { kind, workload, pods, replicasets, jobs } = input;
  const uid = workload?.metadata?.uid;
  if (!uid) {
    return [];
  }
  if (kind === "deployment") {
    const replicaSetUids = replicasets
      .filter((replicaSet) => OwnedBy(replicaSet, uid))
      .map((replicaSet) => replicaSet.metadata?.uid)
      .filter(Boolean);
    return pods.filter((pod) =>
      replicaSetUids.some((replicaSetUid) => OwnedBy(pod, replicaSetUid)),
    );
  }
  if (kind === "cronjob") {
    const jobUids = jobs
      .filter((job) => OwnedBy(job, uid))
      .map((job) => job.metadata?.uid)
      .filter(Boolean);
    return pods.filter((pod) =>
      jobUids.some((jobUid) => OwnedBy(pod, jobUid)),
    );
  }
  return pods.filter((pod) => OwnedBy(pod, uid));
}

export interface ResolveWorkloadPodsInput {
  kind: WorkloadKind;
  workload: any;
  pods: any[];
  replicasets?: any[];
  jobs?: any[];
  // Force the owner chain even when a selector is available (used when the
  // selector returned no pods, e.g. a workload whose labels were changed).
  forceOwner?: boolean;
}

export function ResolveWorkloadPods(
  input: ResolveWorkloadPodsInput,
): { pods: any[]; strategy: "selector" | "owner" } {
  const {
    kind,
    workload,
    pods,
    replicasets = [],
    jobs = [],
    forceOwner = false,
  } = input;
  const namespace = workload?.metadata?.namespace;
  const namespacePods = pods.filter(
    (pod) => !namespace || pod.metadata?.namespace === namespace,
  );
  const selector = kind === "cronjob" ? null : BuildPodSelector(workload);

  let matched: any[];
  let strategy: "selector" | "owner";
  if (selector && !forceOwner) {
    const labels = SelectorLabels(selector);
    matched = namespacePods.filter((pod) =>
      labels.every(
        ([key, value]) => pod.metadata?.labels?.[key] === value,
      ),
    );
    strategy = "selector";
  } else {
    matched = OwnerResolvedPods({
      kind,
      workload,
      pods: namespacePods,
      replicasets,
      jobs,
    });
    strategy = "owner";
  }

  const byUid = new Map<string, any>();
  for (const pod of matched) {
    const key = pod.metadata?.uid || pod.metadata?.name;
    if (key && !byUid.has(key)) {
      byUid.set(key, pod);
    }
  }
  const resolved = Array.from(byUid.values()).sort((a, b) =>
    String(a.metadata?.name).localeCompare(String(b.metadata?.name)),
  );
  return { pods: resolved, strategy };
}

export function PodRestartCount(pod: any): number {
  const containerRestarts = (pod?.status?.containerStatuses || []).reduce(
    (sum: number, status: any) => sum + (status.restartCount || 0),
    0,
  );
  const initRestarts = (pod?.status?.initContainerStatuses || []).reduce(
    (sum: number, status: any) => sum + (status.restartCount || 0),
    0,
  );
  return containerRestarts + initRestarts;
}

export function DetectPodWaiting(
  pod: any,
): { container: string; reason: string } | null {
  const statuses = [
    ...(pod?.status?.initContainerStatuses || []),
    ...(pod?.status?.containerStatuses || []),
  ];
  for (const status of statuses) {
    const reason = status?.state?.waiting?.reason;
    if (reason && WAITING_REASONS.has(reason)) {
      return { container: status.name || "", reason };
    }
  }
  if (pod?.status?.phase === "Pending") {
    return { container: "", reason: "Pending" };
  }
  return null;
}

export function WaitingGuidance(reason: string): string {
  switch (reason) {
    case "ImagePullBackOff":
    case "ErrImagePull":
    case "InvalidImageName":
    case "ErrImageNeverPull":
    case "RegistryUnavailable":
      return "Image pull failing — check the image name, the registry and the imagePullSecrets.";
    case "CreateContainerConfigError":
    case "CreateContainerError":
    case "RunContainerError":
      return "Container configuration error — check the referenced ConfigMap/Secret, environment variables and volume mounts.";
    case "ContainerCreating":
    case "PodInitializing":
    case "Pending":
      return "Container is starting — wait for scheduling, the image pull and the init containers to finish; see the Events below if it stays here.";
    case "CrashLoopBackOff":
      return "Container keeps crashing — open the previous logs (Advanced → Previous) and check the Events below.";
    default:
      return "The container is not running yet; check the Events below.";
  }
}

export interface PodCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

export function PodConditions(pod: any): PodCondition[] {
  return (pod?.status?.conditions || []).map((condition: any) => ({
    type: String(condition.type || ""),
    status: String(condition.status || ""),
    ...(condition.reason ? { reason: String(condition.reason) } : {}),
    ...(condition.message ? { message: String(condition.message) } : {}),
  }));
}

function EventTimestamp(event: any): number {
  const value =
    event?.lastTimestamp ||
    event?.eventTime ||
    event?.metadata?.creationTimestamp ||
    "";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Warning events for the given pods, newest first and capped so a noisy
 * namespace cannot flood the log dialog.
 */
export function PodWarningEvents(
  events: any[],
  podNames: string[],
): any[] {
  const names = new Set(podNames.filter(Boolean));
  return (events || [])
    .filter(
      (event) =>
        event?.type === "Warning" &&
        event?.involvedObject?.kind === "Pod" &&
        names.has(event.involvedObject.name),
    )
    .sort((a, b) => EventTimestamp(b) - EventTimestamp(a))
    .slice(0, 50);
}

const TIMESTAMP_LINE_REGEX = /^(\d{4}-\d{2}-\d{2}T\S+)\s(.*)$/;

export interface MergedLogStream {
  pod: string;
  text: string;
}

/**
 * Merge per-pod `kubectl logs --timestamps` outputs into one chronological
 * stream, prefixing every line with its pod name. Lines without a timestamp
 * inherit the previous timestamp of their own stream so the per-pod order
 * survives the merge.
 */
export function MergeLogStreams(
  streams: MergedLogStream[],
  showTimestamps: boolean,
): { text: string; lineCount: number } {
  interface Entry {
    pod: string;
    time: number;
    sequence: number;
    timestamp: string;
    text: string;
  }
  const entries: Entry[] = [];
  for (const stream of streams) {
    const lines = (stream.text || "").split("\n");
    // kubectl terminates the output with a newline: drop only that last one.
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    let lastTimestamp = "";
    let lastTime = 0;
    lines.forEach((line, sequence) => {
      const match = TIMESTAMP_LINE_REGEX.exec(line);
      if (match) {
        lastTimestamp = match[1];
        const parsed = Date.parse(match[1]);
        lastTime = Number.isNaN(parsed) ? lastTime : parsed;
      }
      entries.push({
        pod: stream.pod,
        time: lastTime,
        sequence,
        timestamp: lastTimestamp,
        text: match ? match[2] : line,
      });
    });
  }

  entries.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }
    if (a.pod !== b.pod) {
      return a.pod.localeCompare(b.pod);
    }
    return a.sequence - b.sequence;
  });

  const text = entries
    .map((entry) => {
      const timestamp =
        showTimestamps && entry.timestamp ? `${entry.timestamp} ` : "";
      return `[${entry.pod}] ${timestamp}${entry.text}`;
    })
    .join("\n");
  return { text, lineCount: entries.length };
}

export function WorkloadDrilldownQuery(
  kind: WorkloadKind,
  name: string,
  namespace: string,
  options: { mergedLogs?: boolean } = {},
): Record<string, string> {
  const query: Record<string, string> = {
    objectType: "pod",
    workload: kind,
    workloadName: name,
    namespace,
  };
  if (options.mergedLogs) {
    query.dialog = "merged-logs";
  }
  return query;
}
