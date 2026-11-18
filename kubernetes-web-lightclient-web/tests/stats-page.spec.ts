import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statsApiMocks = vi.hoisted(() => ({
  getNodes: vi.fn(),
  getPodResources: vi.fn(),
  getPodUsage: vi.fn(),
  getRecommendation: vi.fn(),
  regenerateRecommendation: vi.fn(),
}));

vi.mock("~~/services/StatsApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~~/services/StatsApi")>();
  return { ...actual, StatsApi: statsApiMocks };
});

vi.mock("vue3-apexcharts", () => ({
  default: { name: "apexchart", render: () => null },
}));

const currentUserMock = vi.hoisted(() => ({
  ensureLoaded: vi.fn(async () => {}),
  hasAdminScope: false,
  isAdmin: false,
}));

vi.mock("~~/stores/CurrentUserStore", () => ({
  CurrentUserStore: () => currentUserMock,
}));

import {
  POD_RESOURCES_REFRESH_INTERVAL_MS,
} from "~~/services/StatsApi";
import StatsPage from "../pages/kubernetes/stats.vue";

const methods = (StatsPage as any).methods;

const stat = (cpuUsage: number) => ({
  node: "node-a",
  timestamp: "2026-10-01T00:00:00Z",
  cpuUsage,
  memoryUsage: 10,
  pods: 3,
  podRestarts: 0,
});

