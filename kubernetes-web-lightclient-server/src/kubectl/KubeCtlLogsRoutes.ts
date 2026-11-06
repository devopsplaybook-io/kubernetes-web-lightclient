import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetLiveUser } from "@devopsplaybook.io/common-utils";
import { RequireScope } from "../auth/Authorization";
import { NormalizeError } from "../ErrorHandling";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { IsKubeObjectNotFoundError, KubeCtlExecutorGetInstance } from "./KubeCtlExecutor";
import { BuildLogsArgs } from "./KubeCtlValidation";

const logger = OTelLogger().createModuleLogger("KubeCtlLogsRoutes");

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
        if (IsKubeObjectNotFoundError(error)) {
          return res.status(404).send({
            error:
              "This object no longer exists — it may have been deleted since the list was loaded",
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
