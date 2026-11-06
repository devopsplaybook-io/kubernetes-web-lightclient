import type { FastifyReply, FastifyRequest } from "fastify";
import {
  BuildEtag,
  EtagMatches,
  SendConditionalJson,
} from "./StatsEtag";

describe("BuildEtag", () => {
  test("quotes the prefix and value", () => {
    expect(BuildEtag("stats", "abc-1")).toBe('"stats-abc-1"');
    expect(BuildEtag("pod-usage", 3)).toBe('"pod-usage-3"');
  });
});

describe("EtagMatches", () => {
  const etag = '"stats-abc-1"';

  test("does not match a missing header", () => {
    expect(EtagMatches(undefined, etag)).toBe(false);
    expect(EtagMatches("", etag)).toBe(false);
  });

  test("matches an exact etag", () => {
    expect(EtagMatches(etag, etag)).toBe(true);
  });

  test("matches a weak etag", () => {
    expect(EtagMatches(`W/${etag}`, etag)).toBe(true);
  });

  test("matches a comma-separated list", () => {
    expect(EtagMatches('"other", "stats-abc-1", "third"', etag)).toBe(true);
    expect(EtagMatches(["\"other\", \"stats-abc-1\""], etag)).toBe(true);
  });

  test("matches the wildcard", () => {
    expect(EtagMatches("*", etag)).toBe(true);
  });

  test("does not match a different etag", () => {
    expect(EtagMatches('"stats-abc-2"', etag)).toBe(false);
    expect(EtagMatches('"stats-abc-2", "stats-abc-3"', etag)).toBe(false);
  });
});

function buildReply() {
  return {
    status: jest.fn().mockReturnThis(),
    header: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

describe("SendConditionalJson", () => {
  test("answers 304 without building the payload when the etag matches", async () => {
    const reply = buildReply();
    const buildPayload = jest.fn(() => ({ value: 1 }));
    const req = {
      headers: { "if-none-match": '"stats-abc-1"' },
    } as unknown as FastifyRequest;

    await SendConditionalJson(
      req,
      reply as unknown as FastifyReply,
      '"stats-abc-1"',
      buildPayload,
    );

    expect(reply.header).toHaveBeenCalledWith("ETag", '"stats-abc-1"');
    expect(reply.header).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-cache",
    );
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(buildPayload).not.toHaveBeenCalled();
  });

  test("answers 200 with the payload when the etag differs", async () => {
    const reply = buildReply();
    const buildPayload = jest.fn(async () => ({ value: 42 }));
    const req = {
      headers: { "if-none-match": '"stats-old"' },
    } as unknown as FastifyRequest;

    await SendConditionalJson(
      req,
      reply as unknown as FastifyReply,
      '"stats-new"',
      buildPayload,
    );

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({ value: 42 });
    expect(buildPayload).toHaveBeenCalledTimes(1);
  });

  test("answers 200 when no conditional header is sent", async () => {
    const reply = buildReply();
    const req = { headers: {} } as unknown as FastifyRequest;

    await SendConditionalJson(
      req,
      reply as unknown as FastifyReply,
      '"stats-new"',
      () => ({ value: 1 }),
    );

    expect(reply.status).toHaveBeenCalledWith(200);
  });
});
