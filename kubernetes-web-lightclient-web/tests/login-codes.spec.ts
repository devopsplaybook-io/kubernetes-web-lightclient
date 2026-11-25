import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  getAuthHeader: vi.fn(async () => ({
    headers: { Authorization: "Bearer jwt" },
  })),
  saveToken: vi.fn(async () => {}),
}));

vi.mock("axios", () => ({
  default: { get: mocks.get, post: mocks.post },
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: {
    getAuthHeader: mocks.getAuthHeader,
    saveToken: mocks.saveToken,
  },
}));

import { loginCodeService, loginCodesAvailable } from "../services/LoginCodes";

const CAPABILITIES = {
  enabled: true,
  available: true,
  codeLength: 8,
  rotationSeconds: 30,
  graceSeconds: 60,
  ttlSeconds: 300,
  pollIntervalMs: 2000,
  approveRequiresPassword: false,
  serverTime: "2026-11-25T00:00:00.000Z",
};

beforeEach(() => {
  mocks.getAuthHeader.mockResolvedValue({
    headers: { Authorization: "Bearer jwt" },
  });
});

describe("login-code service wiring", () => {
  it("probes the capabilities endpoint under the app API prefix", async () => {
    mocks.get.mockResolvedValue({ data: CAPABILITIES });

    const result = await loginCodeService.capabilities();

    expect(result).toEqual(CAPABILITIES);
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/users/login-codes/capabilities",
      { signal: undefined, timeout: 10000 },
    );
  });

  it("advertises the feature only when it is enabled and available", async () => {
    mocks.get.mockResolvedValue({
      data: { ...CAPABILITIES, available: false },
    });
    await expect(loginCodesAvailable()).resolves.toBe(false);

    mocks.get.mockResolvedValue({
      data: { ...CAPABILITIES, enabled: false },
    });
    await expect(loginCodesAvailable()).resolves.toBe(false);

    mocks.get.mockResolvedValue({ data: CAPABILITIES });
    await expect(loginCodesAvailable()).resolves.toBe(true);
  });

  it("reports the feature as unavailable when the probe fails", async () => {
    mocks.get.mockRejectedValue(new Error("network down"));

    await expect(loginCodesAvailable()).resolves.toBe(false);
  });

  it("creates an anonymous login code request", async () => {
    const created = {
      requestToken: "request-token",
      code: "BCDFGHJK",
      codeExpiresAt: "2026-11-25T00:00:30.000Z",
      expiresAt: "2026-11-25T00:05:00.000Z",
      serverTime: "2026-11-25T00:00:00.000Z",
    };
    mocks.post.mockResolvedValue({ data: created });

    await expect(loginCodeService.create()).resolves.toEqual(created);
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/users/login-codes/",
      undefined,
      { signal: undefined, timeout: 10000 },
    );
  });

  it("sends the session authorization header on preview and approve", async () => {
    mocks.post
      .mockResolvedValueOnce({
        data: {
          deviceLabel: "DeviceCheck/1.0",
          userAgent: "DeviceCheck/1.0",
          createdAt: "2026-11-25T00:00:00.000Z",
          expiresAt: "2026-11-25T00:05:00.000Z",
          userName: "root",
          serverTime: "2026-11-25T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        data: {
          approved: true,
          expiresAt: "2026-11-25T00:05:00.000Z",
          serverTime: "2026-11-25T00:00:00.000Z",
        },
      });

    await loginCodeService.preview("BCDFGHJK");
    await loginCodeService.approve({ code: "BCDFGHJK" });

    expect(mocks.post).toHaveBeenNthCalledWith(
      1,
      "/api/users/login-codes/preview",
      { code: "BCDFGHJK" },
      {
        signal: undefined,
        timeout: 10000,
        headers: { Authorization: "Bearer jwt" },
      },
    );
    expect(mocks.post).toHaveBeenNthCalledWith(
      2,
      "/api/users/login-codes/approve",
      { code: "BCDFGHJK" },
      {
        signal: undefined,
        timeout: 10000,
        headers: { Authorization: "Bearer jwt" },
      },
    );
  });

  it("installs the minted session when a poll is approved", async () => {
    const approved = {
      status: "approved",
      token: "session-token",
      user: { id: "user-1", name: "root" },
      expiresAt: "2026-11-25T00:05:00.000Z",
      serverTime: "2026-11-25T00:00:00.000Z",
    };
    mocks.post.mockResolvedValue({ data: approved });

    const result = await loginCodeService.poll("request-token");

    expect(result).toEqual(approved);
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/users/login-codes/poll",
      { requestToken: "request-token" },
      { signal: undefined, timeout: 10000 },
    );
    expect(mocks.saveToken).toHaveBeenCalledWith("session-token");
  });

  it("does not install a session while a poll is still pending", async () => {
    mocks.post.mockResolvedValue({
      data: {
        status: "pending",
        codeExpiresAt: "2026-11-25T00:00:30.000Z",
        expiresAt: "2026-11-25T00:05:00.000Z",
        serverTime: "2026-11-25T00:00:00.000Z",
      },
    });

    const result = await loginCodeService.poll("request-token");

    expect(result.status).toBe("pending");
    expect(mocks.saveToken).not.toHaveBeenCalled();
  });
});
