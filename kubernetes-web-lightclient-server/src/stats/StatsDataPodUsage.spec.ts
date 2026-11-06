jest.mock("fs-extra", () => ({
  ensureDir: jest.fn(async () => {}),
  pathExists: jest.fn(async () => false),
  readJson: jest.fn(async () => ({})),
  writeJson: jest.fn(async () => {}),
}));

jest.mock("../OTelContext", () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return {
    OTelLogger: () => ({
      createModuleLogger: () => logger,
    }),
    OTelTracer: () => ({
      startSpan: () => ({ end: jest.fn(), setAttribute: jest.fn() }),
    }),
  };
});

const mockKubernetesCommand = jest.fn();

jest.mock("./StatsDataUtils", () => ({
  kubernetesCommand: (args: string[]) => mockKubernetesCommand(args),
}));

import * as fse from "fs-extra";
import type { Config } from "../Config";
import { OTelLogger } from "../OTelContext";
import {
  PodResourcesGet,
  PodResourcesGetEtag,
  PodUsageStatsGet,
  PodUsageStatsGetEtag,
  StatsDataPodUsageReconfigure,
  StatsDataPodUsageRunCapture,
  StatsDataPodUsageSetup,
} from "./StatsDataPodUsage";

const config = {
  DATA_DIR: "/tmp/test-data",
  POD_RESOURCES_FETCH_FREQUENCY: 1800,
} as unknown as Config;

const mockLogger = OTelLogger().createModuleLogger("test") as unknown as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

type Container = {
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
};

function container(resources: Container["resources"] = {}): Container {
  return { resources };
}

function pod(
  name: string | undefined,
  namespace: string | undefined,
  containers: Container[],
  nodeName = "node-a",
): unknown {
  return {
    metadata: { name, namespace },
    spec: { nodeName, containers },
  };
}

function setKubectl(pods: unknown, top: string | Error = ""): void {
  mockKubernetesCommand.mockImplementation(async (args: string[]) => {
    if (args[0] === "get" && args[1] === "pods") {
      return typeof pods === "string"
        ? pods
        : JSON.stringify({ items: pods as unknown[] });
    }
    if (args[0] === "top" && args[1] === "pods") {
      if (top instanceof Error) {
        throw top;
      }
      return top;
    }
    throw new Error(`Unexpected kubectl command: ${args.join(" ")}`);
  });
}

async function usageByName(): Promise<Record<string, any>> {
  const resources = await PodResourcesGet();
  return Object.fromEntries(resources.map((r) => [r.name, r]));
}

