import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  getAuthHeader: vi.fn(async () => ({
    headers: { Authorization: "Bearer jwt-token" },
  })),
  getConfig: vi.fn(async () => ({ SERVER_URL: "/api" })),
}));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    put: mocks.put,
    delete: mocks.delete,
  },
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: { getAuthHeader: mocks.getAuthHeader },
}));

vi.mock("~~/services/Config", () => ({
  default: { get: mocks.getConfig },
}));

import { UsersService } from "../services/UsersService";

const AUTH_HEADER = { headers: { Authorization: "Bearer jwt-token" } };

const USER = {
  id: "user-1",
  name: "alice",
  role: "user",
  scopes: ["k8s:read"],
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.put.mockReset();
  mocks.delete.mockReset();
});

describe("UsersService", () => {
  it("lists every user with the auth header", async () => {
    mocks.get.mockResolvedValue({ data: [USER] });

    await expect(UsersService.list()).resolves.toEqual([USER]);
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/users?limit=1000",
      AUTH_HEADER,
    );
  });

  it("returns an empty list when the payload is missing", async () => {
    mocks.get.mockResolvedValue({ data: undefined });
    await expect(UsersService.list()).resolves.toEqual([]);
  });

  it("creates a user with the chosen role and scopes", async () => {
    mocks.post.mockResolvedValue({ data: { user: USER } });

    await expect(
      UsersService.create({
        name: "alice",
        password: "secret",
        role: "user",
        scopes: ["k8s:read"],
      }),
    ).resolves.toEqual(USER);
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/users",
      {
        name: "alice",
        password: "secret",
        role: "user",
        scopes: ["k8s:read"],
      },
      AUTH_HEADER,
    );
  });

  it("updates role and scopes without sending undefined fields", async () => {
    mocks.put.mockResolvedValue({ data: { user: USER } });

    await UsersService.update("user-1", {
      role: "admin",
      scopes: ["admin"],
      password: undefined,
    });
    expect(mocks.put).toHaveBeenCalledWith(
      "/api/users/user-1",
      { role: "admin", scopes: ["admin"] },
      AUTH_HEADER,
    );
  });

  it("encodes the id in the update and delete URLs", async () => {
    mocks.put.mockResolvedValue({ data: { user: USER } });
    mocks.delete.mockResolvedValue({ data: {} });

    await UsersService.update("a b", { password: "new" });
    expect(mocks.put).toHaveBeenCalledWith(
      "/api/users/a%20b",
      { password: "new" },
      AUTH_HEADER,
    );

    await UsersService.remove("a b");
    expect(mocks.delete).toHaveBeenCalledWith(
      "/api/users/a%20b",
      AUTH_HEADER,
    );
  });

  it("refreshes the session through the existing endpoint", async () => {
    mocks.post.mockResolvedValue({
      data: { token: "fresh-jwt", user: USER },
    });

    await expect(UsersService.refreshSession()).resolves.toEqual({
      token: "fresh-jwt",
      user: USER,
    });
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/users/session/refresh",
      {},
      AUTH_HEADER,
    );
  });
});
