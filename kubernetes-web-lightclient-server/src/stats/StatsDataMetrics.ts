import { randomUUID } from "node:crypto";
import { Config } from "../Config";
import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import {
  DownsampleStatsPerNode,
  STATS_MAX_POINTS_PER_NODE,
} from "./StatsDataDownsample";
import { BuildEtag } from "./StatsEtag";
import { kubernetesCommand } from "./StatsDataUtils";

let stats: StatsNodeMesurement[] = [];
let running = false;
let intervalHandle: NodeJS.Timeout | null = null;
const logger = OTelLogger().createModuleLogger("StatsDataMetrics");

// The etag must differ across restarts even when the version counters restart
// from zero, so every process gets its own nonce.
const instanceId = randomUUID();
let statsVersion = 0;
let downsampled: StatsNodeMesurement[] | null = null;
let downsampledVersion = -1;

/**
 * Register the observable gauges and arm the capture interval. The initial
 * capture is run separately (after the HTTP listener is up) so startup never
 * blocks on kubectl.
 */
export async function StatsDataMetricsSetup(config: Config): Promise<void> {
  OTelMeter().createObservableGauge(
    "kubernetes.stats.nodes.cpu",
    (observableResult) => {
      stats.forEach((stat) => {
        if (stat.cpuUsage !== null) {
          observableResult.observe(stat.cpuUsage, { node: stat.node });
        }
      });
    },
    "CPU % Usage for each node",
  );

  OTelMeter().createObservableGauge(
    "kubernetes.stats.nodes.memory",
    (observableResult) => {
      stats.forEach((stat) => {
        if (stat.memoryUsage !== null) {
          observableResult.observe(stat.memoryUsage, { node: stat.node });
        }
      });
    },
    "Memory % Usage for each node",
  );

  OTelMeter().createObservableGauge(
    "kubernetes.stats.nodes.pods",
    (observableResult) => {
      stats.forEach((stat) => {
        observableResult.observe(stat.pods, { node: stat.node });
      });
    },
    "Number of pod running on each node",
  );

  OTelMeter().createObservableGauge(
    "kubernetes.stats.nodes.pod_restarts",
    (observableResult) => {
      stats.forEach((stat) => {
        observableResult.observe(stat.podRestarts ?? 0, { node: stat.node });
      });
    },
    "Number of pod restarts on each node",
  );

  StatsDataMetricsReconfigure(config);
}

/**
 * (Re-)arm the capture interval, e.g. after a configuration reload.
 */
export function StatsDataMetricsReconfigure(config: Config): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }
  intervalHandle = setInterval(
    () => StatsDataMetricsRunCapture(config),
    config.STATS_FETCH_FREQUENCY * 1000,
  );
}

/**
 * Run one metrics capture. Guarded against overlap: a capture triggered
 * while the previous one is still running is skipped.
 */
export async function StatsDataMetricsRunCapture(config: Config): Promise<void> {
  await executeStatsCapture(config);
}

export async function StatsDataGet(): Promise<StatsNodeMesurement[]> {
  if (downsampledVersion !== statsVersion || !downsampled) {
    downsampled = DownsampleStatsPerNode(stats, STATS_MAX_POINTS_PER_NODE);
    downsampledVersion = statsVersion;
  }
  return downsampled;
}

/**
 * Entity tag of the current stats payload. It only changes when a capture
 * actually updated the data, so unchanged polls can be answered with 304.
 */
export function StatsDataGetEtag(): string {
  return BuildEtag("stats", `${instanceId}-${statsVersion}`);
}

// Private Functions

async function executeStatsCapture(config: Config): Promise<void> {
  if (running) {
    logger.warn("Stats capture skipped: previous capture still in progress");
    return;
  }
  running = true;
  const span = OTelTracer().startSpan("StatsDataMetrics-Loop");
  try {
    await StatsDataCapture();
    const cutoffTime = new Date(Date.now() - config.STATS_RETENTION * 1000);
    stats = stats.filter((stat) => stat.timestamp > cutoffTime);
    statsVersion += 1;
  } catch (error) {
    logger.error(`Error capturing stats`, error, span);
  } finally {
    running = false;
    span.end();
  }
}

async function StatsDataCapture(): Promise<void> {
  const nodesObj = JSON.parse(
    await kubernetesCommand(["get", "nodes", "-o", "json"]),
  );

  if (!nodesObj.items) return;

  const podsObj = JSON.parse(
    await kubernetesCommand(["get", "pods", "-A", "-o", "json"]),
  );

  // A single "top nodes" call replaces one "top node <name>" call per node
  const topNodes = new Map<string, { cpu: number; memory: number }>();
  try {
    const topNodesStr = await kubernetesCommand([
      "top",
      "nodes",
      "--no-headers",
    ]);
    for (const line of topNodesStr.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        topNodes.set(parts[0], {
          cpu: parseFloat(parts[2].replace("%", "")),
          memory: parseFloat(parts[4].replace("%", "")),
        });
      }
    }
  } catch {
    logger.warn(
      "kubectl top nodes failed - metrics server may not be installed. CPU/memory usage will be reported as unknown.",
    );
  }

  const timestamp = new Date();

  // Aggregate pods and restarts per node in a single pass instead of
  // filtering the whole pod list once (or twice) per node.
  const nodeAggregates = new Map<string, { pods: number; restarts: number }>();
  for (const pod of podsObj.items || []) {
    const podNodeName = pod.spec?.nodeName;
    if (!podNodeName) {
      continue;
    }
    const aggregate = nodeAggregates.get(podNodeName) || {
      pods: 0,
      restarts: 0,
    };
    aggregate.pods += 1;
    if (pod.status && pod.status.containerStatuses) {
      aggregate.restarts += pod.status.containerStatuses.reduce(
        (sum: number, containerStatus: { restartCount?: number }) =>
          sum + (containerStatus.restartCount || 0),
        0,
      );
    }
    nodeAggregates.set(podNodeName, aggregate);
  }

  for (const node of nodesObj.items) {
    const nodeName = node.metadata.name;
    const measurement = new StatsNodeMesurement({
      node: nodeName,
      cpuUsage: null,
      memoryUsage: null,
      pods: 0,
      timestamp,
      podRestarts: 0,
    });
    const top = topNodes.get(nodeName);
    if (top && !isNaN(top.cpu) && !isNaN(top.memory)) {
      measurement.cpuUsage = top.cpu;
      measurement.memoryUsage = top.memory;
    }
    const aggregate = nodeAggregates.get(nodeName);
    if (aggregate) {
      measurement.pods = aggregate.pods;
      measurement.podRestarts = aggregate.restarts;
    }
    stats.push(measurement);
  }
}
