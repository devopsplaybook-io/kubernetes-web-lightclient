import Fastify from "fastify";
import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import { KubeResourceRoutes } from "./KubeResourceRoutes";
import { KubeCache } from "./KubeCache";

jest.mock("../OTelContext", () => ({
  OTelTracer: () => ({
    startSpan: () => ({ setAttribute: jest.fn(), end: jest.fn() }),
  }),
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  }),
}));

const mockExecuteGetRequest = jest.fn();

jest.mock("../kubectl/KubeCtlExecutor", () => ({
  KubeCtlExecutorGetInstance: () => ({
    executeGetRequest: mockExecuteGetRequest,
    executeCommand: jest.fn(),
  }),
}));

jest.mock("@devopsplaybook.io/common-utils", () => ({
  AuthGetUserSession: jest.fn(),
}));

import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";

const authMock = AuthGetUserSession as unknown as jest.Mock;

const INJECTION_PAYLOADS = [
  "pods\nid",
  "pods;id${IFS}-u",
  "pods$(id)",
  "pods`id`",
  "pods|id",
  "pods&id",
];

function buildApp(cache: KubeCache): ReturnType<typeof Fastify> {
  const app = Fastify();
  const routes = new KubeResourceRoutes(cache);
  app.register(routes.getRoutes.bind(routes), { prefix: "/api/resources" });
  return app;
}

describe("KubeResourceRoutes", () => {
  let app: ReturnType<typeof Fastify>;
  let cacheDir: string;
  let cache: KubeCache;

  beforeEach(async () => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({
      isAuthenticated: true,
      userId: "11111111-1111-4111-8111-111111111111",
    });
    mockExecuteGetRequest.mockResolvedValue("COMPRESSED_DATA");
    cacheDir = path.join(os.tmpdir(), `kube-resource-routes-test-${Date.now()}`);
    cache = new KubeCache(cacheDir, 30000);
    app = buildApp(cache);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fse.remove(cacheDir);
  });

  test("rejects unauthenticated requests with 401", async () => {
    authMock.mockResolvedValue({ isAuthenticated: false });
    const res = await app.inject({
      method: "GET",
      url: "/api/resources/data/pod",
    });
    expect(res.statusCode).toBe(401);
    expect(mockExecuteGetRequest).not.toHaveBeenCalled();
  });

  test.each(INJECTION_PAYLOADS)(
    "rejects injection payload type %j with 400",
    async (payload) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/resources/data/${encodeURIComponent(payload)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(mockExecuteGetRequest).not.toHaveBeenCalled();
    },
  );

  test("rejects unknown resource types with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/resources/data/unknownthing",
    });
    expect(res.statusCode).toBe(400);
    expect(mockExecuteGetRequest).not.toHaveBeenCalled();
  });

  test("accepts a whitelisted resource type and caches the result", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/resources/data/pod",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBe("COMPRESSED_DATA");
    expect(res.json().status).toBe("fresh");
    expect(mockExecuteGetRequest).toHaveBeenCalledWith("pod");

    // Second call is served from the fresh cache without re-executing
    const res2 = await app.inject({
      method: "GET",
      url: "/api/resources/data/pod",
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().status).toBe("fresh");
    expect(mockExecuteGetRequest).toHaveBeenCalledTimes(1);
  });

  test("serves stale data and refreshes in the background", async () => {
    // Pre-fill the cache with an already stale entry (TTL 0)
    await cache.set("pod", "OLD_DATA");
    await app.close();
    cache = new KubeCache(cacheDir, 0);
    app = buildApp(cache);
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/resources/data/pod",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBe("OLD_DATA");
    expect(res.json().status).toBe("stale");

    // The background refresh must eventually update the cache
    await new Promise((resolve) => setTimeout(resolve, 50));
    const entry = await cache.get("pod");
    expect(entry?.data).toBe("COMPRESSED_DATA");
  });

  test("returns 503 when the kubectl fetch fails", async () => {
    mockExecuteGetRequest.mockRejectedValue(new Error("kubectl failed"));
    const res = await app.inject({
      method: "GET",
      url: "/api/resources/data/pod",
    });
    expect(res.statusCode).toBe(503);
  });

  test("force=true clears the cache before fetching", async () => {
    await cache.set("pod", "OLD_DATA");
    const res = await app.inject({
      method: "GET",
      url: "/api/resources/data/pod?force=true",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBe("COMPRESSED_DATA");
    expect(res.json().status).toBe("fresh");
    expect(mockExecuteGetRequest).toHaveBeenCalledTimes(1);
  });
});
