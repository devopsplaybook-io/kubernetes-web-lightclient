import Fastify from "fastify";
import { KubeCtlLogsRoutes } from "./KubeCtlLogsRoutes";

const mockSpan = {
  setAttribute: jest.fn(),
  end: jest.fn(),
};

jest.mock("../OTelContext", () => ({
  OTelTracer: () => ({
    startSpan: () => mockSpan,
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

jest.mock("./KubeCtlExecutor", () => ({
  KubeCtlExecutorGetInstance: () => ({
    executeCommand: mockExecuteCommand,
    executeGetRequest: jest.fn(),
  }),
}));

jest.mock("@devopsplaybook.io/common-utils", () => ({
  AuthGetUserSession: jest.fn(),
}));

import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";

const authMock = AuthGetUserSession as unknown as jest.Mock;

const INJECTION_PAYLOADS = [
  "pod\nid",
  "pod;id${IFS}-u",
  "pod$(touch${IFS}/tmp/pwned)",
  "pod`id`",
  "pod|id",
  "pod&id",
  "pod id",
];

function buildApp(): ReturnType<typeof Fastify> {
  const app = Fastify();
  const routes = new KubeCtlLogsRoutes();
  app.register(routes.getRoutes.bind(routes), { prefix: "/api/kubectl/logs" });
  return app;
}

describe("KubeCtlLogsRoutes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({
      isAuthenticated: true,
      userId: "11111111-1111-4111-8111-111111111111",
    });
    mockExecuteCommand.mockResolvedValue("COMPRESSED_LOGS");
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test("rejects unauthenticated requests with 401", async () => {
    authMock.mockResolvedValue({ isAuthenticated: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/logs/",
      payload: { namespace: "default", pod: "my-pod" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test.each(INJECTION_PAYLOADS)(
    "rejects pod injection payload %j with 400",
    async (payload) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/kubectl/logs/",
        payload: { namespace: "default", pod: payload },
      });
      expect(res.statusCode).toBe(400);
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    },
  );

  test.each(INJECTION_PAYLOADS)(
    "rejects namespace injection payload %j with 400",
    async (payload) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/kubectl/logs/",
        payload: { namespace: payload, pod: "my-pod" },
      });
      expect(res.statusCode).toBe(400);
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    },
  );

  test.each(INJECTION_PAYLOADS)(
    "rejects argument injection payload %j with 400",
    async (payload) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/kubectl/logs/",
        payload: { namespace: "default", pod: "my-pod", argument: payload },
      });
      expect(res.statusCode).toBe(400);
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    },
  );

  test("rejects container injection payloads with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/logs/",
      payload: {
        namespace: "default",
        pod: "my-pod",
        container: "container$(id)",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test("executes a validated logs request with an argument vector", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/logs/",
      payload: {
        namespace: "default",
        pod: "my-pod",
        container: "my-container",
        argument: " --since=1h --previous ",
        timestamps: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ result: "COMPRESSED_LOGS" });
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [
        "logs",
        "-n",
        "default",
        "my-pod",
        "-c",
        "my-container",
        "--since=1h",
        "--previous",
        "--timestamps",
      ],
      20000,
    );
  });

  test("ends the tracing span when the executor fails", async () => {
    mockExecuteCommand.mockRejectedValue(new Error("kubectl failed"));
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/logs/",
      payload: { namespace: "default", pod: "my-pod" },
    });
    expect(res.statusCode).toBe(500);
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });
});
