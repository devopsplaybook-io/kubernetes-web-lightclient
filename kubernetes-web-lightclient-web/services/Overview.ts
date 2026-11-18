/**
 * Pure aggregation helpers for the cluster health overview. No I/O and no Vue
 * imports: every tile value is derived from the already cached listings so the
 * page can be composed without new server endpoints or command families.
 */
import {
  getPodLastRestartAt,
  getPodRestartCount,
  getPodStatus,
} from "~~/services/KubernetesUtils";
import { FilteredListPath } from "~~/services/ObjectLinks";
import {
  WORKLOAD_KINDS,
  WorkloadDrilldownQuery,
  type WorkloadKind,
} from "~~/services/WorkloadPods";

export type PodProblemState =
  | ""
  | "pending"
  | "terminating"
  | "failed"
  | "crashloop"
  | "imagepull";

export const POD_PROBLEM_STATES: PodProblemState[] = [
  "pending",
  "terminating",
  "failed",
  "crashloop",
  "imagepull",
];

export const POD_PROBLEM_STATE_LABELS: Record<string, string> = {
  pending: "Pending",
  terminating: "Terminating",
  failed: "Failed",
  crashloop: "CrashLoopBackOff",
  imagepull: "Image pull error",
};

const PENDING_STATUSES = new Set(["Pending", "ContainerCreating", "PodScheduled"]);
const IMAGE_PULL_STATUSES = new Set([
  "ImagePullBackOff",
  "ErrImagePull",
  "InvalidImageName",
  "ErrImageNeverPull",
  "RegistryUnavailable",
]);

/**
 * Classifies a pod into at most one problem bucket. The precedence is fixed
 * (terminating -> crashloop -> imagepull -> pending -> failed) so a pod with
 * several symptoms is only counted once. Healthy pods return "".
 */
export function GetPodProblemState(pod: any): PodProblemState {
  if (pod?.metadata?.deletionTimestamp) {
    return "terminating";
  }
  const status = getPodStatus(pod);
  if (status === "CrashLoopBackOff") {
    return "crashloop";
  }
  if (IMAGE_PULL_STATUSES.has(status)) {
    return "imagepull";
  }
  if (PENDING_STATUSES.has(status) || status.startsWith("Init:")) {
    return "pending";
  }
  if (status === "Running" || status === "Succeeded" || status === "Completed") {
    return "";
  }
  return "failed";
}

export interface PodHealth {
  total: number;
  notRunning: number;
  states: Record<string, any[]>;
}

export function GetPodHealth(pods: any[]): PodHealth {
  const states: Record<string, any[]> = {};
  for (const state of POD_PROBLEM_STATES) {
    states[state] = [];
  }
  const items = pods || [];
  for (const pod of items) {
    const state = GetPodProblemState(pod);
    if (state) {
      states[state].push(pod);
    }
  }
  const notRunning = POD_PROBLEM_STATES.reduce(
    (sum, state) => sum + states[state].length,
    0,
  );
  return { total: items.length, notRunning, states };
}

export function IsNodeReady(node: any): boolean {
  const readyCondition = node?.status?.conditions?.find(
    (condition: any) => condition.type === "Ready",
  );
  return readyCondition?.status === "True";
}

export interface NodeHealth {
  total: number;
  ready: number;
  notReady: any[];
}

export function GetNodeHealth(nodes: any[]): NodeHealth {
  const items = nodes || [];
  const notReady = items.filter((node) => !IsNodeReady(node));
  return { total: items.length, ready: items.length - notReady.length, notReady };
}

