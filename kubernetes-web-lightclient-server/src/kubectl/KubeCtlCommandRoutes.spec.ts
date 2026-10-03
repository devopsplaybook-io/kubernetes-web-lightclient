import Fastify from "fastify";
import { KubeCtlCommandRoutes } from "./KubeCtlCommandRoutes";
import { Config } from "../Config";

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
      isAuthenticated: true,
      userId: "11111111-1111-4111-8111-111111111111",
    });
    mockExecuteCommand.mockResolvedValue("COMPRESSED_OUTPUT");
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

  test("ends the tracing span when the executor fails", async () => {
    mockExecuteCommand.mockRejectedValue(new Error("kubectl failed"));
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
    expect(res.statusCode).toBe(500);
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });
});
