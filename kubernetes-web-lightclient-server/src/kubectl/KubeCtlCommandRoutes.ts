import { FastifyInstance, FastifyRequest, RequestGenericInterface } from "fastify";
import { AuthGetLiveUser } from "@devopsplaybook.io/common-utils";
import {
  RequireScope,
  ScopeForKubectlCommand,
} from "../auth/Authorization";
import {
  CreateResourceAuditHandler,
  ResourceAuditAction,
  ResourceAuditEvent,
  ResourceAuditFailureReason,
} from "../audit/ResourceAuditLogger";
import { NormalizeError } from "../ErrorHandling";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { Config } from "../Config";
import { IsRequestQueueFullError } from "../queue/RequestQueue";
import { DeletePolicy } from "./DeletePolicy";
import {
  IsKubeObjectNotFoundError,
  KubeCtlExecutorGetInstance,
} from "./KubeCtlExecutor";
import { BuildCommandArgs } from "./KubeCtlValidation";

const logger = OTelLogger().createModuleLogger("KubeCtlCommandRoutes");
const resourceAudit = CreateResourceAuditHandler(
  OTelLogger().createModuleLogger("audit"),
);

const AUDIT_ROUTE = "POST /api/kubectl/command";

function AuditActionFor(command: string): ResourceAuditAction | null {
  switch (command) {
    case "delete":
      return "kubectl.delete";
    case "scale":
      return "kubectl.scale";
    case "rollout restart":
      return "kubectl.rollout-restart";
    case "create":
      return "kubectl.create-job";
    default:
      return null;
  }
}

// Target details come from the validated argument vector, never from the raw
// request strings.
function AuditTargetFor(argv: string[]): Partial<ResourceAuditEvent> {
  switch (argv[0]) {
    case "delete":
      return { target: argv[2] };
    case "scale":
      return {
        target: argv[2],
        replicas: Number(argv[3].replace("--replicas=", "")),
      };
    case "create":
      return { target: argv[2], source: argv[3].replace("--from=", "") };
    case "rollout":
      return { target: argv[3] };
    default:
      return {};
  }
}

function BuildResourceAuditEvent(
  command: string,
  payload: { object: string; namespace?: string },
  argv: string[],
  user: { id?: string; name?: string },
  req: FastifyRequest,
): ResourceAuditEvent | null {
  const action = AuditActionFor(command);
  if (!action) {
    return null;
  }
  return {
    action,
    outcome: "success",
    actorName: user.name,
    actorId: user.id,
    route: AUDIT_ROUTE,
    object: payload.object,
    namespace: payload.namespace || undefined,
    requestId: req.id,
    ip: req.ip,
    ...AuditTargetFor(argv),
  };
}

function EmitResourceAuditFailure(
  event: ResourceAuditEvent | null,
  reason: ResourceAuditFailureReason,
): void {
  if (event) {
    resourceAudit({ ...event, outcome: "failure", reason });
  }
}

export class KubeCtlCommandRoutes {
  //
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostCommand extends RequestGenericInterface {
      Body: {
        namespace?: string;
        object: string;
        command: string;
        argument?: string;
        noJson?: boolean;
      };
    }
    fastify.post<PostCommand>("/", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }

      const payload = req.body || ({} as PostCommand["Body"]);
      const buildResult = BuildCommandArgs(payload);
      if (buildResult.ok === false) {
        return res
          .status(400)
          .send({ error: buildResult.error, field: buildResult.field });
      }
      if (!(await RequireScope(req, res, ScopeForKubectlCommand(payload.command)))) {
        return;
      }
      if (payload.command === "delete") {
        const deletePolicy = new DeletePolicy(
          this.config.ALLOWED_DELETABLE_OBJECTS,
        );
        if (!deletePolicy.isDeletable(payload.object)) {
          return res.status(403).send({
            error: `Deletion of ${payload.object} objects is not allowed`,
          });
        }
      }

      const auditEvent = BuildResourceAuditEvent(
        payload.command,
        payload,
        buildResult.argv,
        user,
        req,
      );

      const span = OTelTracer().startSpan("KubeCtlCommand");
      span.setAttribute("kubectl.command", payload.command);
      span.setAttribute("kubectl.object", payload.object);
      if (payload.namespace) {
        span.setAttribute("kubectl.namespace", payload.namespace);
      }

      try {
        const executor = KubeCtlExecutorGetInstance();
        const commandOutput = await executor.executeCommand(
          buildResult.argv,
          20000,
        );
        if (auditEvent) {
          resourceAudit(auditEvent);
        }
        return res.status(201).send({ result: commandOutput });
      } catch (error) {
        if (IsRequestQueueFullError(error)) {
          EmitResourceAuditFailure(auditEvent, "queue_full");
          return res.status(429).send({
            error: "Server is busy, please retry",
            requestId: req.id,
          });
        }
        if (IsKubeObjectNotFoundError(error)) {
          EmitResourceAuditFailure(auditEvent, "not_found");
          return res.status(404).send({
            error:
              "This object no longer exists — it may have been deleted since the list was loaded",
          });
        }
        EmitResourceAuditFailure(auditEvent, "error");
        const normalized = NormalizeError(error);
        logger.error(
          `[${req.id}] kubectl ${payload.command} ${payload.object} failed: ${
            normalized.stack ?? normalized.message
          }`,
        );
        return res.status(502).send({
          error: "kubectl command failed",
          requestId: req.id,
        });
      } finally {
        span.end();
      }
    });
  }
}
