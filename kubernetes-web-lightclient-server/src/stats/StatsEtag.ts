import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Build a quoted entity tag from a prefix and a value (e.g. a version).
 */
export function BuildEtag(prefix: string, value: string | number): string {
  return `"${prefix}-${value}"`;
}

/**
 * Weak comparison of an `If-None-Match` header against the current etag:
 * comma-separated lists, an optional `W/` prefix and `*` are supported.
 */
export function EtagMatches(
  ifNoneMatch: string | string[] | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatch) {
    return false;
  }
  const header = Array.isArray(ifNoneMatch)
    ? ifNoneMatch.join(",")
    : ifNoneMatch;
  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => {
      if (candidate === "*") {
        return true;
      }
      const normalized = candidate.startsWith("W/")
        ? candidate.slice(2)
        : candidate;
      return normalized === etag;
    });
}

/**
 * Send a JSON payload with a `304 Not Modified` fast path: when the request's
 * `If-None-Match` matches, the payload is not built at all.
 */
export async function SendConditionalJson(
  req: FastifyRequest,
  reply: FastifyReply,
  etag: string,
  buildPayload: () => unknown | Promise<unknown>,
): Promise<void> {
  reply.header("ETag", etag);
  reply.header("Cache-Control", "private, no-cache");
  if (EtagMatches(req.headers["if-none-match"], etag)) {
    reply.status(304).send();
    return;
  }
  reply.status(200).send(await buildPayload());
}
