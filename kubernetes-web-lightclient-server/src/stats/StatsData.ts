import { Span } from "@opentelemetry/api";
import { Config } from "../Config";
import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import { SystemCommandExecute } from "../utils-std-ts/SystemCommand";

let stats: StatsNodeMesurement[] = [];
const logger = OTelLogger().createModuleLogger("StatsData");

export async function StatsDataInit(
  context: Span,
  config: Config
): Promise<void> {
  const executeStatsCapture = async () => {
    const span = OTelTracer().startSpan("StatsDataInit-Loop");
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
        observableResult.observe(stat.cpuUsage, { node: stat.node });
      });
    },
    { description: "CPU % Usage for each node" }
  );

  OTelMeter().createObservableGauge(
    "kubernetes.stats.nodes.memory",
    (observableResult) => {
      stats.forEach((stat) => {
        observableResult.observe(stat.memoryUsage, { node: stat.node });
      });
    },
    { description: "Memory % Usage for each node" }
  );

  OTelMeter().createObservableGauge(
    "kubernetes.stats.nodes.pods",
    (observableResult) => {
      stats.forEach((stat) => {
        observableResult.observe(stat.pods, { node: stat.node });
      });
    },
    { description: "Number of pod running on each node" }
  );

  setInterval(executeStatsCapture, config.STATS_FETCH_FREQUENCY * 1000);
}

export async function StatsDataGet(): Promise<StatsNodeMesurement[]> {
  return stats;
}

// Private Functions

async function StatsDataCapture(): Promise<void> {
  const nodesObj = JSON.parse(
    await kubernetesCommand(`kubectl get nodes -o json`)
  );

  if (!nodesObj.items) return;

  const podsObj = JSON.parse(
    await kubernetesCommand(`kubectl get pods --all-namespaces -o json`)
  );

  const timestamp = new Date();

  for (const node of nodesObj.items) {
    const nodeName = node.metadata.name;
    const measurement = new StatsNodeMesurement({
      node: nodeName,
      cpuUsage: 0,
      memoryUsage: 0,
      pods: 0,
      timestamp,
    });
    const topNodeStr = await kubernetesCommand(
      `kubectl top node ${nodeName} --no-headers`
    );
    const topNodeParts = topNodeStr.trim().split(/\s+/);
    if (topNodeParts.length < 5) {
      continue;
    }
    measurement.cpuUsage = parseFloat(topNodeParts[2].replace("%", ""));
    measurement.memoryUsage = parseFloat(topNodeParts[4].replace("%", ""));
    if (podsObj.items) {
      measurement.pods = podsObj.items.filter(
        (pod: { spec?: { nodeName?: string } }) =>
          pod.spec?.nodeName === nodeName
      ).length;
    }
    stats.push(measurement);
  }
}

export async function kubernetesCommand(command: string) {
  const commandOutput = await SystemCommandExecute(
    `${command} | gzip | base64 -w 0`,
    {
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 10,
    }
  );
  const binaryString = atob(commandOutput);
  const byteArray = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    byteArray[i] = binaryString.charCodeAt(i);
  }
  const decompressionStream = new DecompressionStream("gzip");
  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(byteArray);
      controller.close();
    },
  });
  const response = new Response(
    readableStream.pipeThrough(decompressionStream)
  );
  const arrayBuffer = await response.arrayBuffer();
  return new TextDecoder().decode(arrayBuffer);
}
