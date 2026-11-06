import Fastify from "fastify";
import { StatsRoutes } from "./StatsRoutes";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  AuthGetLiveUser: jest.fn(),
  AuthHasScope: jest.fn(async () => {}),
}));

const mockStatsDataGet = jest.fn(async () => []);
const mockPodResourcesGet = jest.fn(async () => []);
const mockPodUsageStatsGet = jest.fn(async () => []);
const mockStatsDataGetEtag = jest.fn(() => '"stats-test"');
const mockPodResourcesGetEtag = jest.fn(() => '"pod-resources-test"');
const mockPodUsageStatsGetEtag = jest.fn(() => '"pod-usage-test"');

jest.mock("./StatsData", () => ({
  StatsDataGet: () => mockStatsDataGet(),
  PodResourcesGet: () => mockPodResourcesGet(),
  PodUsageStatsGet: () => mockPodUsageStatsGet(),
  StatsDataGetEtag: () => mockStatsDataGetEtag(),
  PodResourcesGetEtag: () => mockPodResourcesGetEtag(),
  PodUsageStatsGetEtag: () => mockPodUsageStatsGetEtag(),
}));

const mockRecommendationGenerate = jest.fn(async () => {});
const mockRecommendationGetCached = jest.fn(async () => null);
const mockRecommendationIsEnabled = jest.fn(() => true);
const mockRecommendationIsGenerating = jest.fn(() => false);

jest.mock("./StatsDataRecommendation", () => ({
  RecommendationGenerate: () => mockRecommendationGenerate(),
  RecommendationGetCached: () => mockRecommendationGetCached(),
  RecommendationIsEnabled: () => mockRecommendationIsEnabled(),
  RecommendationIsGenerating: () => mockRecommendationIsGenerating(),
}));

import { AuthGetLiveUser } from "@devopsplaybook.io/common-utils";

const authMock = AuthGetLiveUser as unknown as jest.Mock;

function buildApp(): ReturnType<typeof Fastify> {
  const app = Fastify();
  const routes = new StatsRoutes();
  app.register(routes.getRoutes.bind(routes), { prefix: "/api/stats" });
  return app;
}

describe("StatsRoutes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    mockRecommendationIsEnabled.mockReturnValue(true);
    mockRecommendationIsGenerating.mockReturnValue(false);
    mockRecommendationGetCached.mockResolvedValue(null);
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test.each([
    "/api/stats/nodes",
    "/api/stats/pod-resources",
    "/api/stats/pod-usage",
    "/api/stats/recommendation",
  ])("GET %s returns 401 when unauthenticated", async (url) => {
    authMock.mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });

  test.each([
    "/api/stats/nodes",
    "/api/stats/pod-resources",
    "/api/stats/pod-usage",
    "/api/stats/recommendation",
  ])("GET %s returns 200 when authenticated", async (url) => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
  });

  test("POST regenerate returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/stats/recommendation/regenerate",
    });
    expect(res.statusCode).toBe(401);
  });

  test("POST regenerate returns 400 when recommendations are disabled", async () => {
    mockRecommendationIsEnabled.mockReturnValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/stats/recommendation/regenerate",
    });
    expect(res.statusCode).toBe(400);
  });

  test("POST regenerate returns 429 while a generation is in flight", async () => {
    mockRecommendationIsGenerating.mockReturnValue(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/stats/recommendation/regenerate",
    });
    expect(res.statusCode).toBe(429);
    expect(mockRecommendationGenerate).not.toHaveBeenCalled();
  });

  test("POST regenerate returns 200 with the cached recommendation", async () => {
    mockRecommendationGetCached.mockResolvedValue({
      generatedAt: "2026-10-01T00:00:00.000Z",
      analysis: "analysis",
      recommendations: "recommendations",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/stats/recommendation/regenerate",
    });
    expect(res.statusCode).toBe(200);
    expect(mockRecommendationGenerate).toHaveBeenCalledTimes(1);
    expect(res.json().recommendation.analysis).toBe("analysis");
  });

  describe("conditional GETs", () => {
    const conditionalCases = [
      {
        url: "/api/stats/nodes",
        etag: '"stats-test"',
        payloadGetter: mockStatsDataGet,
      },
      {
        url: "/api/stats/pod-resources",
        etag: '"pod-resources-test"',
        payloadGetter: mockPodResourcesGet,
      },
      {
        url: "/api/stats/pod-usage",
        etag: '"pod-usage-test"',
        payloadGetter: mockPodUsageStatsGet,
      },
    ];

    test.each(conditionalCases)(
      "GET $url returns an ETag, a 304 on a match and 200 on a mismatch",
      async ({ url, etag, payloadGetter }) => {
        const first = await app.inject({ method: "GET", url });
        expect(first.statusCode).toBe(200);
        expect(first.headers.etag).toBe(etag);
        expect(first.headers["cache-control"]).toBe("private, no-cache");

        const callsAfterFirst = payloadGetter.mock.calls.length;
        const second = await app.inject({
          method: "GET",
          url,
          headers: { "if-none-match": etag },
        });
        expect(second.statusCode).toBe(304);
        expect(second.body).toBe("");
        expect(payloadGetter.mock.calls.length).toBe(callsAfterFirst);

        const wildcard = await app.inject({
          method: "GET",
          url,
          headers: { "if-none-match": "*" },
        });
        expect(wildcard.statusCode).toBe(304);

        const mismatch = await app.inject({
          method: "GET",
          url,
          headers: { "if-none-match": '"other-etag"' },
        });
        expect(mismatch.statusCode).toBe(200);
      },
    );

    test("GET /api/stats/recommendation supports conditional requests", async () => {
      const first = await app.inject({
        method: "GET",
        url: "/api/stats/recommendation",
      });
      expect(first.statusCode).toBe(200);
      expect(first.headers.etag).toBe('"recommendation-on-none"');
      expect(first.headers["cache-control"]).toBe("private, no-cache");

      const cached = await app.inject({
        method: "GET",
        url: "/api/stats/recommendation",
        headers: { "if-none-match": '"recommendation-on-none"' },
      });
      expect(cached.statusCode).toBe(304);
      expect(cached.body).toBe("");

      const wildcard = await app.inject({
        method: "GET",
        url: "/api/stats/recommendation",
        headers: { "if-none-match": "*" },
      });
      expect(wildcard.statusCode).toBe(304);

      const mismatch = await app.inject({
        method: "GET",
        url: "/api/stats/recommendation",
        headers: { "if-none-match": '"recommendation-old"' },
      });
      expect(mismatch.statusCode).toBe(200);
    });

    test("auth is still evaluated before the 304 shortcut", async () => {
      authMock.mockResolvedValue(null);
      const res = await app.inject({
        method: "GET",
        url: "/api/stats/nodes",
        headers: { "if-none-match": "*" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
