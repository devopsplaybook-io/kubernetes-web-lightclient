jest.mock("fs-extra", () => ({
  ensureDir: jest.fn(async () => {}),
  pathExists: jest.fn(async () => false),
  readJson: jest.fn(async () => ({})),
  writeJson: jest.fn(async () => {}),
}));

jest.mock("../OTelContext", () => ({
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  }),
  OTelTracer: () => ({
    startSpan: () => ({ end: jest.fn(), setAttribute: jest.fn() }),
  }),
}));

const mockKubernetesCommand = jest.fn();

jest.mock("./StatsDataUtils", () => ({
  kubernetesCommand: (args: string[]) => mockKubernetesCommand(args),
}));

import type { Config } from "../Config";
import {
  PodResourcesGet,
  PodResourcesGetEtag,
  PodUsageStatsGet,
  PodUsageStatsGetEtag,
  StatsDataPodUsageRunCapture,
} from "./StatsDataPodUsage";

const config = { DATA_DIR: "/tmp/test-data" } as unknown as Config;

function mockPodsAndTop() {
  mockKubernetesCommand.mockImplementation(async (args: string[]) => {
    if (args[0] === "get" && args[1] === "pods") {
      return JSON.stringify({
        items: [
          {
            metadata: { name: "pod-a", namespace: "default" },
            spec: {
              nodeName: "node-a",
              containers: [
                {
                  resources: {
                    requests: { cpu: "100m", memory: "128Mi" },
                    limits: { cpu: "1", memory: "256Mi" },
                  },
                },
              ],
            },
          },
        ],
      });
    }
    if (args[0] === "top" && args[1] === "pods") {
      return "default pod-a 250m 64Mi\n";
    }
    throw new Error(`Unexpected kubectl command: ${args.join(" ")}`);
  });
}

describe("StatsDataPodUsage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("captures pod resources and usage", async () => {
    mockPodsAndTop();

    await StatsDataPodUsageRunCapture(config);

    const resources = await PodResourcesGet();
    expect(resources).toHaveLength(1);
    expect(resources[0].name).toBe("pod-a");
    expect(resources[0].namespace).toBe("default");
    expect(resources[0].node).toBe("node-a");
    expect(resources[0].cpuRequest).toBe("100m");
    expect(resources[0].cpuLimit).toBe("1.00");
    expect(resources[0].memoryRequest).toBe("128.00Mi");
    expect(resources[0].memoryLimit).toBe("256.00Mi");
    expect(resources[0].cpuUsage).toBe("250m");
    expect(resources[0].memoryUsage).toBe("64Mi");

    const usage = await PodUsageStatsGet();
    expect(usage).toHaveLength(1);
    expect(usage[0].cpuLatest).toBe(250);
    expect(usage[0].memoryLatest).toBe(64 * 1024);
  });

  test("increments the capture version after a successful capture", async () => {
    mockPodsAndTop();
    const resourcesEtag = PodResourcesGetEtag();
    const usageEtag = PodUsageStatsGetEtag();

    await StatsDataPodUsageRunCapture(config);

    expect(PodResourcesGetEtag()).not.toBe(resourcesEtag);
    expect(PodUsageStatsGetEtag()).not.toBe(usageEtag);
  });

  test("keeps the capture version when kubectl fails", async () => {
    mockKubernetesCommand.mockRejectedValue(new Error("kubectl boom"));
    const resourcesEtag = PodResourcesGetEtag();
    const usageEtag = PodUsageStatsGetEtag();

    await StatsDataPodUsageRunCapture(config);

    expect(PodResourcesGetEtag()).toBe(resourcesEtag);
    expect(PodUsageStatsGetEtag()).toBe(usageEtag);
  });
});
