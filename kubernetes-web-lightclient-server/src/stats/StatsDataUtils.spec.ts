const mockExecuteRawCommand = jest.fn();

jest.mock("../kubectl/KubeCtlExecutor", () => ({
  KubeCtlExecutorGetInstance: () => ({
    executeRawCommand: (...args: unknown[]) => mockExecuteRawCommand(...args),
  }),
}));

import type { Config } from "../Config";
import { kubernetesCommand, StatsDataUtilsInit } from "./StatsDataUtils";

const PODS_ARGS = ["get", "pods", "-A", "-o", "json"];
const NODES_ARGS = ["get", "nodes", "-o", "json"];

const config = { STATS_FETCH_FREQUENCY: 60 } as unknown as Config;

describe("StatsDataUtils", () => {
  let now: number;

  beforeEach(() => {
    jest.clearAllMocks();
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    mockExecuteRawCommand.mockResolvedValue('{"items":[]}');
    StatsDataUtilsInit(config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("caches the pods list within the TTL", async () => {
    await expect(kubernetesCommand(PODS_ARGS)).resolves.toBe('{"items":[]}');
    now += 59_000;
    await expect(kubernetesCommand(PODS_ARGS)).resolves.toBe('{"items":[]}');
    expect(mockExecuteRawCommand).toHaveBeenCalledTimes(1);
  });

  test("refreshes the pods list after the TTL", async () => {
    await kubernetesCommand(PODS_ARGS);
    now += 60_001;
    await kubernetesCommand(PODS_ARGS);
    expect(mockExecuteRawCommand).toHaveBeenCalledTimes(2);
  });

  test("shares one in-flight pods fetch between concurrent callers", async () => {
    let release!: (value: string) => void;
    mockExecuteRawCommand.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    const first = kubernetesCommand(PODS_ARGS);
    const second = kubernetesCommand(PODS_ARGS);
    expect(mockExecuteRawCommand).toHaveBeenCalledTimes(1);

    release('{"items":[{"metadata":{"name":"p"}}]}');
    await expect(first).resolves.toBe('{"items":[{"metadata":{"name":"p"}}]}');
    await expect(second).resolves.toBe('{"items":[{"metadata":{"name":"p"}}]}');
  });

  test("clears the cache on failure so the next caller retries", async () => {
    mockExecuteRawCommand.mockRejectedValueOnce(new Error("kubectl boom"));
    await expect(kubernetesCommand(PODS_ARGS)).rejects.toThrow("kubectl boom");
    await new Promise((resolve) => setTimeout(resolve, 0));

    mockExecuteRawCommand.mockResolvedValueOnce('{"items":[]}');
    await expect(kubernetesCommand(PODS_ARGS)).resolves.toBe('{"items":[]}');
    expect(mockExecuteRawCommand).toHaveBeenCalledTimes(2);
  });

  test("does not cache commands other than the pods list", async () => {
    await kubernetesCommand(NODES_ARGS);
    await kubernetesCommand(NODES_ARGS);
    expect(mockExecuteRawCommand).toHaveBeenCalledTimes(2);
  });

  test("uses the configured fetch frequency for the TTL", async () => {
    StatsDataUtilsInit({
      STATS_FETCH_FREQUENCY: 10,
    } as unknown as Config);
    await kubernetesCommand(PODS_ARGS);
    now += 9_000;
    await kubernetesCommand(PODS_ARGS);
    expect(mockExecuteRawCommand).toHaveBeenCalledTimes(1);
    now += 2_000;
    await kubernetesCommand(PODS_ARGS);
    expect(mockExecuteRawCommand).toHaveBeenCalledTimes(2);
  });
});
