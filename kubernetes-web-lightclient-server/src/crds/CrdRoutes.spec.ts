import Fastify, { FastifyInstance } from "fastify";
import { CrdRoutes } from "./CrdRoutes";
import { CrdScanInProgressError } from "./CrdScanner";
import { Config } from "../Config";

const mockSpan = {
  setAttribute: jest.fn(),
  end: jest.fn(),
};

jest.mock("../OTelContext", () => ({
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  }),
  OTelRequestSpan: () => undefined,
  OTelTracer: () => ({ startSpan: () => mockSpan }),
}));

const mockRefresh = jest.fn(async (): Promise<any[]> => []);

jest.mock("./CrdScanner", () => {
  const actual = jest.requireActual("./CrdScanner");
  return {
    ...actual,
    CrdScannerRefresh: () => mockRefresh(),
  };
});

const mockSelectionLoad = jest.fn(async () => ({
  selectedIds: ["pod"],
  listPreferences: null,
  updatedAt: "2026-11-06T00:00:00.000Z",
}));
const mockSelectionSave = jest.fn(async () => {});

jest.mock("./UserResourceSelections", () => {
  const actual = jest.requireActual("./UserResourceSelections");
  return {
    ...actual,
    UserSelectionLoad: () => mockSelectionLoad(),
    UserSelectionSave: () => mockSelectionSave(),
  };
});

jest.mock("@devopsplaybook.io/common-utils", () => ({
  AuthGetLiveUser: jest.fn(),
  AuthHasScope: jest.fn(async () => {}),
}));

import {
  AuthGetLiveUser,
  AuthHasScope,
} from "@devopsplaybook.io/common-utils";

const authMock = AuthGetLiveUser as unknown as jest.Mock;
const authHasScopeMock = AuthHasScope as unknown as jest.Mock;

const USER_ID = "11111111-1111-4111-8111-111111111111";

function buildApp(): FastifyInstance {
  const config = {
    ALLOWED_DELETABLE_OBJECTS: "pod",
  } as unknown as Config;
  const app = Fastify();
  const routes = new CrdRoutes(config);
  app.register(routes.getRoutes.bind(routes), { prefix: "/api/resources" });
  return app;
}

describe("CrdRoutes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({ id: USER_ID });
    mockRefresh.mockResolvedValue([
      { id: "pod", name: "Pods", namespaced: true, isCrd: false, group: "" },
    ]);
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test.each([
    ["PUT", undefined],
    ["PUT", {}],
    ["PUT", null],
    ["POST", undefined],
    ["POST", {}],
    ["POST", null],
  ])(
    "%s /selections with body %j returns 400",
    async (method, payload) => {
      const request: {
        method: "PUT" | "POST";
        url: string;
        payload?: string;
        headers?: Record<string, string>;
      } = {
        method: method as "PUT" | "POST",
        url: "/api/resources/selections",
      };
      if (payload !== undefined) {
        request.payload = JSON.stringify(payload);
        request.headers = { "content-type": "application/json" };
      }
      const res = await app.inject(request);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe(
        "At least one of selectedIds or listPreferences is required",
      );
      expect(mockSelectionSave).not.toHaveBeenCalled();
    },
  );

  test("PUT /selections stores selectedIds", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/resources/selections",
      payload: { selectedIds: ["pod"] },
    });
    expect(res.statusCode).toBe(200);
    expect(mockSelectionSave).toHaveBeenCalledTimes(1);
  });

  test("POST /selections is an alias of PUT", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/selections",
      payload: { listPreferences: { pod: { sortBy: "name" } } },
    });
    expect(res.statusCode).toBe(200);
    expect(mockSelectionSave).toHaveBeenCalledTimes(1);
  });

  test("GET /selections returns the stored selections", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/resources/selections",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      selectedIds: ["pod"],
      listPreferences: null,
    });
  });

  test("rejects an invalid selectedIds entry with 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/resources/selections",
      payload: { selectedIds: ["not-a-resource"] },
    });
    expect(res.statusCode).toBe(400);
    expect(mockSelectionSave).not.toHaveBeenCalled();
  });

  test("POST /refresh runs the scan for an allowed admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/refresh",
    });
    expect(res.statusCode).toBe(200);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  test("POST /refresh returns 429 while a scan is already in progress", async () => {
    mockRefresh.mockRejectedValueOnce(new CrdScanInProgressError());
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/refresh",
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: "A CRD scan is already in progress" });
  });

  test("POST /refresh returns 403 for a denied admin guard without scanning", async () => {
    authHasScopeMock.mockImplementationOnce(async (_req, res) => {
      res.status(403).send({ error: "Access Denied", code: "FORBIDDEN" });
      throw new Error("Access Denied");
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/refresh",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Access Denied", code: "FORBIDDEN" });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test("rejects unauthenticated requests with 401", async () => {
    authMock.mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: "/api/resources/types",
    });
    expect(res.statusCode).toBe(401);
  });
});
