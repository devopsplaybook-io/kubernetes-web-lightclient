import Fastify, { FastifyInstance } from "fastify";
import { FastifyErrorHandlerRegister, NormalizeError } from "./ErrorHandling";

jest.mock("./OTelContext", () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return {
    OTelLogger: () => ({
      createModuleLogger: () => logger,
    }),
  };
});

import { OTelLogger } from "./OTelContext";

const mockLogger = OTelLogger().createModuleLogger("test") as unknown as {
  error: jest.Mock;
};

function buildApp(): FastifyInstance {
  const app = Fastify();
  FastifyErrorHandlerRegister(app);
  app.get("/throws", async () => {
    throw new Error("db password=secret");
  });
  app.get("/throws-object", async () => {
    throw { message: "plain object boom" };
  });
  app.get("/bad", async () => {
    const error = new Error("bad input") as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  });
  app.get("/already-sent", async (_req, res) => {
    res.status(200).send({ ok: true });
    throw new Error("late failure");
  });
  return app;
}

describe("NormalizeError", () => {
  test("returns an Error unchanged", () => {
    const error = new Error("original");
    expect(NormalizeError(error)).toBe(error);
  });

  test("wraps a string", () => {
    expect(NormalizeError("boom").message).toBe("boom");
  });

  test("uses the message of a plain object", () => {
    expect(NormalizeError({ message: "object boom" }).message).toBe(
      "object boom",
    );
  });

  test("serializes an object without a message instead of [object Object]", () => {
    const message = NormalizeError({ code: "E_FAIL" }).message;
    expect(message).not.toBe("[object Object]");
    expect(message).toContain("E_FAIL");
  });

  test("wraps numbers", () => {
    expect(NormalizeError(42).message).toBe("42");
  });
});

describe("FastifyErrorHandlerRegister", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test("returns a generic 500 with a request id and logs the detail", async () => {
    const res = await app.inject({ method: "GET", url: "/throws" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Internal Server Error",
      requestId: expect.any(String),
    });
    expect(JSON.stringify(res.json())).not.toContain("secret");
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("db password=secret"),
    );
  });

  test("logs a thrown plain object readably and never [object Object]", async () => {
    const res = await app.inject({ method: "GET", url: "/throws-object" });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toBe("Internal Server Error");
    const logged = String(mockLogger.error.mock.calls[0][0]);
    expect(logged).toContain("plain object boom");
    expect(logged).not.toContain("[object Object]");
  });

  test("keeps the message of a 4xx error", async () => {
    const res = await app.inject({ method: "GET", url: "/bad" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: "bad input",
    });
  });

  test("does not overwrite an already sent response", async () => {
    const res = await app.inject({ method: "GET", url: "/already-sent" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
