import { describe, expect, it, vi, beforeEach } from "vitest";

const mockStore = vi.hoisted(() => ({
  isAuthenticated: true,
}));

vi.mock("../stores/AuthenticationStore", () => ({
  AuthenticationStore: () => mockStore,
}));

vi.mock("../services/AuthService", () => ({
  AuthService: { removeToken: vi.fn() },
}));

import { AuthService } from "../services/AuthService";
import {
  handleSessionExpiryError,
  isSafeReturnPath,
  SESSION_EXPIRED_MESSAGE,
} from "../services/SessionExpiry";

const removeTokenMock = AuthService.removeToken as unknown as ReturnType<typeof vi.fn>;

function axiosError(
  status: number,
  data: Record<string, unknown> = { error: "Unauthorized" },
): unknown {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    config: { url: "http://server.test/api/kubectl/command" },
    response: { status, data },
  });
}

function context(currentRoute: { path: string; fullPath: string }) {
  return { router: { push: vi.fn() }, currentRoute };
}

beforeEach(() => {
  mockStore.isAuthenticated = true;
});

describe("isSafeReturnPath", () => {
  it("accepts app-relative paths", () => {
    expect(isSafeReturnPath("/kubernetes")).toBe(true);
    expect(
      isSafeReturnPath("/kubernetes?objectType=pod&dialog=details&name=my-pod"),
    ).toBe(true);
    expect(isSafeReturnPath("/settings?tab=profile")).toBe(true);
  });

  it("rejects open redirects and non-paths", () => {
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("/\\evil.com")).toBe(false);
    expect(isSafeReturnPath("http://evil.com/path")).toBe(false);
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("settings")).toBe(false);
    expect(isSafeReturnPath("")).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
    expect(isSafeReturnPath(["/kubernetes"])).toBe(false);
  });
});

describe("handleSessionExpiryError", () => {
  it("clears the session, rewrites the message and routes to the login tab", async () => {
    const error = axiosError(401);
    const ctx = context({
      path: "/kubernetes",
      fullPath: "/kubernetes?objectType=pod&dialog=details&name=my-pod",
    });

    await handleSessionExpiryError(error, ctx);

    expect(removeTokenMock).toHaveBeenCalledTimes(1);
    expect(mockStore.isAuthenticated).toBe(false);
    expect(
      (error as { response: { data: { error: string } } }).response.data.error,
    ).toBe(SESSION_EXPIRED_MESSAGE);
    expect(ctx.router.push).toHaveBeenCalledWith({
      path: "/settings",
      query: {
        tab: "profile",
        return: "/kubernetes?objectType=pod&dialog=details&name=my-pod",
      },
    });
  });

  it("does not redirect when already on the settings page", async () => {
    const error = axiosError(401);
    const ctx = context({ path: "/settings", fullPath: "/settings?tab=profile" });

    await handleSessionExpiryError(error, ctx);

    expect(removeTokenMock).toHaveBeenCalledTimes(1);
    expect(ctx.router.push).not.toHaveBeenCalled();
  });

  it("leaves non-401 errors untouched", async () => {
    const error403 = axiosError(403, { error: "Deletion not allowed" });
    const ctx = context({ path: "/kubernetes", fullPath: "/kubernetes" });

    await handleSessionExpiryError(error403, ctx);

    expect(removeTokenMock).not.toHaveBeenCalled();
    expect(mockStore.isAuthenticated).toBe(true);
    expect(
      (error403 as { response: { data: { error: string } } }).response.data.error,
    ).toBe("Deletion not allowed");
    expect(ctx.router.push).not.toHaveBeenCalled();

    const plainError = new Error("boom");
    await handleSessionExpiryError(plainError, ctx);
    expect(removeTokenMock).not.toHaveBeenCalled();
    expect(ctx.router.push).not.toHaveBeenCalled();
  });
});
