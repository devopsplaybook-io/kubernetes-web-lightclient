import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetLiveUser } from "@devopsplaybook.io/common-utils";
import { RequireScope } from "../auth/Authorization";
import { NormalizeError } from "../ErrorHandling";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { IsRequestQueueFullError } from "../queue/RequestQueue";
import {
  IsKubeObjectNotFoundError,
  KubeCtlExecutorGetInstance,
} from "./KubeCtlExecutor";
import { BuildLogsArgs, IsValidObjectName } from "./KubeCtlValidation";

const logger = OTelLogger().createModuleLogger("KubeCtlLogsRoutes");

// kubectl reports a container that has never started as:
//   container "app" in pod "my-pod" is waiting to start: CreateContainerConfigError
const CONTAINER_WAITING_PATTERN =
  /container "([^"]+)" in pod "[^"]*" is waiting to start: ([A-Za-z][A-Za-z0-9]*)/;

// Only reasons the UI knows how to explain are surfaced; anything else keeps
// the generic 502 path.
const CONTAINER_WAITING_REASONS = new Set([
  "ImagePullBackOff",
  "ErrImagePull",
  "InvalidImageName",
  "ErrImageNeverPull",
  "RegistryUnavailable",
  "CreateContainerConfigError",
  "CreateContainerError",
  "RunContainerError",
  "ContainerCreating",
  "PodInitializing",
  "CrashLoopBackOff",
]);

/**
 * Recognize the allow-listed kubectl "container is waiting to start" failure
 * so the UI can explain it instead of showing a raw 502. The container name is
 * only echoed when it is a valid object name.
 */
export function ExtractContainerWaitingReason(
  error: unknown,
): { reason: string; container?: string } | null {
  if (!error) {
    return null;
  }
  const candidates: string[] = [];
  const stderr = (error as { stderr?: unknown }).stderr;
  if (stderr) {
    candidates.push(
      Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr),
    );
  }
  if (error instanceof Error && error.message) {
    candidates.push(error.message);
  }
  for (const text of candidates) {
    const match = CONTAINER_WAITING_PATTERN.exec(text);
    if (match && CONTAINER_WAITING_REASONS.has(match[2])) {
      return {
        reason: match[2],
        ...(IsValidObjectName(match[1]) ? { container: match[1] } : {}),
      };
    }
  }
  return null;
}

export class KubeCtlLogsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostCommand extends RequestGenericInterface {
      Body: {
        namespace: string;
        pod: string;
        container?: string;
        argument?: string;
        timestamps?: boolean;
      };
    }
    fastify.post<PostCommand>("/", async (req, res) => {
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res.status(401).send({ error: "Unauthorized" });
      }

      const payload = req.body || ({} as PostCommand["Body"]);
      const buildResult = BuildLogsArgs(payload);
      if (buildResult.ok === false) {
        return res
          .status(400)
          .send({ error: buildResult.error, field: buildResult.field });
      }

      if (!(await RequireScope(req, res, "k8s:read"))) {
        return;
      }

      const span = OTelTracer().startSpan("KubeCtlLogs");
      span.setAttribute("kubectl.command", "logs");
      span.setAttribute("kubectl.object", "pod");
      if (payload.namespace) {
        span.setAttribute("kubectl.namespace", payload.namespace);
      }

      try {
        const executor = KubeCtlExecutorGetInstance();
        const commandOutput = await executor.executeCommand(
          buildResult.argv,
          20000,
        );
        return res.status(201).send({ result: commandOutput });
      } catch (error) {
        if (IsRequestQueueFullError(error)) {
          return res.status(429).send({
            error: "Server is busy, please retry",
            requestId: req.id,
          });
        }
        if (IsKubeObjectNotFoundError(error)) {
          return res.status(404).send({
            error:
              "This object no longer exists — it may have been deleted since the list was loaded",
          });
        }
        const waiting = ExtractContainerWaitingReason(error);
        if (waiting) {
          logger.info(
            `[${req.id}] kubectl logs unavailable: container waiting (${waiting.reason})`,
          );
          return res.status(409).send({
            error: `Container is waiting: ${waiting.reason}`,
            reason: waiting.reason,
            ...(waiting.container ? { container: waiting.container } : {}),
            requestId: req.id,
          });
        }
        const normalized = NormalizeError(error);
        logger.error(
          `[${req.id}] kubectl logs failed: ${
            normalized.stack ?? normalized.message
          }`,
        );
        return res.status(502).send({
          error: "kubectl logs failed",
          requestId: req.id,
        });
      } finally {
        span.end();
      }
    });
  }
}
