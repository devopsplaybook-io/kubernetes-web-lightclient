import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";
import { OTelLogger } from "../OTelContext";
import { KubeCache } from "./KubeCache";
import { KubeCtlExecutorGetInstance } from "../kubectl/KubeCtlExecutor";

const logger = OTelLogger().createModuleLogger("KubeResourceRoutes");

export class KubeResourceRoutes {
  private cache: KubeCache;

  constructor(cache: KubeCache) {
    this.cache = cache;
  }

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // GET /api/resources/data/:type - Get cached resource data for a type
    // Uses stale-while-revalidate pattern
    interface GetResourceData extends RequestGenericInterface {
      Params: {
        type: string;
      };
      Querystring: {
        force?: string;
      };
    }

    fastify.get<GetResourceData>("/data/:type", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const { type } = req.params;
      const force = req.query.force === "true";
      if (!type || type.indexOf(" ") >= 0) {
        return res.status(400).send({ error: "Invalid resource type" });
      }

      logger.info(
        `Resource data requested: ${type}${force ? " (forced)" : ""}`,
      );

      // If force=true, invalidate the cache before fetching
      if (force) {
        await this.cache.clear(type);
      }

      // Check cache first
      const cachedEntry = await this.cache.get(type);

      if (cachedEntry) {
        // Cache exists - check if stale
        const stale = await this.cache.isStale(type);

        if (stale) {
          // Return stale data immediately, trigger background refresh
          logger.info(
            `Cache stale for ${type}, returning cached data + background refresh`,
          );

          // Fire-and-forget background refresh
          this.refreshInBackground(type).catch((error) => {
            logger.error(
              `Background refresh failed for ${type}: ${error.message}`,
              error,
            );
          });

          return res.status(200).send({
            data: cachedEntry.data,
            cachedAt: cachedEntry.cachedAt,
            status: "stale",
          });
        }

        // Cache is fresh
        logger.info(`Cache fresh for ${type}, returning cached data`);
        return res.status(200).send({
          data: cachedEntry.data,
          cachedAt: cachedEntry.cachedAt,
          status: "fresh",
        });
      }

      // No cache - execute request and wait
      logger.info(`No cache for ${type}, executing request`);
      try {
        const executor = KubeCtlExecutorGetInstance();
        const result = await executor.executeGetRequest(type);

        // Save to cache
        await this.cache.set(type, result);

        return res.status(200).send({
          data: result,
          cachedAt: new Date().toISOString(),
          status: "fresh",
        });
      } catch (error) {
        logger.error(
          `Failed to fetch data for ${type}: ${error.message}`,
          error,
        );
        return res.status(503).send({
          error: `Failed to fetch resource data: ${error.message}`,
        });
      }
    });
  }

  private async refreshInBackground(type: string): Promise<void> {
    try {
      const executor = KubeCtlExecutorGetInstance();
      const result = await executor.executeGetRequest(type);
      await this.cache.set(type, result);
      logger.info(`Background refresh completed for ${type}`);
    } catch (error) {
      logger.warn(`Background refresh failed for ${type}: ${error.message}`);
      // Don't throw - this is a background task, failure is non-critical
    }
  }
}
