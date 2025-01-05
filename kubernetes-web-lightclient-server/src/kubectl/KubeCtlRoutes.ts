import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { SystemCommandExecute } from "../utils-std-ts/SystemCommand";

export class KubeCtlRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostCommand extends RequestGenericInterface {
      Body: {
        namespace?: string;
        object: string;
        command: string;
        argument?: string;
        noOutput?: boolean;
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
      if (!req.body.command || req.body.command.indexOf(" ") >= 0) {
        return res.status(400).send({ error: "Malformed Request" });
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
      const outputArg = req.body.noOutput ? "" : "-o json";
      const kubectlCommand = `kubectl ${namespaceArg} ${commandArg} ${objectArg} ${argumentArg} ${outputArg}`;
      const commandOutput = await SystemCommandExecute(kubectlCommand, { timeout: 20000 });
      if (req.body.noOutput) {
        return res.status(201).send({});
      }
      return res.status(201).send({ result: JSON.parse(commandOutput) });
    });
  }
}