function EventTimestampMs(event: any): number {
  const value =
    event?.lastTimestamp ||
    event?.eventTime ||
    event?.firstTimestamp ||
    event?.metadata?.creationTimestamp ||
    "";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function EventTimestamp(event: any): string {
  return (
    event?.lastTimestamp ||
    event?.eventTime ||
    event?.firstTimestamp ||
    event?.metadata?.creationTimestamp ||
    ""
  );
}

export interface WarningRow {
  kind: string;
  namespace: string;
  name: string;
  reason: string;
  message: string;
  count: number;
  time: string;
}

/**
 * Newest Warning events, deduplicated by involved object + reason so the same
 * recurring problem shows once with its accumulated count.
 */
export function GetRecentWarnings(
  events: any[],
  limit: number = 5,
): WarningRow[] {
  const warnings = (events || [])
    .filter((event) => event?.type === "Warning")
    .sort((a, b) => EventTimestampMs(b) - EventTimestampMs(a));

  const rows = new Map<string, WarningRow>();
  for (const event of warnings) {
    const involved = event.involvedObject || {};
    const row: WarningRow = {
      kind: involved.kind || "",
      namespace: involved.namespace || event.metadata?.namespace || "",
      name: involved.name || "",
      reason: event.reason || "",
      message: event.message || "",
      count: Math.max(
        Number(event.count) || 0,
        Number(event.series?.count) || 0,
        1,
      ),
      time: EventTimestamp(event),
    };
    const key = `${row.kind}|${row.namespace}|${row.name}|${row.reason}`;
    if (!rows.has(key)) {
      rows.set(key, row);
    }
  }
  return Array.from(rows.values()).slice(0, limit);
}

export interface RestartingWorkload {
  kind: string;
  name: string;
  namespace: string;
  restarts: number;
  lastRestartAt: string;
}

/**
 * Resolves the workload a pod belongs to: ReplicaSet pods map back to their
 * Deployment when the deployment selector matches the pod labels, every other
 * supported owner keeps its own kind. Unresolved pods are reported as pods.
 */
function ResolveWorkload(
  pod: any,
  deployments: any[],
): { kind: string; name: string } {
  const owner = pod?.metadata?.ownerReferences?.[0];
  const metadata = pod?.metadata || {};
  if (!owner?.kind || !owner?.name) {
    return { kind: "pod", name: metadata.name || "" };
  }
  if (owner.kind === "ReplicaSet") {
    const namespace = metadata.namespace || "";
    const labels = metadata.labels || {};
    let best: string | null = null;
    for (const deployment of deployments || []) {
      if (deployment?.metadata?.namespace !== namespace) {
        continue;
      }
      const name = deployment?.metadata?.name || "";
      if (!name || !String(owner.name).startsWith(`${name}-`)) {
        continue;
      }
      const matchLabels = deployment?.spec?.selector?.matchLabels;
      if (!matchLabels || typeof matchLabels !== "object") {
        continue;
      }
      const matches = Object.entries(matchLabels).every(
        ([key, value]) => labels[key] === value,
      );
      if (matches && (!best || name.length > best.length)) {
        best = name;
      }
    }
    if (best) {
      return { kind: "deployment", name: best };
    }
    return { kind: "replicaset", name: owner.name };
  }
  return { kind: String(owner.kind).toLowerCase(), name: owner.name };
}

export function GetTopRestartingWorkloads(
  pods: any[],
  deployments: any[],
  limit: number = 5,
): RestartingWorkload[] {
  const groups = new Map<string, RestartingWorkload>();
  for (const pod of pods || []) {
    const restarts = getPodRestartCount(pod);
    if (!restarts) {
      continue;
    }
    const { kind, name } = ResolveWorkload(pod, deployments);
    if (!name) {
      continue;
    }
    const namespace = pod.metadata?.namespace || "";
    const key = `${kind}/${namespace}/${name}`;
    const lastRestartAt = getPodLastRestartAt(pod);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { kind, name, namespace, restarts, lastRestartAt });
      continue;
    }
    existing.restarts += restarts;
    if (lastRestartAt && lastRestartAt > existing.lastRestartAt) {
      existing.lastRestartAt = lastRestartAt;
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => {
      if (a.restarts !== b.restarts) {
        return b.restarts - a.restarts;
      }
      return (b.lastRestartAt || "").localeCompare(a.lastRestartAt || "");
    })
    .slice(0, limit);
}

export interface CapacitySummary {
  cpuAllocatableMillicores: number;
  cpuRequestsMillicores: number;
  cpuLimitsMillicores: number;
  cpuUsageMillicores: number | null;
  memoryAllocatableKiB: number;
  memoryRequestsKiB: number;
  memoryLimitsKiB: number;
  memoryUsageKiB: number | null;
  cpuRequestRatio: number | null;
  cpuLimitRatio: number | null;
  cpuUsageRatio: number | null;
  memoryRequestRatio: number | null;
  memoryLimitRatio: number | null;
  memoryUsageRatio: number | null;
  usageAvailable: boolean;
}

function Ratio(value: number, denominator: number): number | null {
  return denominator > 0 ? value / denominator : null;
}

function NumberOrNull(value: unknown): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

