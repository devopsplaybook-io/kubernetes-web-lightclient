// In-file counting uuid mock: the repo's global uuid mock
// (src/test-utils/uuid-mock.ts) returns a fixed value, which would collide
// user/token ids across this spec. This mock overrides it for this file only.
jest.mock("uuid", () => {
  let counter = 0;
  return { v4: () => `mock-uuid-${++counter}` };
});

import * as nodeFs from "fs";
import * as os from "os";
import * as path from "path";
import Fastify, { FastifyInstance } from "fastify";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  AuthInit,
  AuthSetOTel,
  DbUtilsExecSQL,
  DbUtilsGetDatabase,
  DbUtilsInit,
  DbUtilsSetOTel,
  UsersApiTokensDataSetOTel,
  UsersDataSetOTel,
  UsersRoutes,
} from "@devopsplaybook.io/common-utils";
import { Config } from "../Config";
import { KubeCtlCommandRoutes } from "../kubectl/KubeCtlCommandRoutes";
import { StatsRoutes } from "../stats/StatsRoutes";

const mockSpan = {
  setAttribute: jest.fn(),
  end: jest.fn(),
};

jest.mock("../OTelContext", () => ({
  OTelTracer: () => ({
    startSpan: () => mockSpan,
  }),
  OTelMeter: () => ({
    createObservableGauge: jest.fn(),
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

const mockExecuteCommand = jest.fn();

jest.mock("../kubectl/KubeCtlExecutor", () => ({
  KubeCtlExecutorGetInstance: () => ({
    executeCommand: mockExecuteCommand,
    executeGetRequest: jest.fn(),
  }),
}));

// Mock only the stats data collaborators (same technique as
// src/stats/StatsRoutes.spec.ts): the real StatsRoutes auth gate is still
// exercised, without pulling the Kubernetes stats capture chain into this spec.
jest.mock("../stats/StatsData", () => ({
  StatsDataGet: jest.fn(async () => []),
  PodResourcesGet: jest.fn(async () => []),
  PodUsageStatsGet: jest.fn(async () => []),
}));

const mockTracer = {
  startSpan: jest.fn(() => ({
    end: jest.fn(),
    addEvent: jest.fn(),
    setAttributes: jest.fn(),
    setStatus: jest.fn(),
  })),
} as unknown as StandardTracer;

const mockModuleLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const mockStandardLogger = {
  createModuleLogger: jest.fn(() => mockModuleLogger),
} as unknown as StandardLogger;

let baseDir: string;
let dataDir: string;
let app: FastifyInstance;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function closeCurrentDb(): void {
  const db = DbUtilsGetDatabase() as unknown as
    | { close: () => void }
    | undefined;
  try {
    db?.close();
  } catch {
    // already closed
  }
}

async function login(name: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/users/session",
    payload: { name, password },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

async function bootstrapAdmin(name = "root", password = "root-pass") {
  const created = await app.inject({
    method: "POST",
    url: "/api/users/",
    payload: { name, password },
  });
  expect(created.statusCode).toBe(201);
  return login(name, password);
}

async function createApiToken(
  jwtToken: string,
  name: string,
): Promise<{ id: string; token: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/users/tokens",
    payload: { name },
    headers: auth(jwtToken),
  });
  expect(res.statusCode).toBe(201);
  expect(typeof res.json().token).toBe("string");
  expect((res.json().token as string).length).toBeGreaterThanOrEqual(40);
  expect(res.json().tokenHash).toBeUndefined();
  return { id: res.json().id as string, token: res.json().token as string };
}

beforeEach(async () => {
  jest.clearAllMocks();
  baseDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "api-token-auth-"));
  dataDir = path.join(baseDir, "data");

  DbUtilsSetOTel(mockTracer, mockStandardLogger);
  AuthSetOTel(mockTracer);
  UsersDataSetOTel(mockTracer);
  UsersApiTokensDataSetOTel(mockTracer);

  // Boots a fresh instance against the real sql/ directory: this both
  // initializes the schema and proves init-0003.sql applies cleanly.
  await DbUtilsInit(
    undefined as never,
    { DATABASE_TYPE: "sqlite", DATA_DIR: dataDir } as never,
    path.resolve(__dirname, "../../sql"),
  );
  await AuthInit(
    undefined as never,
    {
      JWT_KEY: "",
      JWT_VALIDITY_DURATION: 3600,
      DATABASE_TYPE: "sqlite",
    } as never,
    [],
  );

  mockExecuteCommand.mockResolvedValue("COMPRESSED_OUTPUT");

  const config = {
    ALLOWED_DELETABLE_OBJECTS: "pod",
  } as unknown as Config;
  app = Fastify();
  await app.register(new UsersRoutes().getRoutes, { prefix: "/api/users" });
  const kubeCtlCommandRoutes = new KubeCtlCommandRoutes(config);
  await app.register(kubeCtlCommandRoutes.getRoutes.bind(kubeCtlCommandRoutes), {
    prefix: "/api/kubectl/command",
  });
  await app.register(new StatsRoutes().getRoutes, { prefix: "/api/stats" });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  closeCurrentDb();
  nodeFs.rmSync(baseDir, { recursive: true, force: true });
});

describe("API token authentication on lightclient routes", () => {
  test("authenticates POST /api/kubectl/command with an API token", async () => {
    const jwtToken = await bootstrapAdmin();
    const { token } = await createApiToken(jwtToken, "machine-client");

    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "pod",
        command: "get",
        namespace: "default",
        argument: "my-pod",
      },
      headers: auth(token),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ result: "COMPRESSED_OUTPUT" });
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      ["get", "pod", "my-pod", "-n", "default", "-o", "json"],
      20000,
    );
  });

  test("rejects a missing or unknown Bearer credential with 401", async () => {
    const jwtToken = await bootstrapAdmin();
    await createApiToken(jwtToken, "machine-client");

    const bogus = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: { object: "pod", command: "get", argument: "my-pod" },
      headers: auth("not-a-valid-token"),
    });
    expect(bogus.statusCode).toBe(401);

    const missing = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: { object: "pod", command: "get", argument: "my-pod" },
    });
    expect(missing.statusCode).toBe(401);

    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test("supports the full token lifecycle: use, list, revoke, immediate rejection", async () => {
    const jwtToken = await bootstrapAdmin();
    const { id, token } = await createApiToken(jwtToken, "machine-client");

    const used = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: { object: "pod", command: "get", argument: "my-pod" },
      headers: auth(token),
    });
    expect(used.statusCode).toBe(201);

    const listed = await app.inject({
      method: "GET",
      url: "/api/users/tokens",
      headers: auth(token),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().length).toBe(1);
    expect(listed.json()[0].id).toBe(id);
    expect(listed.json()[0].name).toBe("machine-client");
    expect(listed.json()[0].tokenHash).toBeUndefined();

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/users/tokens/${id}`,
      headers: auth(token),
    });
    expect(revoked.statusCode).toBe(200);

    const afterRevoke = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: { object: "pod", command: "get", argument: "my-pod" },
      headers: auth(token),
    });
    expect(afterRevoke.statusCode).toBe(401);
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);

    const emptyList = await app.inject({
      method: "GET",
      url: "/api/users/tokens",
      headers: auth(jwtToken),
    });
    expect(emptyList.statusCode).toBe(200);
    expect(emptyList.json()).toEqual([]);
  });

  test("rejects an expired API token", async () => {
    const jwtToken = await bootstrapAdmin();
    const { id, token } = await createApiToken(jwtToken, "expiring");

    DbUtilsExecSQL(
      undefined as never,
      'UPDATE users_api_tokens SET "expiresAt" = ? WHERE "id" = ?',
      ["2020-01-01T00:00:00.000Z", id],
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: { object: "pod", command: "get", argument: "my-pod" },
      headers: auth(token),
    });

    expect(res.statusCode).toBe(401);
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test("keeps JWT session authentication working alongside API tokens", async () => {
    const jwtToken = await bootstrapAdmin();
    await createApiToken(jwtToken, "machine-client");

    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: { object: "pod", command: "get", argument: "my-pod" },
      headers: auth(jwtToken),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ result: "COMPRESSED_OUTPUT" });
  });

  test("authenticates GET /api/stats/nodes with an API token", async () => {
    const jwtToken = await bootstrapAdmin();
    const { token } = await createApiToken(jwtToken, "machine-client");

    const ok = await app.inject({
      method: "GET",
      url: "/api/stats/nodes",
      headers: auth(token),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ stats: [] });

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/stats/nodes",
    });
    expect(unauthenticated.statusCode).toBe(401);
  });
});
