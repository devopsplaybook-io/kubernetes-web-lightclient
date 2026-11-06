import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import Fastify from "fastify";
import { watchFile } from "fs-extra";
import * as path from "path";
import { Config } from "./Config";
import { APP_SCOPES } from "./auth/Authorization";
import { CreateAuthAuditHandler } from "./auth/AuthAuditLogger";
import { ValidateJwtKey } from "./auth/JwtKeyValidation";
import { KubeCache } from "./cache/KubeCache";
import { KubeResourceRoutes } from "./cache/KubeResourceRoutes";
import { CorsRegister } from "./Cors";
import { CrdRoutes } from "./crds/CrdRoutes";
import { CrdScannerInit } from "./crds/CrdScanner";
import { UserSelectionsDataInit } from "./crds/UserResourceSelections";
import { FastifyErrorHandlerRegister, NormalizeError } from "./ErrorHandling";
import { KubeCtlCommandRoutes } from "./kubectl/KubeCtlCommandRoutes";
import { KubeCtlLogsRoutes } from "./kubectl/KubeCtlLogsRoutes";
import {
  OTelLogger,
  OTelSetMeter,
  OTelSetTracer,
  OTelTracer,
} from "./OTelContext";
import { RequestQueueInit } from "./queue/RequestQueue";
import {
  StatsDataInit,
  StatsDataIsReady,
  StatsDataReconfigure,
  StatsDataStartInitialCapture,
} from "./stats/StatsData";
import {
  StatsDataRecommendationInit,
  StatsDataRecommendationReconfigure,
  StatsDataRecommendationStartInitialGeneration,
} from "./stats/StatsDataRecommendation";
import { StatsRoutes } from "./stats/StatsRoutes";
import {
  AuthInit,
  AuthSetAuditHandler,
  AuthSetOTel,
  DbUtilsInit,
  DbUtilsSetOTel,
  UsersApiTokensDataSetOTel,
  UsersDataSetOTel,
  UsersRoutes,
} from "@devopsplaybook.io/common-utils";

const logger = OTelLogger().createModuleLogger("app");

logger.info("====== Starting kubernetes-web-lightclient Server ======");

Promise.resolve().then(async () => {
  //
  const config = new Config();
  await config.reload();
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config
      .reload()
      .then(() => {
        StatsDataReconfigure(config);
        StatsDataRecommendationReconfigure(config);
      })
      .catch((error) => {
        logger.error(`Config reload failed: ${error.message}`, error);
      });
  });

  OTelSetTracer(new StandardTracer(config));
  OTelSetMeter(new StandardMeter(config));
  OTelLogger().initOTel(config);
  DbUtilsSetOTel(OTelTracer(), OTelLogger());

  const span = OTelTracer().startSpan("init");

  await DbUtilsInit(span, config, path.resolve(__dirname, "../sql"));
  AuthSetOTel(OTelTracer());
  UsersDataSetOTel(OTelTracer());
  UsersApiTokensDataSetOTel(OTelTracer());
  const jwtKeyWasConfigured = config.JWT_KEY !== "";
  await AuthInit(span, config, APP_SCOPES);
  ValidateJwtKey(config.JWT_KEY);
  logger.info(
    `JWT signing key: ${
      jwtKeyWasConfigured ? "operator-provided" : "database-managed"
    }`,
  );
  AuthSetAuditHandler(
    CreateAuthAuditHandler(OTelLogger().createModuleLogger("auth")),
  );
  // Initialize the bounded request queue before any kubectl execution
  // (stats setup arms intervals and the CRD scanner starts a scan).
  RequestQueueInit(
    config.REQUEST_QUEUE_CONCURRENCY,
    config.REQUEST_TIMEOUT,
    config.REQUEST_QUEUE_MAX_LENGTH,
  );

  await UserSelectionsDataInit(config);
  await StatsDataInit(span, config);
  await StatsDataRecommendationInit(span, config);
  await CrdScannerInit(config);

  // Initialize resource cache
  const kubeCache = new KubeCache(config.DATA_DIR, config.CACHE_TTL);

  span.end();

  // API

  const fastify = Fastify({
    // Fastify request logging is disabled: application logs and telemetry are
    // carried by the OTel pipeline configured above.
    logger: false,
  });
  FastifyErrorHandlerRegister(fastify);

  CorsRegister(fastify, config.CORS_POLICY_ORIGIN);
  /* eslint-disable-next-line */
  fastify.register(require("@fastify/multipart"));

  StandardTracerFastifyRegisterHooks(fastify, OTelTracer(), OTelLogger(), {
    ignoreList: ["GET-/api/status", "GET-/api/ready"],
  });

  fastify.register(new UsersRoutes().getRoutes, {
    prefix: "/api/users",
  });
  const kubeCtlCommandRoutes = new KubeCtlCommandRoutes(config);
  fastify.register(kubeCtlCommandRoutes.getRoutes.bind(kubeCtlCommandRoutes), {
    prefix: "/api/kubectl/command",
  });
  fastify.register(new KubeCtlLogsRoutes().getRoutes, {
    prefix: "/api/kubectl/logs",
  });
  fastify.register(new StatsRoutes().getRoutes, {
    prefix: "/api/stats",
  });
  const crdRoutes = new CrdRoutes(config);
  fastify.register(crdRoutes.getRoutes.bind(crdRoutes), {
    prefix: "/api/resources",
  });
  const kubeResourceRoutes = new KubeResourceRoutes(kubeCache);
  fastify.register(kubeResourceRoutes.getRoutes.bind(kubeResourceRoutes), {
    prefix: "/api/resources",
  });
  fastify.get("/api/status", async () => {
    return { started: true };
  });
  fastify.get("/api/ready", async (_req, res) => {
    const ready = StatsDataIsReady();
    return res.status(ready ? 200 : 503).send({ ready });
  });

  /* eslint-disable-next-line */
  fastify.register(require("@fastify/static"), {
    root: path.join(__dirname, "../web"),
    prefix: "/",
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url &&
      !request.raw.url.startsWith("/api/") &&
      !path.extname(request.raw.url)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (reply as any).sendFile("index.html");
    }
    reply.status(404).send({ error: "Not Found" });
  });

  fastify.listen({ port: config.API_PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
      logger.error("Error Starting API", err);
      process.exit(1);
    }
    logger.info("API Listening");
    // Initial captures run after the listener is up so startup never hangs
    // on kubectl. Readiness is released by their completion or deadline.
    StatsDataStartInitialCapture(config)
      .then(() => StatsDataRecommendationStartInitialGeneration())
      .catch((error) => {
        const normalized = NormalizeError(error);
        logger.error(
          `Initial stats capture failed: ${
            normalized.stack ?? normalized.message
          }`,
        );
      });
  });
}).catch((error) => {
  const normalized = NormalizeError(error);
  logger.error(`Startup failed: ${normalized.stack ?? normalized.message}`);
  process.exit(1);
});
