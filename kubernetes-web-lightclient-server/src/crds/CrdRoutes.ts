import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RequestGenericInterface,
} from "fastify";
import { AuthGetLiveUser } from "@devopsplaybook.io/common-utils";
import { RequireAdmin, RequireScope } from "../auth/Authorization";
import {
  CrdScanInProgressError,
  CrdScannerGetAvailableResources,
  CrdScannerRefresh,
  ResourceType,
} from "./CrdScanner";
import {
  IsValidUserId,
  ListPreference,
  UserSelectionLoad,
  UserSelectionSave,
  ValidateListPreferences,
} from "./UserResourceSelections";
import { Config } from "../Config";
import { DeletePolicy } from "../kubectl/DeletePolicy";
import { IsAllowedResourceType } from "../kubectl/KubeCtlValidation";
import { OTelRequestSpan } from "../OTelContext";

export class CrdRoutes {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // GET /api/resources/types - Get all available resource types
    fastify.get("/types", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!(await RequireScope(req, res, "k8s:read"))) {
        return;
      }
      const types = this.withDeletableFlag(CrdScannerGetAvailableResources());
      return res.status(200).send({ types });
    });

    // GET /api/resources/selections - Get user's selected resource types
    fastify.get("/selections", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!(await RequireScope(req, res, "k8s:read"))) {
        return;
      }
      if (!IsValidUserId(user.id)) {
        return res.status(400).send({ error: "Invalid user id" });
      }
      const selections = await UserSelectionLoad(
        OTelRequestSpan(req),
        this.config,
        user.id,
      );
      return res
        .status(200)
        .send({
          selectedIds: selections.selectedIds,
          listPreferences: selections.listPreferences,
        });
    });

    // PUT /api/resources/selections - Save user's selected resource types and/or
    // list triage preferences; a field absent from the body leaves the stored value unchanged
    interface PutSelections extends RequestGenericInterface {
      Body: {
        selectedIds?: string[];
        listPreferences?: unknown;
      };
    }
    const saveSelections = async (
      req: FastifyRequest<PutSelections>,
      res: FastifyReply,
    ) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!(await RequireScope(req, res, "k8s:read"))) {
        return;
      }
      if (!IsValidUserId(user.id)) {
        return res.status(400).send({ error: "Invalid user id" });
      }
      const body = req.body ?? ({} as PutSelections["Body"]);
      const hasSelectedIds = body.selectedIds !== undefined;
      const hasListPreferences = body.listPreferences !== undefined;
      if (!hasSelectedIds && !hasListPreferences) {
        return res
          .status(400)
          .send({ error: "At least one of selectedIds or listPreferences is required" });
      }
      if (hasSelectedIds) {
        if (!Array.isArray(body.selectedIds)) {
          return res
            .status(400)
            .send({ error: "selectedIds must be an array" });
        }
        const invalid = body.selectedIds.find(
          (id) => typeof id !== "string" || !IsAllowedResourceType(id),
        );
        if (invalid !== undefined) {
          return res
            .status(400)
            .send({ error: `Unknown resource type: ${String(invalid)}` });
        }
      }
      let listPreferences: Record<string, ListPreference> | undefined;
      if (hasListPreferences) {
        listPreferences = ValidateListPreferences(body.listPreferences);
        if (listPreferences === null) {
          return res.status(400).send({
            error: "Invalid listPreferences payload",
            field: "listPreferences",
          });
        }
      }
      await UserSelectionSave(
        OTelRequestSpan(req),
        this.config,
        user.id,
        hasSelectedIds ? body.selectedIds : undefined,
        hasListPreferences ? listPreferences : undefined,
      );
      return res.status(200).send({ success: true });
    };
    fastify.put<PutSelections>("/selections", saveSelections);
    fastify.post<PutSelections>("/selections", saveSelections);

    // POST /api/resources/refresh - Trigger CRD re-scan
    fastify.post("/refresh", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      if (!(await RequireAdmin(req, res))) {
        return;
      }
      try {
        const types = this.withDeletableFlag(await CrdScannerRefresh());
        return res.status(200).send({ types });
      } catch (error) {
        if (error instanceof CrdScanInProgressError) {
          return res
            .status(429)
            .send({ error: "A CRD scan is already in progress" });
        }
        throw error;
      }
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
