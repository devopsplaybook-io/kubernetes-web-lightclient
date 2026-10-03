import { Span } from "@opentelemetry/api";
import { Config } from "../Config";
import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import { kubernetesCommand } from "./StatsDataUtils";

let stats: StatsNodeMesurement[] = [];
let running = false;
let intervalHandle: NodeJS.Timeout | null = null;
const logger = OTelLogger().createModuleLogger("StatsDataMetrics");

export async function StatsDataMetricsInit(
  context: Span,
  config: Config,
): Promise<void> {
  await executeStatsCapture(config);

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
    () => executeStatsCapture(config),
    config.STATS_FETCH_FREQUENCY * 1000,
  );
}

export async function StatsDataGet(): Promise<StatsNodeMesurement[]> {
  return stats;
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
    await kubernetesCommand(["get", "pods", "--all-namespaces", "-o", "json"]),
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
    if (podsObj.items) {
      measurement.pods = podsObj.items.filter(
        (pod: { spec?: { nodeName?: string } }) =>
          pod.spec?.nodeName === nodeName,
      ).length;

      measurement.podRestarts = podsObj.items
        .filter(
          (pod: { spec?: { nodeName?: string } }) =>
            pod.spec?.nodeName === nodeName,
        )
        .reduce((acc: number, pod: any) => {
          if (pod.status && pod.status.containerStatuses) {
            return (
              acc +
              pod.status.containerStatuses.reduce(
                (sum: number, cs: any) => sum + (cs.restartCount || 0),
                0,
              )
            );
          }
          return acc;
        }, 0);
    }
    stats.push(measurement);
  }
}
