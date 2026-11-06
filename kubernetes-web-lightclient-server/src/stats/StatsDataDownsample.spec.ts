import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import {
  DownsampleStatsPerNode,
  STATS_MAX_POINTS_PER_NODE,
} from "./StatsDataDownsample";

function measurement(
  node: string,
  index: number,
  overrides: Partial<StatsNodeMesurement> = {},
): StatsNodeMesurement {
  return new StatsNodeMesurement({
    node,
    cpuUsage: index,
    memoryUsage: index,
    pods: index,
    timestamp: new Date(2026, 0, 1, 0, 0, index),
    podRestarts: index,
    ...overrides,
  });
}

function series(node: string, count: number): StatsNodeMesurement[] {
  return Array.from({ length: count }, (_, i) => measurement(node, i));
}

describe("DownsampleStatsPerNode", () => {
  test("returns an empty array for empty input", () => {
    expect(DownsampleStatsPerNode([])).toEqual([]);
    expect(DownsampleStatsPerNode(undefined as unknown as [])).toEqual([]);
  });

  test("keeps a group at or below the cap unchanged", () => {
    const input = series("node-a", 5);
    const result = DownsampleStatsPerNode(input, 5);
    expect(result).toHaveLength(5);
    expect(result.map((s) => s.timestamp.getTime())).toEqual(
      input.map((s) => s.timestamp.getTime()),
    );
  });

  test("caps a single node at 360 points by default", () => {
    const result = DownsampleStatsPerNode(series("node-a", 1000));
    expect(result.length).toBeLessThanOrEqual(STATS_MAX_POINTS_PER_NODE);
    expect(result.length).toBe(Math.ceil(1000 / STATS_MAX_POINTS_PER_NODE));
  });

  test("honours a custom cap", () => {
    const result = DownsampleStatsPerNode(series("node-a", 100), 10);
    expect(result).toHaveLength(10);
  });

  test("averages non-null usage values and reports null when all are null", () => {
    const input = [
      measurement("node-a", 1, { cpuUsage: 10, memoryUsage: null }),
      measurement("node-a", 2, { cpuUsage: 20, memoryUsage: null }),
      measurement("node-a", 3, { cpuUsage: 30, memoryUsage: 40 }),
      measurement("node-a", 4, { cpuUsage: null, memoryUsage: 60 }),
    ];
    const result = DownsampleStatsPerNode(input, 2);
    expect(result).toHaveLength(2);
    expect(result[0].cpuUsage).toBe(15);
    expect(result[0].memoryUsage).toBeNull();
    expect(result[1].cpuUsage).toBe(30);
    expect(result[1].memoryUsage).toBe(50);
  });

  test("reports null usage when every value in the bucket is null", () => {
    const input = [
      measurement("node-a", 1, { cpuUsage: null, memoryUsage: null }),
      measurement("node-a", 2, { cpuUsage: null, memoryUsage: null }),
      measurement("node-a", 3, { cpuUsage: null, memoryUsage: null }),
      measurement("node-a", 4, { cpuUsage: null, memoryUsage: null }),
    ];
    const result = DownsampleStatsPerNode(input, 2);
    expect(result[0].cpuUsage).toBeNull();
    expect(result[0].memoryUsage).toBeNull();
  });

  test("keeps the latest pods, restarts and timestamp of each bucket", () => {
    const input = series("node-a", 4);
    const result = DownsampleStatsPerNode(input, 2);
    expect(result).toHaveLength(2);
    expect(result[1].pods).toBe(input[3].pods);
    expect(result[1].podRestarts).toBe(input[3].podRestarts);
    expect(result[1].timestamp.getTime()).toBe(input[3].timestamp.getTime());
  });

  test("sorts each group ascending by timestamp", () => {
    const input = [
      measurement("node-a", 3),
      measurement("node-a", 1),
      measurement("node-a", 2),
    ];
    const result = DownsampleStatsPerNode(input, 10);
    const timestamps = result.map((s) => s.timestamp.getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  test("does not mutate the input", () => {
    const input = series("node-a", 100);
    const snapshot = input.map((s) => ({ ...s }));
    DownsampleStatsPerNode(input, 10);
    expect(input).toHaveLength(100);
    input.forEach((stat, index) => {
      expect(stat.cpuUsage).toBe(snapshot[index].cpuUsage);
      expect(stat.timestamp.getTime()).toBe(snapshot[index].timestamp.getTime());
    });
  });

  test("handles nodes independently", () => {
    const input = [...series("node-a", 400), ...series("node-b", 10)];
    const result = DownsampleStatsPerNode(input, 20);
    expect(result.filter((s) => s.node === "node-a")).toHaveLength(20);
    expect(result.filter((s) => s.node === "node-b")).toHaveLength(10);
  });
});