describe("StatsDataPodUsage", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (fse.ensureDir as jest.Mock).mockResolvedValue(undefined);
    (fse.pathExists as jest.Mock).mockResolvedValue(false);
    (fse.readJson as jest.Mock).mockResolvedValue({});
    (fse.writeJson as jest.Mock).mockResolvedValue(undefined);
    jest.useFakeTimers();
    await StatsDataPodUsageSetup(config);
    jest.clearAllTimers();
    // Reset the module-level resources/stats through one empty capture.
    setKubectl([], "");
    await StatsDataPodUsageRunCapture(config);
    jest.clearAllMocks();
    setKubectl([], "");
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("captures pod resources and usage", async () => {
    setKubectl(
      [
        pod("pod-a", "default", [
          container({
            requests: { cpu: "100m", memory: "128Mi" },
            limits: { cpu: "1", memory: "256Mi" },
          }),
        ]),
      ],
      "default pod-a 250m 64Mi\n",
    );

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
    setKubectl([]);
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

  test("setup loads a valid persisted map and reconfigure re-arms the interval", async () => {
    (fse.pathExists as jest.Mock).mockResolvedValue(true);
    (fse.readJson as jest.Mock).mockResolvedValue({
      "default/pod-a": {
        name: "pod-a",
        namespace: "default",
        node: "node-a",
        cpu: { minRaw: 100, maxRaw: 300, latestRaw: 200 },
        memory: { minRaw: 1024, maxRaw: 4096, latestRaw: 2048 },
        updatedAt: "2026-11-06T00:00:00.000Z",
      },
      "default/pod-b": {
        name: "pod-b",
        namespace: "default",
        node: "node-b",
        cpu: {},
        memory: {},
      },
    });

    await StatsDataPodUsageSetup(config);

    const stats = await PodUsageStatsGet();
    expect(stats).toHaveLength(2);
    const podA = stats.find((s) => s.name === "pod-a")!;
    expect(podA.cpuMin).toBe(100);
    expect(podA.cpuMax).toBe(300);
    expect(podA.cpuLatest).toBe(200);
    expect(podA.memoryLatest).toBe(2048);
    expect(podA.updatedAt.toISOString()).toBe("2026-11-06T00:00:00.000Z");
    const podB = stats.find((s) => s.name === "pod-b")!;
    expect(podB.cpuMin).toBeNull();
    expect(podB.updatedAt).toBeInstanceOf(Date);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Loaded 2 pod usage stats"),
    );

    // Reconfigure clears the previous interval and arms exactly one new one.
    StatsDataPodUsageReconfigure(config);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("starts empty when the persisted file is corrupt or unreadable", async () => {
    (fse.pathExists as jest.Mock).mockResolvedValue(true);

    (fse.readJson as jest.Mock).mockResolvedValue([]);
    await StatsDataPodUsageSetup(config);
    expect(await PodUsageStatsGet()).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("unexpected format"),
    );

    (fse.readJson as jest.Mock).mockResolvedValue({
      "default/bad": { name: "bad" },
      "default/ok": { name: "ok", namespace: "default" },
    });
    await StatsDataPodUsageSetup(config);
    expect((await PodUsageStatsGet()).map((s) => s.name)).toEqual(["ok"]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping corrupted pod entry: default/bad"),
    );

    (fse.readJson as jest.Mock).mockRejectedValue(new Error("disk error"));
    await StatsDataPodUsageSetup(config);
    expect(await PodUsageStatsGet()).toEqual([]);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to load pod usage stats from file",
      expect.any(Error),
    );
  });

  test("skips a capture that overlaps a still-running one", async () => {
    let resolvePods: (value: string) => void = () => {};
    mockKubernetesCommand.mockImplementation((args: string[]) => {
      if (args[0] === "get") {
        return new Promise<string>((resolve) => {
          resolvePods = resolve;
        });
      }
      return Promise.resolve("");
    });

    const first = StatsDataPodUsageRunCapture(config);
    const second = StatsDataPodUsageRunCapture(config);
    await second;

    expect(mockKubernetesCommand).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("previous capture still in progress"),
    );

    resolvePods(JSON.stringify({ items: [] }));
    await first;
  });

  test("does nothing when the pods payload has no items", async () => {
    setKubectl("{}");

    await StatsDataPodUsageRunCapture(config);

    expect(await PodResourcesGet()).toEqual([]);
    expect(await PodUsageStatsGet()).toEqual([]);
    expect(mockKubernetesCommand).toHaveBeenCalledTimes(1);
    expect(fse.writeJson).not.toHaveBeenCalled();
  });

  test("skips pods without a metadata name or namespace", async () => {
    setKubectl([
      pod(undefined, "default", []),
      pod("no-namespace", undefined, []),
      pod("good", "default", []),
    ]);

    await StatsDataPodUsageRunCapture(config);

    const resources = await PodResourcesGet();
    expect(resources.map((r) => r.name)).toEqual(["good"]);
    expect((await PodUsageStatsGet()).map((s) => s.name)).toEqual(["good"]);
  });

  test("aggregates requests and limits across containers", async () => {
    setKubectl([
      pod("multi", "default", [
        container({
          requests: { cpu: "100m", memory: "128Mi" },
          limits: { cpu: "0.5", memory: "1Gi" },
        }),
        container({
          requests: { cpu: "0.25", memory: "256Mi" },
          limits: { cpu: "1", memory: "512Ki" },
        }),
      ]),
    ]);

    await StatsDataPodUsageRunCapture(config);

    const resources = await usageByName();
    expect(resources["multi"].cpuRequest).toBe("350m");
    expect(resources["multi"].cpuLimit).toBe("1.50");
    expect(resources["multi"].memoryRequest).toBe("384.00Mi");
    expect(resources["multi"].memoryLimit).toBe("1.00Gi");
  });

  test("captures resources with null usage when kubectl top fails", async () => {
    setKubectl(
      [
        pod("pod-a", "default", [
          container({ requests: { cpu: "100m" }, limits: { cpu: "200m" } }),
        ]),
      ],
      new Error("metrics unavailable"),
    );
    const resourcesEtag = PodResourcesGetEtag();
    const usageEtag = PodUsageStatsGetEtag();

    await StatsDataPodUsageRunCapture(config);

    expect(PodResourcesGetEtag()).not.toBe(resourcesEtag);
    expect(PodUsageStatsGetEtag()).not.toBe(usageEtag);
    const resources = await usageByName();
    expect(resources["pod-a"].cpuUsage).toBeNull();
    expect(resources["pod-a"].memoryUsage).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to get pod usage via kubectl top",
      expect.any(Error),
    );
    const stats = await PodUsageStatsGet();
    expect(stats).toHaveLength(1);
    expect(stats[0].cpuLatest).toBeNull();
  });

  test("tracks min, max and latest usage and drops removed pods", async () => {
    let podsCall = 0;
    mockKubernetesCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === "get") {
        podsCall += 1;
        const items =
          podsCall === 1
            ? [pod("pod-a", "default", []), pod("pod-b", "default", [])]
            : [pod("pod-a", "default", [])];
        return JSON.stringify({ items });
      }
      if (args[0] === "top") {
        return podsCall === 1
          ? "default pod-a 250m 64Mi\ndefault pod-b 100m 32Mi\n"
          : "default pod-a 500m 128Mi\n";
      }
      throw new Error(`Unexpected kubectl command: ${args.join(" ")}`);
    });

    await StatsDataPodUsageRunCapture(config);
    let firstStats = await PodUsageStatsGet();
    expect(firstStats).toHaveLength(2);
    const podAFirst = firstStats.find((s) => s.name === "pod-a")!;
    expect(podAFirst.cpuMin).toBe(250);
    expect(podAFirst.cpuMax).toBe(250);
    expect(podAFirst.cpuLatest).toBe(250);
    expect(podAFirst.memoryLatest).toBe(64 * 1024);

    await StatsDataPodUsageRunCapture(config);
    const secondStats = await PodUsageStatsGet();
    expect(secondStats).toHaveLength(1);
    const podA = secondStats[0];
    expect(podA.name).toBe("pod-a");
    expect(podA.cpuMin).toBe(250);
    expect(podA.cpuMax).toBe(500);
    expect(podA.cpuLatest).toBe(500);
    expect(podA.memoryMin).toBe(64 * 1024);
    expect(podA.memoryMax).toBe(128 * 1024);
    expect(podA.memoryLatest).toBe(128 * 1024);
    expect((await PodResourcesGet()).map((r) => r.name)).toEqual(["pod-a"]);
  });

  test("logs a parse failure, keeps the etag and recovers on the next capture", async () => {
    setKubectl("{invalid-json");
    const resourcesEtag = PodResourcesGetEtag();
    const usageEtag = PodUsageStatsGetEtag();

    await StatsDataPodUsageRunCapture(config);

    expect(PodResourcesGetEtag()).toBe(resourcesEtag);
    expect(PodUsageStatsGetEtag()).toBe(usageEtag);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Error capturing pod resources",
      expect.any(Error),
      expect.anything(),
    );

    // The overlap guard must have been reset by the previous failure.
    setKubectl([pod("pod-a", "default", [])], "default pod-a 10m 1Mi\n");
    await StatsDataPodUsageRunCapture(config);
    expect(PodResourcesGetEtag()).not.toBe(resourcesEtag);
    expect((await PodResourcesGet()).map((r) => r.name)).toEqual(["pod-a"]);
  });

  test("logs a persist failure but still publishes the capture", async () => {
    setKubectl([pod("pod-a", "default", [])], "default pod-a 10m 1Mi\n");
    (fse.writeJson as jest.Mock).mockRejectedValue(new Error("disk full"));
    const usageEtag = PodUsageStatsGetEtag();

    await StatsDataPodUsageRunCapture(config);

    expect(PodUsageStatsGetEtag()).not.toBe(usageEtag);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to persist pod usage stats",
      expect.any(Error),
    );
  });

  test("parses and formats every supported quantity unit", async () => {
    setKubectl([
      pod("cpu-milli", "default", [
        container({ requests: { cpu: "500m" }, limits: { cpu: "0.5" } }),
      ]),
      pod("cpu-core", "default", [
        container({ requests: { cpu: "1" }, limits: { cpu: "1500m" } }),
      ]),
      pod("invalid-units", "default", [
        container({ requests: { cpu: "abc", memory: "abc" } }),
      ]),
      pod("mem-big", "default", [
        container({ requests: { memory: "1Gi" }, limits: { memory: "1Ti" } }),
      ]),
      pod("mem-meg", "default", [
        container({
          requests: { memory: "1000k" },
          limits: { memory: "1M" },
        }),
      ]),
      pod("mem-gig", "default", [
        container({ requests: { memory: "1G" } }),
      ]),
      pod("mem-raw", "default", [
        container({ requests: { memory: "2048" } }),
      ]),
      pod("mem-ki", "default", [
        container({ requests: { memory: "512Ki" }, limits: { memory: "1Mi" } }),
      ]),
    ]);

    await StatsDataPodUsageRunCapture(config);

    const resources = await usageByName();
    expect(resources["cpu-milli"].cpuRequest).toBe("500m");
    expect(resources["cpu-milli"].cpuLimit).toBe("500m");
    expect(resources["cpu-core"].cpuRequest).toBe("1.00");
    expect(resources["cpu-core"].cpuLimit).toBe("1.50");
    expect(resources["invalid-units"].cpuRequest).toBeNull();
    expect(resources["invalid-units"].cpuLimit).toBeNull();
    expect(resources["invalid-units"].memoryRequest).toBeNull();
    expect(resources["invalid-units"].memoryLimit).toBeNull();
    expect(resources["mem-big"].memoryRequest).toBe("1.00Gi");
    expect(resources["mem-big"].memoryLimit).toBe("1024.00Gi");
    expect(resources["mem-meg"].memoryRequest).toBe("1000Ki");
    expect(resources["mem-meg"].memoryLimit).toBe("1000Ki");
    expect(resources["mem-gig"].memoryRequest).toBe("976.56Mi");
    expect(resources["mem-raw"].memoryRequest).toBe("2Ki");
    expect(resources["mem-ki"].memoryRequest).toBe("512Ki");
    expect(resources["mem-ki"].memoryLimit).toBe("1.00Mi");
  });
});
