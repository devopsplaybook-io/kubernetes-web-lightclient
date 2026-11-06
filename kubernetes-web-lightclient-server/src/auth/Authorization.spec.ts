jest.mock("@devopsplaybook.io/common-utils", () => ({
  AuthHasScope: jest.fn(),
}));

import { AuthHasScope } from "@devopsplaybook.io/common-utils";
import {
  RequireAdmin,
  RequireScope,
  ScopeForKubectlCommand,
} from "./Authorization";

const authHasScopeMock = AuthHasScope as unknown as jest.Mock;

describe("RequireScope", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns true when the scope guard succeeds", async () => {
    authHasScopeMock.mockResolvedValue(undefined);
    const req = {};
    const res = { sent: false, status: jest.fn() };
    await expect(RequireScope(req, res, "k8s:read")).resolves.toBe(true);
    expect(authHasScopeMock).toHaveBeenCalledWith(req, res, "k8s:read");
  });

  test("returns false when the guard already sent the response", async () => {
    const res = { sent: true, status: jest.fn() };
    authHasScopeMock.mockImplementation(async () => {
      throw new Error("Access Denied");
    });
    await expect(RequireScope({}, res, "k8s:read")).resolves.toBe(false);
  });

  test("rethrows an unexpected failure that did not send a response", async () => {
    const res = { sent: false, status: jest.fn() };
    authHasScopeMock.mockImplementation(async () => {
      throw new Error("database unavailable");
    });
    await expect(RequireScope({}, res, "k8s:read")).rejects.toThrow(
      "database unavailable",
    );
  });

  test("RequireAdmin checks the admin scope", async () => {
    authHasScopeMock.mockResolvedValue(undefined);
    const res = { sent: false };
    await expect(RequireAdmin({}, res)).resolves.toBe(true);
    expect(authHasScopeMock).toHaveBeenCalledWith({}, res, "admin");
  });
});

describe("ScopeForKubectlCommand", () => {
  test.each([
    ["get", "k8s:read"],
    ["describe", "k8s:read"],
    ["delete", "admin"],
    ["rollout restart", "k8s:write"],
    ["scale", "k8s:write"],
    ["create", "k8s:write"],
    ["exec", "admin"],
  ])("maps %s to %s", (command, scope) => {
    expect(ScopeForKubectlCommand(command)).toBe(scope);
  });
});
