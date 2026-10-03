import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";
import { StatsDataGet, PodResourcesGet, PodUsageStatsGet } from "./StatsData";
import {
  RecommendationGenerate,
  RecommendationGetCached,
  RecommendationIsEnabled,
  RecommendationIsGenerating,
} from "./StatsDataRecommendation";

export class StatsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/nodes", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      return res.status(200).send({ stats: await StatsDataGet() });
    });

    fastify.get("/pod-resources", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      return res.status(200).send({ podResources: await PodResourcesGet() });
    });

    fastify.get("/pod-usage", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      return res.status(200).send({ podUsageStats: await PodUsageStatsGet() });
    });

    fastify.get("/recommendation", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      return res.status(200).send({
        enabled: RecommendationIsEnabled(),
        recommendation: await RecommendationGetCached(),
      });
    });

    fastify.post("/recommendation/regenerate", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!RecommendationIsEnabled()) {
        return res
          .status(400)
          .send({ error: "LLM recommendations are not enabled" });
      }
      if (RecommendationIsGenerating()) {
        return res.status(429).send({
          error: "A recommendation generation is already in progress",
        });
      }
      await RecommendationGenerate();
      return res.status(200).send({
        enabled: true,
        recommendation: await RecommendationGetCached(),
      });
    });
  }
}
