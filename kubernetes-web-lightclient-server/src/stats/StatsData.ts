import { Span } from "@opentelemetry/api";
import { Config } from "../Config";
import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import { PodResourceMeasurement } from "../model/PodResourceMeasurement";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import { SystemCommandExecute } from "../utils-std-ts/SystemCommand";

let stats: StatsNodeMesurement[] = [];
let podResources: PodResourceMeasurement[] = [];
const logger = OTelLogger().createModuleLogger("StatsData");

export async function StatsDataInit(
  context: Span,
  config: Config,
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

  // Add observable gauge for pod restarts
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

  // Pod resources capture - runs less frequently (default: once per hour)
  const executePodResourcesCapture = async () => {
    const span = OTelTracer().startSpan("PodResourcesCapture-Loop");
    try {
      await PodResourcesCapture();
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

export async function StatsDataGet(): Promise<StatsNodeMesurement[]> {
  return stats;
}

export async function PodResourcesGet(): Promise<PodResourceMeasurement[]> {
  return podResources;
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

      // Calculate pod restarts for this node
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

async function PodResourcesCapture(): Promise<void> {
  const podsObj = JSON.parse(
    await kubernetesCommand(`kubectl get pods --all-namespaces -o json`),
  );

  if (!podsObj.items) return;

  // Get current usage via kubectl top pods
  let podUsageMap: Map<string, { cpu: string; memory: string }> = new Map();
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

  for (const pod of podsObj.items) {
    const podName = pod.metadata?.name;
    const namespace = pod.metadata?.namespace;
    const nodeName = pod.spec?.nodeName || "N/A";

    if (!podName || !namespace) continue;

    let cpuRequestMillicores: number | null = null;
    let cpuLimitMillicores: number | null = null;
    let memoryRequestKiB: number | null = null;
    let memoryLimitKiB: number | null = null;

    // Aggregate requests and limits from all containers by summing parsed values
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

    // Get usage from kubectl top pods
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
  }

  podResources = newPodResources;
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

export async function kubernetesCommand(command: string) {
  const commandOutput = await SystemCommandExecute(
    `${command} | gzip | base64 -w 0`,
    {
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 10,
    },
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
    readableStream.pipeThrough(decompressionStream),
  );
  const arrayBuffer = await response.arrayBuffer();
  return new TextDecoder().decode(arrayBuffer);
}
