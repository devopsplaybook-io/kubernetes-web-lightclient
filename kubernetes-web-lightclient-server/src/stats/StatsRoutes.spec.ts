import Fastify from "fastify";
import { StatsRoutes } from "./StatsRoutes";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  AuthGetUserSession: jest.fn(),
}));

const mockStatsDataGet = jest.fn(async () => []);
const mockPodResourcesGet = jest.fn(async () => []);
const mockPodUsageStatsGet = jest.fn(async () => []);

jest.mock("./StatsData", () => ({
  StatsDataGet: () => mockStatsDataGet(),
  PodResourcesGet: () => mockPodResourcesGet(),
  PodUsageStatsGet: () => mockPodUsageStatsGet(),
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

import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";

const authMock = AuthGetUserSession as unknown as jest.Mock;

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
    authMock.mockResolvedValue({
      isAuthenticated: true,
      userId: "11111111-1111-4111-8111-111111111111",
    });
    mockRecommendationIsEnabled.mockReturnValue(true);
    mockRecommendationIsGenerating.mockReturnValue(false);
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
    authMock.mockResolvedValue({ isAuthenticated: false });
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
    authMock.mockResolvedValue({ isAuthenticated: false });
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
});
