import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import Fastify from "fastify";
import { watchFile } from "fs-extra";
import * as path from "path";
import { Config } from "./Config";
import { KubeCtlCommandRoutes } from "./kubectl/KubeCtlCommandRoutes";
import { KubeCtlLogsRoutes } from "./kubectl/KubeCtlLogsRoutes";
import {
  OTelLogger,
  OTelSetMeter,
  OTelSetTracer,
  OTelTracer,
} from "./OTelContext";
import { StatsDataInit } from "./stats/StatsData";
import { StatsRoutes } from "./stats/StatsRoutes";
import { AuthInit } from "./users/Auth";
import { UsersRoutes } from "./users/UsersRoutes";
import { SqlDbUtilsInit } from "./utils-std-ts/SqlDbUtils";

const logger = OTelLogger().createModuleLogger("app");

logger.info("====== Starting kubernetes-web-lightclient Server ======");

Promise.resolve().then(async () => {
  //
  const config = new Config();
  await config.reload();
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config.reload();
  });

  OTelSetTracer(new StandardTracer(config));
  OTelSetMeter(new StandardMeter(config));
  OTelLogger().initOTel(config);

  const span = OTelTracer().startSpan("init");

  await SqlDbUtilsInit(span, config);
  await AuthInit(span, config);
  await StatsDataInit(span, config);

  span.end();

  // API

  const fastify = Fastify({
    logger: config.LOG_LEVEL === process.env.FASTIFY_LOG_LEVEL,
  });

  if (config.CORS_POLICY_ORIGIN) {
    /* eslint-disable-next-line */
    fastify.register(require("@fastify/cors"), {
      origin: config.CORS_POLICY_ORIGIN,
      methods: "GET,PUT,POST,DELETE",
    });
  }
  /* eslint-disable-next-line */
  fastify.register(require("@fastify/multipart"));

  StandardTracerFastifyRegisterHooks(fastify, OTelTracer(), OTelLogger());

  fastify.register(new UsersRoutes().getRoutes, {
    prefix: "/api/users",
  });
  fastify.register(new KubeCtlCommandRoutes().getRoutes, {
    prefix: "/api/kubectl/command",
  });
  fastify.register(new KubeCtlLogsRoutes().getRoutes, {
    prefix: "/api/kubectl/logs",
  });
  fastify.register(new StatsRoutes().getRoutes, {
    prefix: "/api/stats",
  });
  fastify.get("/api/status", async () => {
    return { started: true };
  });

  /* eslint-disable-next-line */
  fastify.register(require("@fastify/static"), {
    root: path.join(__dirname, "../web"),
    prefix: "/",
  });

  fastify.listen({ port: config.API_PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
      logger.error(err);
      fastify.log.error(err);
      process.exit(1);
    }
    logger.info("API Listening");
  });
});
