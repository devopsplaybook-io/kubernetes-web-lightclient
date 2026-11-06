import { FastifyInstance } from "fastify";
import { AuthGetLiveUser } from "@devopsplaybook.io/common-utils";
import { RequireAdmin, RequireScope } from "../auth/Authorization";
import {
  StatsDataGet,
  StatsDataGetEtag,
  PodResourcesGet,
  PodResourcesGetEtag,
  PodUsageStatsGet,
  PodUsageStatsGetEtag,
} from "./StatsData";
import {
  RecommendationGenerate,
  RecommendationGetCached,
  RecommendationIsEnabled,
  RecommendationIsGenerating,
} from "./StatsDataRecommendation";
import { BuildEtag, SendConditionalJson } from "./StatsEtag";

export class StatsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/nodes", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!(await RequireScope(req, res, "stats:read"))) {
        return;
      }
      return SendConditionalJson(req, res, StatsDataGetEtag(), async () => ({
        stats: await StatsDataGet(),
      }));
    });

    fastify.get("/pod-resources", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!(await RequireScope(req, res, "stats:read"))) {
        return;
      }
      return SendConditionalJson(req, res, PodResourcesGetEtag(), async () => ({
        podResources: await PodResourcesGet(),
      }));
    });

    fastify.get("/pod-usage", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!(await RequireScope(req, res, "stats:read"))) {
        return;
      }
      return SendConditionalJson(req, res, PodUsageStatsGetEtag(), async () => ({
        podUsageStats: await PodUsageStatsGet(),
      }));
    });

    fastify.get("/recommendation", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!(await RequireScope(req, res, "stats:read"))) {
        return;
      }
      const recommendation = await RecommendationGetCached();
      const enabled = RecommendationIsEnabled();
      const etag = BuildEtag(
        "recommendation",
        `${enabled ? "on" : "off"}-${recommendation?.generatedAt ?? "none"}`,
      );
      return SendConditionalJson(req, res, etag, () => ({
        enabled,
        recommendation,
      }));
    });

    fastify.post("/recommendation/regenerate", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!(await RequireAdmin(req, res))) {
        return;
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