function statsContext(overrides: Record<string, any> = {}) {
  return {
    stats: [],
    statsEtag: null,
    statsFingerprint: "",
    updateCharts: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  statsApiMocks.getNodes.mockReset();
  statsApiMocks.getPodResources.mockReset();
  statsApiMocks.getPodUsage.mockReset();
  statsApiMocks.getRecommendation.mockReset();
  statsApiMocks.regenerateRecommendation.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("stats page refreshStats", () => {
  it("does not touch state or rebuild charts on a 304", async () => {
    statsApiMocks.getNodes.mockResolvedValue({
      notModified: true,
      etag: '"stats-1"',
      data: null,
    });
    const ctx = statsContext();

    await methods.refreshStats.call(ctx);

    expect(ctx.stats).toEqual([]);
    expect(ctx.statsFingerprint).toBe("");
    expect(ctx.updateCharts).not.toHaveBeenCalled();
    expect(ctx.statsEtag).toBe('"stats-1"');
  });

  it("rebuilds charts only once when identical data is received twice", async () => {
    const data = { stats: [stat(1)] };
    statsApiMocks.getNodes.mockResolvedValue({
      notModified: false,
      etag: '"stats-1"',
      data,
    });
    const ctx = statsContext();

    await methods.refreshStats.call(ctx);
    await methods.refreshStats.call(ctx);

    expect(ctx.updateCharts).toHaveBeenCalledTimes(1);
    expect(ctx.stats).toEqual(data.stats);
  });

  it("rebuilds charts and stores the new etag when data changed", async () => {
    statsApiMocks.getNodes
      .mockResolvedValueOnce({
        notModified: false,
        etag: '"stats-1"',
        data: { stats: [stat(1)] },
      })
      .mockResolvedValueOnce({
        notModified: false,
        etag: '"stats-2"',
        data: { stats: [stat(2)] },
      });
    const ctx = statsContext();

    await methods.refreshStats.call(ctx);
    await methods.refreshStats.call(ctx);

    expect(ctx.updateCharts).toHaveBeenCalledTimes(2);
    expect(ctx.statsEtag).toBe('"stats-2"');
    expect(ctx.stats[0].cpuUsage).toBe(2);
  });
});

describe("stats page polling cadences", () => {
  function pollingContext(interval: string, overrides: Record<string, any> = {}) {
    return {
      refreshIntervalValue: interval,
      refreshIntervalId: null,
      podResourcesIntervalId: null,
      refreshStats: vi.fn(),
      refreshPodUsageStats: vi.fn(),
      refreshPodResources: vi.fn(),
      refreshRecommendation: vi.fn(),
      ...overrides,
    };
  }

  it("polls live stats at the refresh interval and pod resources at 30 minutes", () => {
    vi.useFakeTimers();
    const ctx = pollingContext("10000");

    methods.startPolling.call(ctx);

    vi.advanceTimersByTime(10000);
    expect(ctx.refreshStats).toHaveBeenCalledTimes(1);
    expect(ctx.refreshPodUsageStats).toHaveBeenCalledTimes(1);
    expect(ctx.refreshPodResources).not.toHaveBeenCalled();
    expect(ctx.refreshRecommendation).not.toHaveBeenCalled();

    vi.advanceTimersByTime(POD_RESOURCES_REFRESH_INTERVAL_MS - 10000);
    expect(ctx.refreshPodResources).toHaveBeenCalledTimes(1);
    expect(ctx.refreshRecommendation).not.toHaveBeenCalled();
  });

  it("stops every timer with stopPolling", () => {
    vi.useFakeTimers();
    const ctx = pollingContext("10000");

    methods.startPolling.call(ctx);
    vi.advanceTimersByTime(10000);
    const callsBeforeStop = ctx.refreshStats.mock.calls.length;

    methods.stopPolling.call(ctx);
    expect(ctx.refreshIntervalId).toBeNull();
    expect(ctx.podResourcesIntervalId).toBeNull();

    vi.advanceTimersByTime(POD_RESOURCES_REFRESH_INTERVAL_MS);
    expect(ctx.refreshStats.mock.calls.length).toBe(callsBeforeStop);
    expect(ctx.refreshPodResources).not.toHaveBeenCalled();
  });

  it("arms no timer when auto-refresh is disabled", () => {
    vi.useFakeTimers();
    const ctx = pollingContext("0");

    methods.startPolling.call(ctx);
    expect(ctx.refreshIntervalId).toBeNull();
    expect(ctx.podResourcesIntervalId).toBeNull();

    vi.advanceTimersByTime(POD_RESOURCES_REFRESH_INTERVAL_MS);
    expect(ctx.refreshStats).not.toHaveBeenCalled();
    expect(ctx.refreshPodUsageStats).not.toHaveBeenCalled();
    expect(ctx.refreshPodResources).not.toHaveBeenCalled();
    expect(ctx.refreshRecommendation).not.toHaveBeenCalled();
  });
});

function forbidden(url: string): unknown {
  return {
    isAxiosError: true,
    message: "Request failed with status code 403",
    config: { url, data: {} },
    response: { status: 403, data: { error: "Forbidden" } },
  };
}

describe("stats page permission awareness", () => {
  it("records the missing stats scope and stops polling on a 403", async () => {
    statsApiMocks.getNodes.mockRejectedValue(forbidden("/api/stats/nodes"));
    const ctx = statsContext({
      accessError: null,
      stopPolling: vi.fn(),
      handleAccessError: methods.handleAccessError,
    });

    await methods.refreshStats.call(ctx);

    expect(ctx.accessError).toEqual({
      scope: "stats:read",
      title: "Missing scope",
      message: expect.stringContaining("stats:read"),
    });
    expect(ctx.stopPolling).toHaveBeenCalledTimes(1);
  });

  it("leaves non-403 failures to the generic handler", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    statsApiMocks.getNodes.mockRejectedValue(new Error("network down"));
    const ctx = statsContext({
      accessError: null,
      stopPolling: vi.fn(),
      handleAccessError: methods.handleAccessError,
    });

    await methods.refreshStats.call(ctx);

    expect(ctx.accessError).toBeNull();
    expect(ctx.stopPolling).not.toHaveBeenCalled();
  });

  it("classifies only 403s in handleAccessError", () => {
    const ctx = { accessError: null as any, stopPolling: vi.fn() };

    expect(methods.handleAccessError.call(ctx, forbidden("/api/stats/nodes"))).toBe(
      true,
    );
    expect(ctx.accessError.scope).toBe("stats:read");
    expect(ctx.stopPolling).toHaveBeenCalledTimes(1);

    expect(
      methods.handleAccessError.call(ctx, forbidden("/api/stats/recommendation/regenerate")),
    ).toBe(true);
    expect(ctx.accessError.scope).toBe("admin");

    expect(methods.handleAccessError.call(ctx, new Error("boom"))).toBe(false);
    expect(ctx.stopPolling).toHaveBeenCalledTimes(2);
  });

  it("retries every dataset, refreshes the live user and restarts polling", async () => {
    currentUserMock.ensureLoaded.mockClear();
    const ctx = {
      accessError: { scope: "stats:read" } as any,
      refreshStats: vi.fn(),
      refreshPodResources: vi.fn(),
      refreshPodUsageStats: vi.fn(),
      refreshRecommendation: vi.fn(),
      startPolling: vi.fn(),
    };

    await methods.retryAccess.call(ctx);

    expect(ctx.accessError).toBeNull();
    expect(currentUserMock.ensureLoaded).toHaveBeenCalledWith(true);
    expect(ctx.refreshStats).toHaveBeenCalledTimes(1);
    expect(ctx.refreshPodResources).toHaveBeenCalledTimes(1);
    expect(ctx.refreshPodUsageStats).toHaveBeenCalledTimes(1);
    expect(ctx.refreshRecommendation).toHaveBeenCalledTimes(1);
    expect(ctx.startPolling).toHaveBeenCalledTimes(1);
  });
});

describe("stats page admin actions", () => {
  const canRegenerate = (StatsPage as any).computed.canRegenerate;

  it("only offers regeneration to holders of the admin scope", () => {
    expect(
      canRegenerate.call({ currentUserStore: { hasAdminScope: false } }),
    ).toBe(false);
    expect(
      canRegenerate.call({ currentUserStore: { hasAdminScope: true } }),
    ).toBe(true);
  });
});
