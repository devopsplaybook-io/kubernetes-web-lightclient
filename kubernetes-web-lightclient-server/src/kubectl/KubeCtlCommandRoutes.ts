import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";
import { OTelTracer } from "../OTelContext";
import { Config } from "../Config";
import { DeletePolicy } from "./DeletePolicy";
import { KubeCtlExecutorGetInstance } from "./KubeCtlExecutor";
import { BuildCommandArgs } from "./KubeCtlValidation";

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
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Unauthorized" });
      }

      const payload = req.body || ({} as PostCommand["Body"]);
      const buildResult = BuildCommandArgs(payload);
      if (!buildResult.ok) {
        return res.status(400).send({ error: "Malformed Request" });
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

      const span = OTelTracer().startSpan("KubeCtlCommand");
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
