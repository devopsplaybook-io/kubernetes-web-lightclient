import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { OTelRequestSpan } from "../OTelContext";
import {
  CrdScannerGetAvailableResources,
  CrdScannerRefresh,
  ResourceType,
} from "./CrdScanner";
import { UserSelectionLoad, UserSelectionSave } from "./UserResourceSelections";
import { Config } from "../Config";
import { DeletePolicy } from "../kubectl/DeletePolicy";

export class CrdRoutes {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // GET /api/resources/types - Get all available resource types
    fastify.get("/types", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const types = this.withDeletableFlag(CrdScannerGetAvailableResources());
      return res.status(200).send({ types });
    });

    // GET /api/resources/selections - Get user's selected resource types
    fastify.get("/selections", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const selections = await UserSelectionLoad(
        this.config,
        userSession.userId,
      );
      return res.status(200).send({ selectedIds: selections.selectedIds });
    });

    // PUT /api/resources/selections - Save user's selected resource types
    interface PutSelections extends RequestGenericInterface {
      Body: {
        selectedIds: string[];
      };
    }
    fastify.put<PutSelections>("/selections", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!Array.isArray(req.body.selectedIds)) {
        return res.status(400).send({ error: "selectedIds must be an array" });
      }
      await UserSelectionSave(
        this.config,
        userSession.userId,
        req.body.selectedIds,
      );
      return res.status(200).send({ success: true });
    });

    // POST /api/resources/refresh - Trigger CRD re-scan
    fastify.post("/refresh", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const types = this.withDeletableFlag(await CrdScannerRefresh());
      return res.status(200).send({ types });
    });
  }

  private withDeletableFlag(
    types: ResourceType[],
  ): (ResourceType & { deletable: boolean })[] {
    const deletePolicy = new DeletePolicy(
      this.config.ALLOWED_DELETABLE_OBJECTS,
    );
    return types.map((type) => ({
      ...type,
      deletable: deletePolicy.isDeletable(type.id),
    }));
  }
}
