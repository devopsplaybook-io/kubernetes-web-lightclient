// Valid, unique UUIDs so user ids satisfy the selections route validation.
jest.mock("uuid", () => {
  let counter = 0;
  return {
    v4: () =>
      `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  };
});

import * as nodeFs from "fs";
import * as os from "os";
import * as path from "path";
import Fastify, { FastifyInstance, InjectOptions } from "fastify";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  AuthInit,
  AuthSetOTel,
  DbUtilsGetDatabase,
  DbUtilsInit,
  DbUtilsSetOTel,
  UsersApiTokensDataSetOTel,
  UsersDataSetOTel,
  UsersRoutes,
} from "@devopsplaybook.io/common-utils";
import { APP_SCOPES } from "./Authorization";
import { Config } from "../Config";
import { KubeCache } from "../cache/KubeCache";
import { KubeResourceRoutes } from "../cache/KubeResourceRoutes";
import { CrdRoutes } from "../crds/CrdRoutes";
import { KubeCtlCommandRoutes } from "../kubectl/KubeCtlCommandRoutes";
import { KubeCtlLogsRoutes } from "../kubectl/KubeCtlLogsRoutes";
import { StatsRoutes } from "../stats/StatsRoutes";

const mockSpan = {
  setAttribute: jest.fn(),
  end: jest.fn(),
  addEvent: jest.fn(),
  setAttributes: jest.fn(),
  setStatus: jest.fn(),
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
  OTelRequestSpan: () => undefined,
}));

const mockExecuteCommand = jest.fn();
const mockExecuteGetRequest = jest.fn();

jest.mock("../kubectl/KubeCtlExecutor", () => ({
  KubeCtlExecutorGetInstance: () => ({
    executeCommand: mockExecuteCommand,
    executeGetRequest: mockExecuteGetRequest,
  }),
  IsKubeObjectNotFoundError: () => false,
}));

const mockRefresh = jest.fn(async (): Promise<any[]> => [
  { id: "pod", name: "Pods", namespaced: true, isCrd: false, group: "" },
]);

jest.mock("../crds/CrdScanner", () => {
  const actual = jest.requireActual("../crds/CrdScanner");
  return {
    ...actual,
    CrdScannerRefresh: () => mockRefresh(),
  };
});

jest.mock("../stats/StatsData", () => ({
  StatsDataGet: jest.fn(async () => []),
  PodResourcesGet: jest.fn(async () => []),
  PodUsageStatsGet: jest.fn(async () => []),
  StatsDataGetEtag: jest.fn(() => '"stats"'),
  PodResourcesGetEtag: jest.fn(() => '"pod-resources"'),
  PodUsageStatsGetEtag: jest.fn(() => '"pod-usage"'),
}));

const mockRecommendationGenerate = jest.fn(async () => {});

jest.mock("../stats/StatsDataRecommendation", () => ({
  RecommendationGenerate: () => mockRecommendationGenerate(),
  RecommendationGetCached: jest.fn(async () => null),
  RecommendationIsEnabled: () => true,
  RecommendationIsGenerating: () => false,
}));

const mockTracer = {
  startSpan: jest.fn(() => ({
    end: jest.fn(),
    addEvent: jest.fn(),
    setAttributes: jest.fn(),
    setStatus: jest.fn(),
    setAttribute: jest.fn(),
  })),
} as unknown as StandardTracer;

const mockStandardLogger = {
  createModuleLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
} as unknown as StandardLogger;

type UserName = "admin" | "reader" | "writer" | "operator" | "plain";

const USERS: Record<UserName, string[]> = {
  admin: [],
  reader: ["k8s:read", "stats:read"],
  writer: ["k8s:read", "k8s:write", "stats:read"],
  operator: ["k8s:read", "k8s:write", "stats:read", "admin"],
  plain: [],
};

let baseDir: string;
let dataDir: string;
let app: FastifyInstance;
let tokens: Record<UserName, string> = {} as Record<UserName, string>;
let userIds: Record<UserName, string> = {} as Record<UserName, string>;

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

async function login(name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/users/session",
    payload: { name, password: "password" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

async function bootstrapAdmin(): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/users/",
    payload: { name: "admin", password: "password" },
  });
  expect(created.statusCode).toBe(201);
  userIds.admin = created.json().user.id as string;
  return login("admin");
}

async function createNamedUser(
  name: string,
  role: "user" | "admin",
  scopes: string[],
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/users/",
    payload: { name, password: "password", role, scopes },
    headers: auth(tokens.admin),
  });
  expect(res.statusCode).toBe(201);
  return res.json().user.id as string;
}

async function createUser(
  name: Exclude<UserName, "admin">,
  role: "user" | "admin",
  scopes: string[],
): Promise<void> {
  userIds[name] = await createNamedUser(name, role, scopes);
  tokens[name] = await login(name);
}

beforeEach(async () => {
  jest.clearAllMocks();
  baseDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "auth-matrix-"));
  dataDir = path.join(baseDir, "data");

  DbUtilsSetOTel(mockTracer, mockStandardLogger);
  AuthSetOTel(mockTracer);
  UsersDataSetOTel(mockTracer);
  UsersApiTokensDataSetOTel(mockTracer);

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
    APP_SCOPES,
  );

  mockExecuteCommand.mockResolvedValue("COMPRESSED_OUTPUT");
  mockExecuteGetRequest.mockResolvedValue("COMPRESSED_DATA");

  const cache = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    clear: jest.fn(async () => {}),
    isStaleEntry: jest.fn(() => false),
  } as unknown as KubeCache;
  const config = {
    ALLOWED_DELETABLE_OBJECTS: "pod",
    DATA_DIR: dataDir,
  } as unknown as Config;

  app = Fastify();
  await app.register(new UsersRoutes().getRoutes, { prefix: "/api/users" });
  await app.register(new StatsRoutes().getRoutes, { prefix: "/api/stats" });
  const commandRoutes = new KubeCtlCommandRoutes(config);
  await app.register(commandRoutes.getRoutes.bind(commandRoutes), {
    prefix: "/api/kubectl/command",
  });
  await app.register(new KubeCtlLogsRoutes().getRoutes, {
    prefix: "/api/kubectl/logs",
  });
  const crdRoutes = new CrdRoutes(config);
  await app.register(crdRoutes.getRoutes.bind(crdRoutes), {
    prefix: "/api/resources",
  });
  const kubeResourceRoutes = new KubeResourceRoutes(cache);
  await app.register(kubeResourceRoutes.getRoutes.bind(kubeResourceRoutes), {
    prefix: "/api/resources",
  });
  await app.ready();

  tokens = {} as Record<UserName, string>;
  userIds = {} as Record<UserName, string>;
  tokens.admin = await bootstrapAdmin();
  await createUser("reader", "user", USERS.reader);
  await createUser("writer", "user", USERS.writer);
  await createUser("operator", "user", USERS.operator);
  await createUser("plain", "user", USERS.plain);
});

afterEach(async () => {
  await app.close();
  closeCurrentDb();
  nodeFs.rmSync(baseDir, { recursive: true, force: true });
});

function request(
  userName: UserName | null,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
): Promise<any> {
  const options: InjectOptions = { method, url };
  if (userName) {
    options.headers = auth(tokens[userName]);
  }
  if (payload !== undefined) {
    options.payload = payload as InjectOptions["payload"];
  }
  return app.inject(options);
}

interface RouteCase {
  method: "GET" | "POST" | "PUT";
  url: string;
  payload?: unknown;
  allowed: UserName[];
  forbidden: UserName[];
}

const ALL_SCOPED_USERS: UserName[] = ["reader", "writer", "operator", "admin"];
const ALL_USERS: UserName[] = ["admin", "reader", "writer", "operator", "plain"];

const ROUTE_CASES: RouteCase[] = [
  {
    method: "GET",
    url: "/api/stats/nodes",
    allowed: ALL_SCOPED_USERS,
    forbidden: ["plain"],
  },
  {
    method: "GET",
    url: "/api/stats/pod-resources",
    allowed: ALL_SCOPED_USERS,
    forbidden: ["plain"],
  },
  {
    method: "GET",
    url: "/api/stats/pod-usage",
    allowed: ALL_SCOPED_USERS,
    forbidden: ["plain"],
  },
  {
    method: "GET",
    url: "/api/stats/recommendation",
    allowed: ALL_SCOPED_USERS,
    forbidden: ["plain"],
  },
  {
    method: "GET",
    url: "/api/resources/types",
    allowed: ALL_USERS.filter((user) => user !== "plain"),
    forbidden: ["plain"],
  },
  {
    method: "GET",
    url: "/api/resources/selections",
    allowed: ALL_USERS.filter((user) => user !== "plain"),
    forbidden: ["plain"],
  },
  {
    method: "GET",
    url: "/api/resources/data/pod",
    allowed: ALL_USERS.filter((user) => user !== "plain"),
    forbidden: ["plain"],
  },
  {
    method: "PUT",
    url: "/api/resources/selections",
    payload: { selectedIds: ["pod"] },
    allowed: ALL_USERS.filter((user) => user !== "plain"),
    forbidden: ["plain"],
  },
  {
    method: "POST",
    url: "/api/resources/selections",
    payload: { selectedIds: ["pod"] },
    allowed: ALL_USERS.filter((user) => user !== "plain"),
    forbidden: ["plain"],
  },
  {
    method: "POST",
    url: "/api/stats/recommendation/regenerate",
    allowed: ["operator", "admin"],
    forbidden: ["reader", "writer", "plain"],
  },
  {
    method: "POST",
    url: "/api/resources/refresh",
    allowed: ["operator", "admin"],
    forbidden: ["reader", "writer", "plain"],
  },
];

describe("authorization matrix for application routes", () => {
  test.each(ROUTE_CASES)(
    "$method $url rejects unauthenticated and unknown credentials",
    async (routeCase) => {
      expect((await request(null, routeCase.method, routeCase.url, routeCase.payload)).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: routeCase.method,
            url: routeCase.url,
            payload: routeCase.payload as never,
            headers: auth("unknown-credential"),
          })
        ).statusCode,
      ).toBe(401);
    },
  );

  test.each(ROUTE_CASES)(
    "$method $url denies users without the required scope",
    async (routeCase) => {
      for (const user of routeCase.forbidden) {
        const res = await request(
          user,
          routeCase.method,
          routeCase.url,
          routeCase.payload,
        );
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({
          error: "Access Denied",
          code: "FORBIDDEN",
        });
      }
      if (routeCase.url === "/api/resources/data/pod") {
        expect(mockExecuteGetRequest).not.toHaveBeenCalled();
      }
      if (routeCase.url === "/api/resources/refresh") {
        expect(mockRefresh).not.toHaveBeenCalled();
      }
    },
  );

  test.each(ROUTE_CASES)(
    "$method $url allows users holding the required scope and admins",
    async (routeCase) => {
      for (const user of routeCase.allowed) {
        const res = await request(
          user,
          routeCase.method,
          routeCase.url,
          routeCase.payload,
        );
        expect(res.statusCode).toBe(200);
      }
    },
  );
});

interface CommandCase {
  command: string;
  object: string;
  argument: string;
  noJson?: boolean;
  allowed: UserName[];
}

const COMMAND_CASES: CommandCase[] = [
  {
    command: "get",
    object: "pod",
    argument: "my-pod",
    allowed: ALL_SCOPED_USERS,
  },
  {
    command: "describe",
    object: "pod",
    argument: "my-pod",
    noJson: true,
    allowed: ALL_SCOPED_USERS,
  },
  {
    command: "scale",
    object: "deployment",
    argument: "my-deployment --replicas=3",
    noJson: true,
    allowed: ["writer", "operator", "admin"],
  },
  {
    command: "rollout restart",
    object: "deployment",
    argument: "my-deployment",
    noJson: true,
    allowed: ["writer", "operator", "admin"],
  },
  {
    command: "create",
    object: "job",
    argument: "--from=cronjob/my-cron my-job",
    noJson: true,
    allowed: ["writer", "operator", "admin"],
  },
  {
    command: "delete",
    object: "pod",
    argument: "my-pod",
    noJson: true,
    allowed: ["operator", "admin"],
  },
];

describe("authorization matrix for kubectl command route", () => {
  test.each(COMMAND_CASES)(
    "command $command requires the expected scope for every user",
    async (commandCase) => {
      const payload = {
        command: commandCase.command,
        object: commandCase.object,
        argument: commandCase.argument,
        noJson: commandCase.noJson,
      };

      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kubectl/command/",
            payload,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kubectl/command/",
            payload,
            headers: auth("unknown-credential"),
          })
        ).statusCode,
      ).toBe(401);
      expect(mockExecuteCommand).not.toHaveBeenCalled();

      for (const user of ALL_USERS) {
        const res = await app.inject({
          method: "POST",
          url: "/api/kubectl/command/",
          payload,
          headers: auth(tokens[user]),
        });
        if (commandCase.allowed.includes(user)) {
          expect(res.statusCode).toBe(201);
        } else {
          expect(res.statusCode).toBe(403);
          expect(res.json()).toEqual({
            error: "Access Denied",
            code: "FORBIDDEN",
          });
        }
      }
      expect(mockExecuteCommand).toHaveBeenCalledTimes(
        commandCase.allowed.length,
      );
    },
  );
});

describe("authorization matrix for kubectl logs route", () => {
  test("requires k8s:read", async () => {
    const payload = { namespace: "default", pod: "my-pod" };

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/kubectl/logs/",
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(mockExecuteCommand).not.toHaveBeenCalled();

    for (const user of ALL_USERS) {
      const res = await app.inject({
        method: "POST",
        url: "/api/kubectl/logs/",
        payload,
        headers: auth(tokens[user]),
      });
      expect(res.statusCode).toBe(user === "plain" ? 403 : 201);
    }
    expect(mockExecuteCommand).toHaveBeenCalledTimes(4);
  });
});

describe("live authorization", () => {
  test("rejects the token of a deleted user", async () => {
    const tempId = await createNamedUser("temp", "user", ["k8s:read"]);
    const token = await login("temp");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/users/${tempId}`,
      headers: auth(tokens.admin),
    });
    expect(deleted.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/nodes",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(401);
  });

  test("applies the same scopes to API tokens", async () => {
    const readerToken = await app.inject({
      method: "POST",
      url: "/api/users/tokens",
      payload: { name: "reader-api" },
      headers: auth(tokens.reader),
    });
    expect(readerToken.statusCode).toBe(201);
    const allowed = await app.inject({
      method: "GET",
      url: "/api/stats/nodes",
      headers: auth(readerToken.json().token),
    });
    expect(allowed.statusCode).toBe(200);

    const plainToken = await app.inject({
      method: "POST",
      url: "/api/users/tokens",
      payload: { name: "plain-api" },
      headers: auth(tokens.plain),
    });
    expect(plainToken.statusCode).toBe(201);
    const denied = await app.inject({
      method: "GET",
      url: "/api/stats/nodes",
      headers: auth(plainToken.json().token),
    });
    expect(denied.statusCode).toBe(403);
  });
});
