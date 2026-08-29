import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";
import { OTelTracer } from "../OTelContext";
import { Config } from "../Config";
import { DeletePolicy } from "./DeletePolicy";
import { KubeCtlExecutorGetInstance } from "./KubeCtlExecutor";

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
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.object || req.body.object.indexOf(" ") >= 0) {
        return res.status(400).send({ error: "Malformed Request" });
      }
      if (!allowedCommands.includes(req.body.command)) {
        return res.status(400).send({ error: "Malformed Request" });
      }
      if (req.body.command === "delete") {
        const deletePolicy = new DeletePolicy(
          this.config.ALLOWED_DELETABLE_OBJECTS,
        );
        if (!deletePolicy.isDeletable(req.body.object)) {
          return res.status(403).send({
            error: `Deletion of ${req.body.object} objects is not allowed`,
          });
        }
      }
      if (req.body.namespace && req.body.namespace.indexOf(" ") >= 0) {
        return res.status(400).send({ error: "Malformed Request" });
      }
      if (
        req.body.argument &&
        (req.body.argument.indexOf(";") >= 0 ||
          req.body.argument.indexOf("&") >= 0 ||
          req.body.argument.indexOf("\\") >= 0)
      ) {
        return res.status(400).send({ error: "Malformed Request" });
      }
      const objectArg = req.body.object;
      const commandArg = req.body.command;
      const argumentArg = req.body.argument ? req.body.argument : "";
      const namespaceArg = req.body.namespace ? `-n ${req.body.namespace}` : "";
      const jsonArg = req.body.noJson ? "" : "-o json";
      const kubectlCommand = `kubectl ${commandArg} ${objectArg} ${namespaceArg} ${argumentArg} ${jsonArg}`;

      const span = OTelTracer().startSpan("KubeCtlCommand");
      span.setAttribute("parameters", JSON.stringify(req.body));

      const executor = KubeCtlExecutorGetInstance();
      const commandOutput = await executor.executeCommand(
        `${kubectlCommand} | gzip | base64 -w 0`,
        20000,
      );
      span.end();
      return res.status(201).send({ result: commandOutput });
    });
  }
}

const allowedCommands = [
  "get",
  "describe",
  "logs",
  "delete",
  "rollout restart",
  "create",
  "scale",
];
