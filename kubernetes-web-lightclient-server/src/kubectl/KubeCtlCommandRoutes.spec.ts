import Fastify from "fastify";
import { KubeCtlCommandRoutes } from "./KubeCtlCommandRoutes";
import { Config } from "../Config";

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
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

function auditLines(): string[] {
  return [...mockLogger.info.mock.calls, ...mockLogger.warn.mock.calls]
    .map((call) => call[0] as string)
    .filter((line) => line.startsWith("kubectl."));
}

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
  "pods\nid",
  "pods;id${IFS}-u",
  "pods$(touch${IFS}/tmp/pwned)",
  "pods`id`",
  "pods|id",
  "pods&id",
  "pods id",
];

function buildApp(): ReturnType<typeof Fastify> {
  const config = {
    ALLOWED_DELETABLE_OBJECTS: "pod,deployment,pv,pvc",
  } as unknown as Config;
  const app = Fastify();
  const routes = new KubeCtlCommandRoutes(config);
  app.register(routes.getRoutes.bind(routes), {
    prefix: "/api/kubectl/command",
  });
  return app;
}

describe("KubeCtlCommandRoutes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({
      id: ACTOR_ID,
      name: "alice",
      role: "admin",
    });
    mockExecuteCommand.mockResolvedValue("COMPRESSED_OUTPUT");
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test("rejects a request without a body with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "missing or invalid command",
      field: "command",
    });
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test("rejects unauthenticated requests with 401", async () => {
    authMock.mockResolvedValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: { object: "pod", command: "get", argument: "my-pod" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test.each(INJECTION_PAYLOADS)(
    "rejects object injection payload %j with 400",
    async (payload) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/kubectl/command/",
        payload: { object: payload, command: "get", argument: "my-pod" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().field).toBe("object");
      expect(res.json().error).toContain("unknown resource type");
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    },
  );

  test.each(INJECTION_PAYLOADS)(
    "rejects delete argument injection payload %j with 400",
    async (payload) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/kubectl/command/",
        payload: {
          object: "pod",
          command: "delete",
          namespace: "default",
          argument: payload,
          noJson: true,
        },
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
        url: "/api/kubectl/command/",
        payload: {
          object: "pod",
          command: "describe",
          namespace: payload,
          argument: "my-pod",
          noJson: true,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().field).toBe("namespace");
      expect(res.json().error).toContain("invalid namespace");
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    },
  );

  test("rejects unknown commands with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: { object: "pod", command: "exec", argument: "my-pod" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'unsupported command "exec"',
      field: "command",
    });
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test("rejects malformed scale arguments with a field and reason", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "deployment",
        command: "scale",
        argument: "my-deployment",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'invalid scale argument "my-deployment", expected <name> --replicas=<n>',
      field: "argument",
    });
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test("executes a validated delete with an argument vector", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "deployment",
        command: "delete",
        namespace: "default",
        argument: "my-deployment",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ result: "COMPRESSED_OUTPUT" });
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      ["delete", "deployment", "my-deployment", "-n", "default"],
      20000,
    );
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kubectl.delete outcome=success");
    expect(lines[0]).toContain("actor=alice");
    expect(lines[0]).toContain(`actorId=${ACTOR_ID}`);
    expect(lines[0]).toContain("route=POST /api/kubectl/command");
    expect(lines[0]).toContain("object=deployment");
    expect(lines[0]).toContain("namespace=default");
    expect(lines[0]).toContain("target=my-deployment");
    expect(lines[0]).toContain("requestId=");
    expect(lines[0]).not.toContain("COMPRESSED_OUTPUT");
  });

  test("executes a validated scale with a re-serialized replica count", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "deployment",
        command: "scale",
        namespace: "default",
        argument: "my-deployment --replicas=3",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      ["scale", "deployment", "my-deployment", "--replicas=3", "-n", "default"],
      20000,
    );
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kubectl.scale outcome=success");
    expect(lines[0]).toContain("target=my-deployment");
    expect(lines[0]).toContain("replicas=3");
  });

  test("executes a validated rollout restart and audits it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "deployment",
        command: "rollout restart",
        namespace: "default",
        argument: "my-deployment",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      ["rollout", "restart", "deployment", "my-deployment", "-n", "default"],
      20000,
    );
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kubectl.rollout-restart outcome=success");
    expect(lines[0]).toContain("target=my-deployment");
  });

  test("executes a validated job creation from a cronjob", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "job",
        command: "create",
        namespace: "default",
        argument: "--from=cronjob/my-cron my-job",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      ["create", "job", "my-job", "--from=cronjob/my-cron", "-n", "default"],
      20000,
    );
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kubectl.create-job outcome=success");
    expect(lines[0]).toContain("target=my-job");
    expect(lines[0]).toContain("source=cronjob/my-cron");
  });

  test("executes a validated get with json output", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "pod",
        command: "get",
        namespace: "default",
        argument: "my-pod",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      ["get", "pod", "my-pod", "-n", "default", "-o", "json"],
      20000,
    );
    expect(auditLines()).toEqual([]);
  });

  test("refuses deletion of non-deletable object types with 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "configmap",
        command: "delete",
        namespace: "default",
        argument: "my-config",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test("returns a sanitized 502 and ends the span when the executor fails", async () => {
    mockExecuteCommand.mockRejectedValue(
      new Error("kubectl failed with token=super-secret"),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "pod",
        command: "describe",
        namespace: "default",
        argument: "my-pod",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: "kubectl command failed",
      requestId: expect.any(String),
    });
    expect(JSON.stringify(res.json())).not.toContain("super-secret");
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("super-secret"),
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  test("records allowlisted span attributes without the payload", async () => {
    await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "pod",
        command: "describe",
        namespace: "default",
        argument: "my-pod",
        noJson: true,
      },
    });
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "kubectl.command",
      "describe",
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
  });

  test("returns 429 when the request queue is full", async () => {
    mockExecuteCommand.mockRejectedValue(
      Object.assign(new Error("Request queue is full"), {
        code: "REQUEST_QUEUE_FULL",
      }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "pod",
        command: "describe",
        namespace: "default",
        argument: "my-pod",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      error: "Server is busy, please retry",
      requestId: expect.any(String),
    });
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  test("returns a clean 404 when the object no longer exists", async () => {
    mockExecuteCommand.mockRejectedValue(
      Object.assign(new Error("Command failed"), {
        stderr: 'Error from server (NotFound): pods "my-pod" not found',
      }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "pod",
        command: "describe",
        namespace: "default",
        argument: "my-pod",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe(
      "This object no longer exists — it may have been deleted since the list was loaded",
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  test("audits a delete skipped because the request queue is full", async () => {
    mockExecuteCommand.mockRejectedValue(
      Object.assign(new Error("Request queue is full"), {
        code: "REQUEST_QUEUE_FULL",
      }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "pod",
        command: "delete",
        namespace: "default",
        argument: "my-pod",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(429);
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kubectl.delete outcome=failure");
    expect(lines[0]).toContain("reason=queue_full");
    expect(lines[0]).toContain("target=my-pod");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("reason=queue_full"),
    );
  });

  test("audits a delete of an object that no longer exists", async () => {
    mockExecuteCommand.mockRejectedValue(
      Object.assign(new Error("Command failed"), {
        stderr: 'Error from server (NotFound): pods "my-pod" not found',
      }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "pod",
        command: "delete",
        namespace: "default",
        argument: "my-pod",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(404);
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kubectl.delete outcome=failure");
    expect(lines[0]).toContain("reason=not_found");
  });

  test("audits a generic delete failure without leaking the error detail", async () => {
    mockExecuteCommand.mockRejectedValue(
      new Error("kubectl failed with token=super-secret"),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/kubectl/command/",
      payload: {
        object: "pod",
        command: "delete",
        namespace: "default",
        argument: "my-pod",
        noJson: true,
      },
    });
    expect(res.statusCode).toBe(502);
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kubectl.delete outcome=failure");
    expect(lines[0]).toContain("reason=error");
    expect(lines[0]).not.toContain("super-secret");
    expect(lines[0]).not.toContain("COMPRESSED_OUTPUT");
  });
});
