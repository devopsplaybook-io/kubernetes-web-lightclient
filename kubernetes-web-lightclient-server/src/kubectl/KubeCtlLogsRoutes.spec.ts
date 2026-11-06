import Fastify from "fastify";
import { KubeCtlLogsRoutes } from "./KubeCtlLogsRoutes";

const mockSpan = {
  setAttribute: jest.fn(),
  end: jest.fn(),
};

jest.mock("../OTelContext", () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return {
    OTelTracer: () => ({
      startSpan: () => mockSpan,
    }),
    OTelLogger: () => ({
      createModuleLogger: () => logger,
    }),
  };
});

import { OTelLogger } from "../OTelContext";

const mockLogger = OTelLogger().createModuleLogger("test") as unknown as {
  error: jest.Mock;
};

const mockExecuteCommand = jest.fn();

jest.mock("./KubeCtlExecutor", () => ({
  KubeCtlExecutorGetInstance: () => ({
    executeCommand: mockExecuteCommand,
    executeGetRequest: jest.fn(),
  }),
  IsKubeObjectNotFoundError: (error: unknown) =>
    String((error as { stderr?: unknown })?.stderr ?? "").includes("(NotFound)"),
}));

jest.mock("@devopsplaybook.io/common-utils", () => ({
  AuthGetLiveUser: jest.fn(),
  AuthHasScope: jest.fn(async () => {}),
}));

import { AuthGetLiveUser } from "@devopsplaybook.io/common-utils";

const authMock = AuthGetLiveUser as unknown as jest.Mock;

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
    authMock.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    mockExecuteCommand.mockResolvedValue("COMPRESSED_LOGS");
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test("rejects a request without a body with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/logs/",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid namespace undefined",
      field: "namespace",
    });
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test("rejects unauthenticated requests with 401", async () => {
    authMock.mockResolvedValue(null);
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
      expect(res.json().field).toBe("pod");
      expect(res.json().error).toContain("invalid pod name");
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
    expect(res.json().field).toBe("container");
    expect(res.json().error).toContain("invalid container name");
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

  test("returns a sanitized 502 and ends the span when the executor fails", async () => {
    mockExecuteCommand.mockRejectedValue(
      new Error("kubectl failed with token=super-secret"),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/logs/",
      payload: { namespace: "default", pod: "my-pod" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: "kubectl logs failed",
      requestId: expect.any(String),
    });
    expect(JSON.stringify(res.json())).not.toContain("super-secret");
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("super-secret"),
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  test("records allowlisted span attributes without pod or argument values", async () => {
    await app.inject({
      method: "POST",
      url: "/api/kubectl/logs/",
      payload: {
        namespace: "default",
        pod: "my-pod",
        container: "my-container",
        argument: "--since=1h",
      },
    });
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "kubectl.command",
      "logs",
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "kubectl.object",
      "pod",
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "kubectl.namespace",
      "default",
    );
    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      "parameters",
      expect.anything(),
    );
    const serializedAttributes = JSON.stringify(
      mockSpan.setAttribute.mock.calls,
    );
    expect(serializedAttributes).not.toContain("my-pod");
    expect(serializedAttributes).not.toContain("my-container");
  });

  test("returns a clean 404 when the pod no longer exists", async () => {
    mockExecuteCommand.mockRejectedValue(
      Object.assign(new Error("Command failed"), {
        stderr: 'Error from server (NotFound): pods "my-pod" not found',
      }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/logs/",
      payload: { namespace: "default", pod: "my-pod" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe(
      "This object no longer exists — it may have been deleted since the list was loaded",
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });
});
