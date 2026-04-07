import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { StatsDataGet, PodResourcesGet } from "./StatsData";

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
  }
}
