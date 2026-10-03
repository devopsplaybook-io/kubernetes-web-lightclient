import { Span } from "@opentelemetry/sdk-trace-base";
import type { Config } from "../Config";

const mockSpan = {
  end: jest.fn(),
  setAttribute: jest.fn(),
};

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
    startSpan: () => mockSpan,
  }),
  OTelMeter: () => ({
    createObservableGauge: jest.fn(),
  }),
}));

const mockKubernetesCommand = jest.fn();

jest.mock("./StatsDataUtils", () => ({
  kubernetesCommand: (args: string[]) => mockKubernetesCommand(args),
}));

import { StatsDataGet, StatsDataMetricsInit } from "./StatsDataMetrics";

const config = {
  STATS_FETCH_FREQUENCY: 3600,
  STATS_RETENTION: 3600,
} as unknown as Config;

function countCommands(predicate: (args: string[]) => boolean): number {
  return mockKubernetesCommand.mock.calls.filter((call) =>
    predicate(call[0]),
  ).length;
}

describe("StatsDataMetrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Keep the reconfigured capture interval inert
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("captures all nodes from a single top nodes call", async () => {
    mockKubernetesCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === "get" && args[1] === "nodes") {
        return JSON.stringify({
          items: [
            { metadata: { name: "node-metrics-a" } },
            { metadata: { name: "node-metrics-b" } },
          ],
        });
      }
      if (args[0] === "get" && args[1] === "pods") {
        return JSON.stringify({
          items: [
            {
              spec: { nodeName: "node-metrics-a" },
              status: { containerStatuses: [{ restartCount: 2 }, { restartCount: 1 }] },
            },
            { spec: { nodeName: "node-metrics-a" }, status: {} },
            {
              spec: { nodeName: "node-metrics-b" },
              status: { containerStatuses: [{ restartCount: 5 }] },
            },
          ],
        });
      }
      if (args[0] === "top" && args[1] === "nodes") {
        return "node-metrics-a 500m 5% 1000Mi 10%\nnode-metrics-b 100m 2% 500Mi 3%\n";
      }
      throw new Error(`Unexpected kubectl command: ${args.join(" ")}`);
    });

    await StatsDataMetricsInit(mockSpan as unknown as Span, config);

    const topCalls = mockKubernetesCommand.mock.calls.filter(
      (call) => call[0][0] === "top",
    );
    expect(topCalls).toHaveLength(1);
    expect(topCalls[0][0]).toEqual(["top", "nodes", "--no-headers"]);

    const stats = await StatsDataGet();
    const nodeA = stats.find((s) => s.node === "node-metrics-a");
    expect(nodeA).toBeDefined();
    expect(nodeA?.cpuUsage).toBe(5);
    expect(nodeA?.memoryUsage).toBe(10);
    expect(nodeA?.pods).toBe(2);
    expect(nodeA?.podRestarts).toBe(3);

    const nodeB = stats.find((s) => s.node === "node-metrics-b");
    expect(nodeB).toBeDefined();
    expect(nodeB?.cpuUsage).toBe(2);
    expect(nodeB?.memoryUsage).toBe(3);
    expect(nodeB?.pods).toBe(1);
    expect(nodeB?.podRestarts).toBe(5);
  });

  test("reports null cpu/memory usage when metrics-server is unavailable", async () => {
    mockKubernetesCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === "top") {
        throw new Error("error: Metrics API not available");
      }
      if (args[0] === "get" && args[1] === "nodes") {
        return JSON.stringify({
          items: [{ metadata: { name: "node-no-metrics" } }],
        });
      }
      if (args[0] === "get" && args[1] === "pods") {
        return JSON.stringify({ items: [] });
      }
      throw new Error(`Unexpected kubectl command: ${args.join(" ")}`);
    });

    await StatsDataMetricsInit(mockSpan as unknown as Span, config);

    const node = (await StatsDataGet()).find(
      (s) => s.node === "node-no-metrics",
    );
    expect(node).toBeDefined();
    expect(node?.cpuUsage).toBeNull();
    expect(node?.memoryUsage).toBeNull();
    expect(node?.pods).toBe(0);
  });

  test("skips a capture while the previous one is still running", async () => {
    let releaseNodes!: (value: string) => void;
    const nodesPending = new Promise<string>((resolve) => {
      releaseNodes = resolve;
    });
    mockKubernetesCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === "get" && args[1] === "nodes") {
        return nodesPending;
      }
      if (args[0] === "get" && args[1] === "pods") {
        return JSON.stringify({ items: [] });
      }
      if (args[0] === "top") {
        return "";
      }
      throw new Error(`Unexpected kubectl command: ${args.join(" ")}`);
    });

    const firstInit = StatsDataMetricsInit(mockSpan as unknown as Span, config);
    const secondInit = StatsDataMetricsInit(
      mockSpan as unknown as Span,
      config,
    );
    await secondInit;

    // The overlapping capture was skipped: kubectl ran only once for nodes
    const getNodesCalls = () =>
      countCommands((args) => args[0] === "get" && args[1] === "nodes");
    expect(getNodesCalls()).toBe(1);
    expect(mockSpan.end).not.toHaveBeenCalled();

    releaseNodes(JSON.stringify({ items: [{ metadata: { name: "node-overlap" } }] }));
    await firstInit;

    expect(getNodesCalls()).toBe(1);
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
    expect((await StatsDataGet()).some((s) => s.node === "node-overlap")).toBe(
      true,
    );
  });

  test("releases the overlap guard and ends the span when a capture fails", async () => {
    mockKubernetesCommand.mockRejectedValue(new Error("kubectl boom"));

    await StatsDataMetricsInit(mockSpan as unknown as Span, config);
    expect(mockSpan.end).toHaveBeenCalledTimes(1);

    // The guard was released by the failed capture: a new capture can run
    mockKubernetesCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === "get" && args[1] === "nodes") {
        return JSON.stringify({
          items: [{ metadata: { name: "node-after-error" } }],
        });
      }
      if (args[0] === "get" && args[1] === "pods") {
        return JSON.stringify({ items: [] });
      }
      if (args[0] === "top") {
        return "";
      }
      throw new Error(`Unexpected kubectl command: ${args.join(" ")}`);
    });

    await StatsDataMetricsInit(mockSpan as unknown as Span, config);
    expect((await StatsDataGet()).some((s) => s.node === "node-after-error")).toBe(
      true,
    );
  });
});
