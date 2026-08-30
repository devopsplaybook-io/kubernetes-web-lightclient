import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";
import { StatsDataGet, PodResourcesGet, PodUsageStatsGet } from "./StatsData";
import {
  RecommendationGenerate,
  RecommendationGetCached,
  RecommendationIsEnabled,
} from "./StatsDataRecommendation";

export class StatsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/nodes", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      return res.status(201).send({ stats: await StatsDataGet() });
    });

    fastify.get("/pod-resources", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      return res.status(201).send({ podResources: await PodResourcesGet() });
    });

    fastify.get("/pod-usage", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      return res.status(201).send({ podUsageStats: await PodUsageStatsGet() });
    });

    fastify.get("/recommendation", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      return res.status(201).send({
        enabled: RecommendationIsEnabled(),
        recommendation: await RecommendationGetCached(),
      });
    });

    fastify.post("/recommendation/regenerate", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!RecommendationIsEnabled()) {
        return res
          .status(400)
          .send({ error: "LLM recommendations are not enabled" });
      }
      await RecommendationGenerate();
      return res.status(201).send({
        enabled: true,
        recommendation: await RecommendationGetCached(),
      });
    });
  }
}
