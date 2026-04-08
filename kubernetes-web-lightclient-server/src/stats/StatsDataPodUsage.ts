import { Span } from "@opentelemetry/api";
import * as fse from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import { PodResourceMeasurement } from "../model/PodResourceMeasurement";
import { PodUsageStats } from "../model/PodUsageStats";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { kubernetesCommand } from "./StatsDataUtils";

let podResources: PodResourceMeasurement[] = [];
let podUsageStats: Map<string, PodUsageStats> = new Map();
const logger = OTelLogger().createModuleLogger("StatsDataPodUsage");
const POD_USAGE_STATS_FILE = "pod-usage-stats.json";

export async function StatsDataPodUsageInit(
  context: Span,
  config: Config,
): Promise<void> {
  // Reset on startup: clear the persisted file
  const filePath = path.join(config.DATA_DIR, POD_USAGE_STATS_FILE);
  await fse.ensureDir(config.DATA_DIR);
  await fse.writeJson(filePath, {}, { spaces: 2 });
  podUsageStats = new Map();

  const executePodResourcesCapture = async () => {
    const span = OTelTracer().startSpan("StatsDataPodUsage-Loop");
    try {
      await PodResourcesCapture(config);
    } catch (error) {
      logger.error(`Error capturing pod resources`, error, span);
    }
    span.end();
  };
  await executePodResourcesCapture();
  setInterval(
    executePodResourcesCapture,
    config.POD_RESOURCES_FETCH_FREQUENCY * 1000,
  );
}

export async function PodResourcesGet(): Promise<PodResourceMeasurement[]> {
  return podResources;
}

export async function PodUsageStatsGet(): Promise<PodUsageStats[]> {
  return Array.from(podUsageStats.values());
}

// Private Functions

async function PodResourcesCapture(config: Config): Promise<void> {
  const podsObj = JSON.parse(
    await kubernetesCommand(`kubectl get pods --all-namespaces -o json`),
  );

  if (!podsObj.items) return;

  // Get current usage via kubectl top pods
  const podUsageMap: Map<string, { cpu: string; memory: string }> = new Map();
  try {
    const topPodsStr = await kubernetesCommand(
      `kubectl top pods --all-namespaces --no-headers`,
    );
    const lines = topPodsStr.trim().split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const namespace = parts[0];
        const podName = parts[1];
        const cpu = parts[2];
        const memory = parts[3] || "0";
        podUsageMap.set(`${namespace}/${podName}`, { cpu, memory });
      }
    }
  } catch (error) {
    logger.error("Failed to get pod usage via kubectl top", error);
  }

  const timestamp = new Date();
  const newPodResources: PodResourceMeasurement[] = [];
  const currentPodKeys = new Set<string>();

  for (const pod of podsObj.items) {
    const podName = pod.metadata?.name;
    const namespace = pod.metadata?.namespace;
    const nodeName = pod.spec?.nodeName || "N/A";

    if (!podName || !namespace) continue;

    let cpuRequestMillicores: number | null = null;
    let cpuLimitMillicores: number | null = null;
    let memoryRequestKiB: number | null = null;
    let memoryLimitKiB: number | null = null;

    if (pod.spec?.containers) {
      for (const container of pod.spec.containers) {
        const req = container.resources?.requests;
        const lim = container.resources?.limits;

        if (req?.cpu) {
          const v = parseCpuToMillicores(req.cpu);
          if (v !== null)
            cpuRequestMillicores = (cpuRequestMillicores ?? 0) + v;
        }
        if (req?.memory) {
          const v = parseMemoryToKiB(req.memory);
          if (v !== null) memoryRequestKiB = (memoryRequestKiB ?? 0) + v;
        }
        if (lim?.cpu) {
          const v = parseCpuToMillicores(lim.cpu);
          if (v !== null) cpuLimitMillicores = (cpuLimitMillicores ?? 0) + v;
        }
        if (lim?.memory) {
          const v = parseMemoryToKiB(lim.memory);
          if (v !== null) memoryLimitKiB = (memoryLimitKiB ?? 0) + v;
        }
      }
    }

    const usage = podUsageMap.get(`${namespace}/${podName}`);
    const cpuUsage = usage?.cpu || null;
    const memoryUsage = usage?.memory || null;

    newPodResources.push(
      new PodResourceMeasurement({
        name: podName,
        namespace,
        node: nodeName,
        cpuRequest:
          cpuRequestMillicores !== null
            ? formatMillicores(cpuRequestMillicores)
            : null,
        cpuLimit:
          cpuLimitMillicores !== null
            ? formatMillicores(cpuLimitMillicores)
            : null,
        memoryRequest:
          memoryRequestKiB !== null ? formatKiB(memoryRequestKiB) : null,
        memoryLimit: memoryLimitKiB !== null ? formatKiB(memoryLimitKiB) : null,
        cpuUsage,
        memoryUsage,
        timestamp,
      }),
    );

    // Update min/max/latest stats
    const podKey = `${namespace}/${podName}`;
    currentPodKeys.add(podKey);

    const cpuMillicores =
      cpuUsage !== null ? parseCpuToMillicores(cpuUsage) : null;
    const memKiB = memoryUsage !== null ? parseMemoryToKiB(memoryUsage) : null;

    const existing = podUsageStats.get(podKey);
    if (existing) {
      existing.node = nodeName;
      existing.updatedAt = timestamp;
      if (cpuMillicores !== null) {
        existing.cpuLatest = cpuMillicores;
        existing.cpuMin =
          existing.cpuMin === null
            ? cpuMillicores
            : Math.min(existing.cpuMin, cpuMillicores);
        existing.cpuMax =
          existing.cpuMax === null
            ? cpuMillicores
            : Math.max(existing.cpuMax, cpuMillicores);
      }
      if (memKiB !== null) {
        existing.memoryLatest = memKiB;
        existing.memoryMin =
          existing.memoryMin === null
            ? memKiB
            : Math.min(existing.memoryMin, memKiB);
        existing.memoryMax =
          existing.memoryMax === null
            ? memKiB
            : Math.max(existing.memoryMax, memKiB);
      }
    } else {
      podUsageStats.set(
        podKey,
        new PodUsageStats({
          name: podName,
          namespace,
          node: nodeName,
          cpuMin: cpuMillicores,
          cpuMax: cpuMillicores,
          cpuLatest: cpuMillicores,
          memoryMin: memKiB,
          memoryMax: memKiB,
          memoryLatest: memKiB,
          updatedAt: timestamp,
        }),
      );
    }
  }

  // Remove pods that are no longer present
  for (const key of Array.from(podUsageStats.keys())) {
    if (!currentPodKeys.has(key)) {
      podUsageStats.delete(key);
    }
  }

  podResources = newPodResources;

  // Persist to JSON file
  await persistPodUsageStats(config);
}

