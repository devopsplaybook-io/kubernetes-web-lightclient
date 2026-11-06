import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as http from "http";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("errors");

/**
 * Turns any thrown value into an Error without ever producing
 * "[object Object]" for plain objects.
 */
export function NormalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") {
      return new Error(message);
    }
    try {
      return new Error(JSON.stringify(error));
    } catch {
      return new Error(String(error));
    }
  }
  return new Error(String(error));
}

/**
 * Sanitized Fastify error handler: 5xx responses expose only a status label
 * and a request id, while the readable detail is logged server-side (never
 * headers, bodies or credentials).
 */
export function FastifyErrorHandlerRegister(fastify: FastifyInstance): void {
  fastify.setErrorHandler(
    (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      if (reply.sent) {
        return reply;
      }
      const normalized = NormalizeError(error);
      const candidate =
        (error as { statusCode?: unknown })?.statusCode ??
        (error as { status?: unknown })?.status;
      let status = 500;
      if (
        typeof candidate === "number" &&
        candidate >= 400 &&
        candidate <= 599
      ) {
        status = candidate;
      } else if (reply.statusCode >= 400 && reply.statusCode <= 599) {
        status = reply.statusCode;
      }
      const label = http.STATUS_CODES[status] ?? "Error";
      logger.error(
        `[${request.id}] ${request.method} ${request.url} failed with ${status}: ${
          normalized.stack ?? normalized.message
        }`,
      );
      if (status >= 500) {
        return reply.status(status).send({
          statusCode: status,
          error: label,
          message: label,
          requestId: request.id,
        });
      }
      return reply.status(status).send({
        statusCode: status,
        error: label,
        message: normalized.message || label,
      });
    },
  );
}
