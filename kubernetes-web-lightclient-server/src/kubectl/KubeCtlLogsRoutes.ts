import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";
import { OTelTracer } from "../OTelContext";
import { KubeCtlExecutorGetInstance } from "./KubeCtlExecutor";
import { BuildLogsArgs } from "./KubeCtlValidation";

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
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Unauthorized" });
      }

      const payload = req.body || ({} as PostCommand["Body"]);
      const buildResult = BuildLogsArgs(payload);
      if (!buildResult.ok) {
        return res.status(400).send({ error: "Malformed Request" });
      }

      const span = OTelTracer().startSpan("KubeCtlLogs");
      span.setAttribute("parameters", JSON.stringify(payload));

      try {
        const executor = KubeCtlExecutorGetInstance();
        const commandOutput = await executor.executeCommand(
          buildResult.argv,
          20000,
        );
        return res.status(201).send({ result: commandOutput });
      } finally {
        span.end();
      }
    });
  }
}
