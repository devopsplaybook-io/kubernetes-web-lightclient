import { FastifyInstance } from "fastify";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("cors");

export function ParseCorsOrigins(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
}

/**
 * Registers @fastify/cors only when an explicit allowlist is configured.
 * An empty value emits no CORS headers at all (same-origin only).
 */
export function CorsRegister(fastify: FastifyInstance, value: string): void {
  const origins = ParseCorsOrigins(value);
  if (origins.length === 0) {
    logger.info("CORS disabled (no allowed origins configured)");
    return;
  }
  if (origins.includes("*")) {
    logger.warn(
      "CORS_POLICY_ORIGIN contains '*': any origin can read API responses",
    );
  }
  /* eslint-disable-next-line */
  fastify.register(require("@fastify/cors"), {
    origin: origins.length === 1 ? origins[0] : origins,
    methods: "GET,PUT,POST,DELETE",
  });
}
