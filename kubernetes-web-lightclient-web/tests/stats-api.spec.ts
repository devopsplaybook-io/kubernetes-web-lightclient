import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const axiosGet = vi.hoisted(() => vi.fn());
const axiosPost = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({
  default: {
    get: (...args: unknown[]) => axiosGet(...args),
    post: (...args: unknown[]) => axiosPost(...args),
  },
}));

vi.mock("~~/services/Config.ts", () => ({
  default: { get: vi.fn(async () => ({ SERVER_URL: "/api" })) },
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: {
    getAuthHeader: vi.fn(async () => ({
      headers: { Authorization: "Bearer test-token" },
    })),
  },
}));

import {
  BuildStatsFingerprint,
  StatsApi,
} from "~~/services/StatsApi";

beforeEach(() => {
  axiosGet.mockReset();
  axiosPost.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("StatsApi conditional GETs", () => {
  it("sends no If-None-Match header without an etag", async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      headers: { etag: '"stats-1"' },
      data: { stats: [{ node: "a" }] },
    });

    const result = await StatsApi.getNodes(null);

    expect(axiosGet).toHaveBeenCalledTimes(1);
    const [url, config] = axiosGet.mock.calls[0];
    expect(url).toBe("/api/stats/nodes");
    expect(config.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(result).toEqual({
      notModified: false,
      etag: '"stats-1"',
      data: { stats: [{ node: "a" }] },
    });
  });

  it("sends If-None-Match when an etag exists", async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      headers: {},
      data: { podResources: [] },
    });

    await StatsApi.getPodResources('"pod-resources-1"');

    const [, config] = axiosGet.mock.calls[0];
    expect(config.headers).toEqual({
      Authorization: "Bearer test-token",
      "If-None-Match": '"pod-resources-1"',
    });
  });

  it("accepts a 304 and reports notModified without data", async () => {
    axiosGet.mockResolvedValue({
      status: 304,
      headers: { etag: '"stats-1"' },
      data: "",
    });

    const result = await StatsApi.getNodes('"stats-1"');

    expect(result).toEqual({
      notModified: true,
      etag: '"stats-1"',
      data: null,
    });
    const [, config] = axiosGet.mock.calls[0];
    expect(config.validateStatus(304)).toBe(true);
    expect(config.validateStatus(200)).toBe(true);
    expect(config.validateStatus(500)).toBe(false);
  });

  it("falls back to the request etag when a 304 has no ETag header", async () => {
    axiosGet.mockResolvedValue({ status: 304, headers: {}, data: "" });

    const result = await StatsApi.getPodUsage('"pod-usage-1"');

    expect(result.notModified).toBe(true);
    expect(result.etag).toBe('"pod-usage-1"');
  });

  it("propagates request errors to the caller", async () => {
    axiosGet.mockRejectedValue(new Error("boom"));

    await expect(StatsApi.getRecommendation(null)).rejects.toThrow("boom");
  });

  it("regenerates a recommendation through the POST endpoint", async () => {
    axiosPost.mockResolvedValue({
      data: { enabled: true, recommendation: { analysis: "a" } },
    });

    const result = await StatsApi.regenerateRecommendation();

    expect(axiosPost).toHaveBeenCalledWith(
      "/api/stats/recommendation/regenerate",
      {},
      { headers: { Authorization: "Bearer test-token" } },
    );
    expect(result.recommendation.analysis).toBe("a");
  });
});

describe("BuildStatsFingerprint", () => {
  const stats = [
    {
      node: "a",
      timestamp: "2026-10-01T00:00:00Z",
      cpuUsage: 1,
      memoryUsage: 2,
      pods: 3,
      podRestarts: 4,
    },
  ];

  it("is stable for identical data", () => {
    expect(BuildStatsFingerprint(stats)).toBe(
      BuildStatsFingerprint(JSON.parse(JSON.stringify(stats))),
    );
  });

  it("changes when the data changes", () => {
    const changed = [{ ...stats[0], cpuUsage: 5 }];
    expect(BuildStatsFingerprint(changed)).not.toBe(
      BuildStatsFingerprint(stats),
    );
  });

  it("handles an empty list", () => {
    expect(BuildStatsFingerprint([])).toBe("[]");
    expect(BuildStatsFingerprint(undefined as any)).toBe("[]");
  });
});
