import type { Span } from "@opentelemetry/api";
import type { Config } from "../Config";

const mockUtilsInit = jest.fn();
const mockMetricsSetup = jest.fn();
const mockMetricsRun = jest.fn(async (..._args: unknown[]) => {});
const mockMetricsReconfigure = jest.fn();
const mockPodUsageSetup = jest.fn(async (..._args: unknown[]) => {});
const mockPodUsageRun = jest.fn(async (..._args: unknown[]) => {});
const mockPodUsageReconfigure = jest.fn();

jest.mock("./StatsDataUtils", () => ({
  StatsDataUtilsInit: (...args: unknown[]) => mockUtilsInit(...args),
  kubernetesCommand: jest.fn(async () => "{}"),
}));

jest.mock("./StatsDataMetrics", () => ({
  StatsDataMetricsSetup: (...args: unknown[]) => mockMetricsSetup(...args),
  StatsDataMetricsRunCapture: (...args: unknown[]) => mockMetricsRun(...args),
  StatsDataMetricsReconfigure: (...args: unknown[]) =>
    mockMetricsReconfigure(...args),
  StatsDataGet: jest.fn(async () => []),
}));

jest.mock("./StatsDataPodUsage", () => ({
  StatsDataPodUsageSetup: (...args: unknown[]) => mockPodUsageSetup(...args),
  StatsDataPodUsageRunCapture: (...args: unknown[]) => mockPodUsageRun(...args),
  StatsDataPodUsageReconfigure: (...args: unknown[]) =>
    mockPodUsageReconfigure(...args),
  PodResourcesGet: jest.fn(async () => []),
  PodUsageStatsGet: jest.fn(async () => []),
}));

import {
  StatsDataInit,
  StatsDataIsReady,
  StatsDataReconfigure,
  StatsDataStartInitialCapture,
} from "./StatsData";

const config = { STATS_FETCH_FREQUENCY: 60 } as unknown as Config;
const span = {} as unknown as Span;

describe("StatsData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("Init only sets up state and never runs kubectl captures", async () => {
    await StatsDataInit(span, config);

    expect(mockUtilsInit).toHaveBeenCalledWith(config);
    expect(mockMetricsSetup).toHaveBeenCalledWith(config);
    expect(mockPodUsageSetup).toHaveBeenCalledWith(config);
    expect(mockMetricsRun).not.toHaveBeenCalled();
    expect(mockPodUsageRun).not.toHaveBeenCalled();
    expect(StatsDataIsReady()).toBe(false);
  });

  test("StartInitialCapture runs both captures and releases readiness", async () => {
    await StatsDataInit(span, config);
    await StatsDataStartInitialCapture(config);

    expect(mockMetricsRun).toHaveBeenCalledWith(config);
    expect(mockPodUsageRun).toHaveBeenCalledWith(config);
    expect(StatsDataIsReady()).toBe(true);
  });

  test("StartInitialCapture is idempotent per init", async () => {
    await StatsDataInit(span, config);
    const first = StatsDataStartInitialCapture(config);
    const second = StatsDataStartInitialCapture(config);

    expect(first).toBe(second);
    await first;
    expect(mockMetricsRun).toHaveBeenCalledTimes(1);
    expect(mockPodUsageRun).toHaveBeenCalledTimes(1);
  });

  test("releases readiness after the deadline when captures are slow", async () => {
    jest.useFakeTimers();
    await StatsDataInit(span, config);

    mockMetricsRun.mockReturnValue(new Promise<void>(() => {}));
    mockPodUsageRun.mockReturnValue(new Promise<void>(() => {}));

    const pending = StatsDataStartInitialCapture(config);
    expect(StatsDataIsReady()).toBe(false);

    jest.advanceTimersByTime(5000);
    await pending;
    expect(StatsDataIsReady()).toBe(true);
  });

  test("Reconfigure refreshes the snapshot TTL before re-arming the loops", async () => {
    await StatsDataInit(span, config);
    StatsDataReconfigure(config);

    expect(mockUtilsInit).toHaveBeenCalledTimes(2);
    expect(mockMetricsReconfigure).toHaveBeenCalledWith(config);
    expect(mockPodUsageReconfigure).toHaveBeenCalledWith(config);
    expect(mockUtilsInit.mock.invocationCallOrder[1]).toBeLessThan(
      mockMetricsReconfigure.mock.invocationCallOrder[0],
    );
  });
});
