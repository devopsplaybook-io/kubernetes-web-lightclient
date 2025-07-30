import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import { Config } from "../Config";
import { Span } from "@opentelemetry/api";
import { Logger } from "../utils-std-ts/Logger";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { SystemCommandExecute } from "../utils-std-ts/SystemCommand";

let stats: StatsNodeMesurement[] = [];
const logger = new Logger("StatsData");

export async function StatsDataInit(
  context: Span,
  config: Config
): Promise<void> {
  const executeStatsCapture = async () => {
    try {
      const span = StandardTracerStartSpan("StatsDataInit-Loop");
      await StatsDataCapture();
      const cutoffTime = new Date(Date.now() - config.STATS_RETENTION * 1000);
      stats = stats.filter((stat) => stat.timestamp > cutoffTime);
      span.end();
    } catch (error) {
      logger.error(`Error capturing stats: ${error.message}`);
    }
  };
  await executeStatsCapture();
  setInterval(executeStatsCapture, config.STATS_FETCH_FREQUENCY * 1000);
}

export async function StatsDataGet(): Promise<StatsNodeMesurement[]> {
  return stats;
}

// Private Functions

async function StatsDataCapture(): Promise<void> {
  const nodesJsonStr = await kubernetesCommandJson(`kubectl get nodes`);
  const nodesObj = JSON.parse(nodesJsonStr);

  if (!nodesObj.items) return;

  const podsJsonStr = await kubernetesCommandJson(
    `kubectl get pods --all-namespaces`
  );
  const podsObj = JSON.parse(podsJsonStr);

  for (const node of nodesObj.items) {
    const nodeName = node.metadata?.name || "unknown";
    let cpuUsage = 0;
    let memoryUsage = 0;
    let diskUsage = 0;
    let pods = 0;
    const timestamp = new Date();

    try {
      const topNodeStr = await kubernetesCommandJson(
        `kubectl top node ${nodeName}`
      );
      const lines = topNodeStr.trim().split("\n");
      if (lines.length > 1) {
        const cols = lines[1].split(/\s+/);
        const cpuUsedMillicores = parseFloat(cols[1].replace("m", ""));
        const memoryUsedMi = parseFloat(cols[3].replace("Mi", ""));
        const allocatableCPU = node.status?.allocatable?.cpu;
        const allocatableMemory = node.status?.allocatable?.memory;
        let allocCPU = 0;
        if (allocatableCPU) {
          if (allocatableCPU.endsWith("m")) {
            allocCPU = parseFloat(allocatableCPU.replace("m", ""));
          } else {
            allocCPU = parseFloat(allocatableCPU) * 1000;
          }
        }
        cpuUsage = allocCPU ? (cpuUsedMillicores / allocCPU) * 100 : 0;
        let allocMem = 0;
        if (allocatableMemory) {
          if (allocatableMemory.endsWith("Ki")) {
            allocMem = parseFloat(allocatableMemory.replace("Ki", "")) / 1024;
          } else if (allocatableMemory.endsWith("Mi")) {
            allocMem = parseFloat(allocatableMemory.replace("Mi", ""));
          } else if (allocatableMemory.endsWith("Gi")) {
            allocMem = parseFloat(allocatableMemory.replace("Gi", "")) * 1024;
          }
        }
        memoryUsage = allocMem ? (memoryUsedMi / allocMem) * 100 : 0;
      }
    } catch (e) {
      logger.error(`Error fetching top node for ${nodeName}: ${e.message}`);
    }

    try {
      const describeNodeStr = await SystemCommandExecute(
        `kubectl describe node ${nodeName}`,
        {
          timeout: 20000,
          maxBuffer: 1024 * 1024 * 10,
        }
      );
      const match = describeNodeStr.match(
        /ephemeral-storage\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/
      );
      if (match) {
        const totalStr = match[1];
        const usedStr = match[2];
        function parseStorage(val: string): number {
          if (val.endsWith("Gi")) return parseFloat(val) * 1024;
          if (val.endsWith("Mi")) return parseFloat(val);
          if (val.endsWith("Ki")) return parseFloat(val) / 1024;
          return parseFloat(val);
        }
        const total = parseStorage(totalStr);
        const used = parseStorage(usedStr);
        diskUsage = total ? (used / total) * 100 : 0;
      }
    } catch (e) {
      logger.error(`Error fetching node details for ${nodeName}: ${e.message}`);
    }

    if (podsObj.items) {
      pods = podsObj.items.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pod: any) => pod.spec?.nodeName === nodeName
      ).length;
    }

    const measurement = new StatsNodeMesurement({
      node: nodeName,
      cpuUsage,
      memoryUsage,
      diskUsage,
      pods,
      timestamp,
    });

    stats.push(measurement);
  }
}

export async function kubernetesCommandJson(command: string) {
  const commandOutput = await SystemCommandExecute(
    `${command} -o json | gzip | base64 -w 0`,
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
