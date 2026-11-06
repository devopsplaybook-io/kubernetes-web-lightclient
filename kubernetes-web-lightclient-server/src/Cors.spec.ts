import Fastify, { FastifyInstance } from "fastify";
import { CorsRegister, ParseCorsOrigins } from "./Cors";

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
  info: jest.Mock;
  warn: jest.Mock;
};

async function buildApp(value: string): Promise<FastifyInstance> {
  const app = Fastify();
  CorsRegister(app, value);
  app.get("/api/status", async () => ({ started: true }));
  await app.ready();
  return app;
}

describe("ParseCorsOrigins", () => {
  test.each([
    [undefined, []],
    [null, []],
    ["", []],
    ["   ", []],
    ["https://a.example", ["https://a.example"]],
    [" https://a.example , https://b.example ", ["https://a.example", "https://b.example"]],
    ["https://a.example,,", ["https://a.example"]],
  ])("parses %j", (value, expected) => {
    expect(ParseCorsOrigins(value)).toEqual(expected);
  });
});

describe("CorsRegister", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  test("emits no CORS headers when no origin is configured", async () => {
    app = await buildApp("");
    const res = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "CORS disabled (no allowed origins configured)",
    );
  });

  test("allows a listed origin and denies an unlisted one", async () => {
    app = await buildApp("https://app.example, https://admin.example");

    const allowed = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { origin: "https://admin.example" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://admin.example",
    );

    const denied = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { origin: "https://evil.example" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("wildcard is explicit and warns", async () => {
    app = await buildApp("*");
    const res = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("any origin"),
    );
  });
});