export function GetCapacitySummary(
  nodes: any[],
  pods: any[],
  podUsageStats: any[],
): CapacitySummary {
  let cpuAllocatable = 0;
  let memoryAllocatable = 0;
  for (const node of nodes || []) {
    const cpu = node?.status?.allocatable?.cpu ?? node?.status?.capacity?.cpu;
    const memory =
      node?.status?.allocatable?.memory ?? node?.status?.capacity?.memory;
    cpuAllocatable += ParseCpuToMillicores(cpu) ?? 0;
    memoryAllocatable += ParseMemoryToKiB(memory) ?? 0;
  }

  let cpuRequests = 0;
  let cpuLimits = 0;
  let memoryRequests = 0;
  let memoryLimits = 0;
  for (const pod of pods || []) {
    for (const container of pod?.spec?.containers || []) {
      const resources = container?.resources || {};
      cpuRequests += ParseCpuToMillicores(resources.requests?.cpu) ?? 0;
      cpuLimits += ParseCpuToMillicores(resources.limits?.cpu) ?? 0;
      memoryRequests += ParseMemoryToKiB(resources.requests?.memory) ?? 0;
      memoryLimits += ParseMemoryToKiB(resources.limits?.memory) ?? 0;
    }
  }

  let cpuUsage: number | null = null;
  let memoryUsage: number | null = null;
  for (const usage of podUsageStats || []) {
    const cpu = NumberOrNull(usage?.cpuLatest);
    if (cpu !== null) {
      cpuUsage = (cpuUsage ?? 0) + cpu;
    }
    const memory = NumberOrNull(usage?.memoryLatest);
    if (memory !== null) {
      memoryUsage = (memoryUsage ?? 0) + memory;
    }
  }

  return {
    cpuAllocatableMillicores: cpuAllocatable,
    cpuRequestsMillicores: cpuRequests,
    cpuLimitsMillicores: cpuLimits,
    cpuUsageMillicores: cpuUsage,
    memoryAllocatableKiB: memoryAllocatable,
    memoryRequestsKiB: memoryRequests,
    memoryLimitsKiB: memoryLimits,
    memoryUsageKiB: memoryUsage,
    cpuRequestRatio: Ratio(cpuRequests, cpuAllocatable),
    cpuLimitRatio: Ratio(cpuLimits, cpuAllocatable),
    cpuUsageRatio:
      cpuUsage === null ? null : Ratio(cpuUsage, cpuAllocatable),
    memoryRequestRatio: Ratio(memoryRequests, memoryAllocatable),
    memoryLimitRatio: Ratio(memoryLimits, memoryAllocatable),
    memoryUsageRatio:
      memoryUsage === null ? null : Ratio(memoryUsage, memoryAllocatable),
    usageAvailable: cpuUsage !== null || memoryUsage !== null,
  };
}

const CPU_QUANTITY_REGEX = /^([0-9]+(?:\.[0-9]+)?)(m?)$/;

/** Parses a Kubernetes CPU quantity (`250m`, `1.5`, `2`) to millicores. */
export function ParseCpuToMillicores(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : value * 1000;
  }
  if (typeof value !== "string" || !value) {
    return null;
  }
  const match = CPU_QUANTITY_REGEX.exec(value.trim());
  if (!match) {
    return null;
  }
  const amount = parseFloat(match[1]);
  return match[2] === "m" ? amount : amount * 1000;
}

const MEMORY_QUANTITY_REGEX = /^([0-9]+(?:\.[0-9]+)?)([a-zA-Z]*)$/;
const MEMORY_FACTORS_KIB: Record<string, number> = {
  "": 1 / 1024,
  Ki: 1,
  Mi: 1024,
  Gi: 1024 * 1024,
  Ti: 1024 * 1024 * 1024,
  k: 1000 / 1024,
  K: 1000 / 1024,
  M: (1000 * 1000) / 1024,
  G: (1000 * 1000 * 1000) / 1024,
};

/** Parses a Kubernetes memory quantity to KiB; a plain number is bytes. */
export function ParseMemoryToKiB(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : value / 1024;
  }
  if (typeof value !== "string" || !value) {
    return null;
  }
  const match = MEMORY_QUANTITY_REGEX.exec(value.trim());
  if (!match) {
    return null;
  }
  const factor = MEMORY_FACTORS_KIB[match[2]];
  if (factor === undefined) {
    return null;
  }
  return parseFloat(match[1]) * factor;
}

export function FormatMillicores(
  millicores: number | null | undefined,
): string {
  if (millicores === null || millicores === undefined || Number.isNaN(millicores)) {
    return "-";
  }
  if (millicores >= 1000) {
    return `${(millicores / 1000).toFixed(2)}`;
  }
  return `${Math.round(millicores)}m`;
}

export function FormatKiB(kib: number | null | undefined): string {
  if (kib === null || kib === undefined || Number.isNaN(kib)) {
    return "-";
  }
  if (kib >= 1024 * 1024) {
    return `${(kib / (1024 * 1024)).toFixed(2)}Gi`;
  }
  if (kib >= 1024) {
    return `${(kib / 1024).toFixed(2)}Mi`;
  }
  return `${Math.round(kib)}Ki`;
}

export function FormatRatio(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return "-";
  }
  return `${Math.round(ratio * 100)}%`;
}

export const NODE_PROBLEMS_QUERY = FilteredListPath("node", "", "", [
  "has-warnings",
]);
export const WARNINGS_QUERY = FilteredListPath("events", "", "", ["warnings"]);
export const PODS_NOT_RUNNING_QUERY = FilteredListPath("pod", "", "", [
  "not-running",
]);

export function PodStateListPath(state: PodProblemState): string {
  return FilteredListPath("pod", "", "", [state]);
}

/** Drill-down path for a workload kind, or null when it has no pod list. */
export function WorkloadDrilldownPath(
  kind: string,
  name: string,
  namespace: string,
): string | null {
  if (!WORKLOAD_KINDS.includes(kind as WorkloadKind)) {
    return null;
  }
  const query = WorkloadDrilldownQuery(
    kind as WorkloadKind,
    name,
    namespace,
  );
  return `/kubernetes?${new URLSearchParams(query).toString()}`;
}
