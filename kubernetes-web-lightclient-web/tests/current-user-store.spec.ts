import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  saveToken: vi.fn(async () => {}),
  auth: { isAuthenticated: true },
}));

vi.mock("~~/services/UsersService", () => ({
  UsersService: { refreshSession: mocks.refreshSession },
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: { saveToken: mocks.saveToken },
}));

vi.mock("~~/stores/AuthenticationStore", () => ({
  AuthenticationStore: () => mocks.auth,
}));

import { CurrentUserStore } from "../stores/CurrentUserStore";

const ADMIN = {
  id: "user-1",
  name: "root",
  role: "admin",
  scopes: ["admin"],
};

const READER = {
  id: "user-2",
  name: "alice",
  role: "user",
  scopes: ["k8s:read", "stats:read"],
};

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.refreshSession.mockReset();
  mocks.saveToken.mockReset();
  mocks.auth.isAuthenticated = true;
});

describe("CurrentUserStore.ensureLoaded", () => {
  it("clears the cached user when signed out", async () => {
    const store = CurrentUserStore();
    store.setUser(ADMIN);
    mocks.auth.isAuthenticated = false;

    await store.ensureLoaded();

    expect(mocks.refreshSession).not.toHaveBeenCalled();
    expect(store.user).toBeNull();
    expect(store.loaded).toBe(false);
  });

  it("loads the live user, saves the refreshed token and caches the result", async () => {
    mocks.refreshSession.mockResolvedValue({ token: "fresh", user: ADMIN });
    const store = CurrentUserStore();

    await store.ensureLoaded();

    expect(store.user).toEqual(ADMIN);
    expect(store.loaded).toBe(true);
    expect(store.loading).toBe(false);
    expect(mocks.saveToken).toHaveBeenCalledWith("fresh");

    await store.ensureLoaded();
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);

    await store.ensureLoaded(true);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(2);
  });

  it("shares a single in-flight request", async () => {
    let release!: (value: unknown) => void;
    mocks.refreshSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const store = CurrentUserStore();

    const first = store.ensureLoaded();
    const second = store.ensureLoaded();
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);

    release({ token: "fresh", user: ADMIN });
    await Promise.all([first, second]);
    expect(store.user).toEqual(ADMIN);
  });

  it("clears on a 401", async () => {
    mocks.refreshSession.mockRejectedValue({
      response: { status: 401 },
    });
    const store = CurrentUserStore();
    store.$patch({ user: ADMIN as never });

    await store.ensureLoaded();

    expect(store.user).toBeNull();
    expect(store.loaded).toBe(false);
    expect(store.error).toBe("");
  });

  it("keeps the last user and surfaces a retryable error otherwise", async () => {
    mocks.refreshSession.mockRejectedValue(new Error("network down"));
    const store = CurrentUserStore();
    store.$patch({ user: ADMIN as never });

    await store.ensureLoaded();

    expect(store.user).toEqual(ADMIN);
    expect(store.error).toContain("could not be loaded");
    expect(store.loading).toBe(false);
  });
});

describe("CurrentUserStore getters", () => {
  it("treats the administrator role as every scope", () => {
    const store = CurrentUserStore();
    store.setUser(ADMIN);

    expect(store.isAdmin).toBe(true);
    expect(store.hasAdminScope).toBe(true);
    expect(store.hasScope("k8s:read")).toBe(true);
    expect(store.hasScope("k8s:write")).toBe(true);
    expect(store.hasScope("stats:read")).toBe(true);
  });

  it("does not conflate the admin scope with the role", () => {
    const store = CurrentUserStore();
    store.setUser({ ...READER, scopes: ["admin", "stats:read"] });

    expect(store.isAdmin).toBe(false);
    expect(store.hasAdminScope).toBe(true);
    expect(store.hasScope("admin")).toBe(true);
    expect(store.hasScope("k8s:read")).toBe(false);
  });

  it("reports only the granted scopes", () => {
    const store = CurrentUserStore();
    store.setUser(READER);

    expect(store.isAdmin).toBe(false);
    expect(store.hasAdminScope).toBe(false);
    expect(store.hasScope("k8s:read")).toBe(true);
    expect(store.hasScope("stats:read")).toBe(true);
    expect(store.hasScope("k8s:write")).toBe(false);
  });
});