async function persistPodUsageStats(config: Config): Promise<void> {
  try {
    const filePath = path.join(config.DATA_DIR, POD_USAGE_STATS_FILE);
    const data: Record<string, any> = {};
    podUsageStats.forEach((v, k) => {
      data[k] = {
        name: v.name,
        namespace: v.namespace,
        node: v.node,
        cpu: {
          min: v.cpuMin !== null ? formatMillicores(v.cpuMin) : null,
          max: v.cpuMax !== null ? formatMillicores(v.cpuMax) : null,
          latest: v.cpuLatest !== null ? formatMillicores(v.cpuLatest) : null,
          minRaw: v.cpuMin,
          maxRaw: v.cpuMax,
          latestRaw: v.cpuLatest,
        },
        memory: {
          min: v.memoryMin !== null ? formatKiB(v.memoryMin) : null,
          max: v.memoryMax !== null ? formatKiB(v.memoryMax) : null,
          latest: v.memoryLatest !== null ? formatKiB(v.memoryLatest) : null,
          minRaw: v.memoryMin,
          maxRaw: v.memoryMax,
          latestRaw: v.memoryLatest,
        },
        updatedAt: v.updatedAt,
      };
    });
    await fse.writeJson(filePath, data, { spaces: 2 });
  } catch (error) {
    logger.error("Failed to persist pod usage stats", error);
  }
}

function parseCpuToMillicores(val: string): number | null {
  if (!val) return null;
  if (val.endsWith("m")) return parseFloat(val);
  const n = parseFloat(val);
  return isNaN(n) ? null : n * 1000;
}

function parseMemoryToKiB(val: string): number | null {
  if (!val) return null;
  if (val.endsWith("Ki")) return parseFloat(val);
  if (val.endsWith("Mi")) return parseFloat(val) * 1024;
  if (val.endsWith("Gi")) return parseFloat(val) * 1024 * 1024;
  if (val.endsWith("Ti")) return parseFloat(val) * 1024 * 1024 * 1024;
  if (val.endsWith("k") || val.endsWith("K")) return parseFloat(val);
  if (val.endsWith("M")) return parseFloat(val) * 1000;
  if (val.endsWith("G")) return parseFloat(val) * 1000 * 1000;
  const n = parseFloat(val);
  return isNaN(n) ? null : n / 1024;
}

function formatMillicores(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)}`;
  return `${Math.round(m)}m`;
}

function formatKiB(kib: number): string {
  if (kib >= 1024 * 1024) return `${(kib / (1024 * 1024)).toFixed(2)}Gi`;
  if (kib >= 1024) return `${(kib / 1024).toFixed(2)}Mi`;
  return `${Math.round(kib)}Ki`;
}
