import { Span } from "@opentelemetry/api";
import { Config } from "../Config";
import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import { kubernetesCommand } from "./StatsDataUtils";

let stats: StatsNodeMesurement[] = [];
const logger = OTelLogger().createModuleLogger("StatsDataMetrics");

export async function StatsDataMetricsInit(
  context: Span,
  config: Config,
): Promise<void> {
  const executeStatsCapture = async () => {
    const span = OTelTracer().startSpan("StatsDataMetrics-Loop");
    try {
      await StatsDataCapture();
      const cutoffTime = new Date(Date.now() - config.STATS_RETENTION * 1000);
      stats = stats.filter((stat) => stat.timestamp > cutoffTime);
    } catch (error) {
      logger.error(`Error capturing stats`, error, span);
    }
    span.end();
  };
  await executeStatsCapture();

  OTelMeter().createObservableGauge(
    "kubernetes.stats.nodes.cpu",
    (observableResult) => {
      stats.forEach((stat) => {
        if (stat.cpuUsage !== null) {
          observableResult.observe(stat.cpuUsage, { node: stat.node });
        }
      });
    },
    { description: "CPU % Usage for each node" },
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
    { description: "Memory % Usage for each node" },
  );

  OTelMeter().createObservableGauge(
    "kubernetes.stats.nodes.pods",
    (observableResult) => {
      stats.forEach((stat) => {
        observableResult.observe(stat.pods, { node: stat.node });
      });
    },
    { description: "Number of pod running on each node" },
  );

  OTelMeter().createObservableGauge(
    "kubernetes.stats.nodes.pod_restarts",
    (observableResult) => {
      stats.forEach((stat) => {
        observableResult.observe(stat.podRestarts ?? 0, { node: stat.node });
      });
    },
    { description: "Number of pod restarts on each node" },
  );

  setInterval(executeStatsCapture, config.STATS_FETCH_FREQUENCY * 1000);
}

export async function StatsDataGet(): Promise<StatsNodeMesurement[]> {
  return stats;
}

// Private Functions

async function StatsDataCapture(): Promise<void> {
  const nodesObj = JSON.parse(
    await kubernetesCommand(`kubectl get nodes -o json`),
  );

  if (!nodesObj.items) return;

  const podsObj = JSON.parse(
    await kubernetesCommand(`kubectl get pods --all-namespaces -o json`),
  );

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
    try {
      const topNodeStr = await kubernetesCommand(
        `kubectl top node ${nodeName} --no-headers`,
      );
      const topNodeParts = topNodeStr.trim().split(/\s+/);
      if (topNodeParts.length >= 5) {
        measurement.cpuUsage = parseFloat(topNodeParts[2].replace("%", ""));
        measurement.memoryUsage = parseFloat(topNodeParts[4].replace("%", ""));
      }
    } catch (error) {
      logger.warn(
        `kubectl top node failed for ${nodeName} - metrics server may not be installed. CPU/memory usage will be reported as unknown.`,
      );
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
