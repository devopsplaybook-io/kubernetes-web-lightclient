import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isInitialized: vi.fn(),
  saveToken: vi.fn(),
  removeToken: vi.fn(),
  getAuthHeader: vi.fn(async () => ({
    headers: { Authorization: "Bearer jwt" },
  })),
  getConfig: vi.fn(async () => ({ SERVER_URL: "/api" })),
  post: vi.fn(),
  put: vi.fn(),
  ensureLoaded: vi.fn(async () => {}),
  setUser: vi.fn(),
  clear: vi.fn(),
  auth: { isAuthenticated: false },
  current: {
    user: null as Record<string, unknown> | null,
    loading: false,
    error: "",
  },
}));

vi.mock("~~/stores/AuthenticationStore", () => ({
  AuthenticationStore: () => mocks.auth,
}));

vi.mock("~~/stores/CurrentUserStore", () => ({
  CurrentUserStore: () => ({
    get user() {
      return mocks.current.user;
    },
    loading: mocks.current.loading,
    error: mocks.current.error,
    ensureLoaded: mocks.ensureLoaded,
    setUser: mocks.setUser,
    clear: mocks.clear,
  }),
}));

vi.mock("~~/services/UserService", () => ({
  UserService: { isInitialized: mocks.isInitialized },
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: {
    saveToken: mocks.saveToken,
    removeToken: mocks.removeToken,
    getAuthHeader: mocks.getAuthHeader,
  },
}));

vi.mock("~~/services/Config", () => ({
  default: { get: mocks.getConfig },
}));

vi.mock("axios", () => ({
  default: { post: mocks.post, put: mocks.put },
}));

import ProfileSettings from "../components/ProfileSettings.vue";
import { CommonWebThemeKey } from "../services/Theme";

function mountProfile(
  query: Record<string, string> = {},
) {
  const router = { push: vi.fn(), replace: vi.fn() };
  const setTheme = vi.fn();
  const wrapper = mount(ProfileSettings, {
    global: {
      provide: {
        [CommonWebThemeKey]: { setTheme },
      },
      config: {
        globalProperties: {
          $router: router,
          $route: { path: "/settings", query },
        },
      },
    },
  });
  return { wrapper, router, setTheme };
}

beforeEach(() => {
  mocks.isInitialized.mockReset();
  mocks.saveToken.mockReset();
  mocks.removeToken.mockReset();
  mocks.post.mockReset();
  mocks.put.mockReset();
  mocks.ensureLoaded.mockReset();
  mocks.setUser.mockReset();
  mocks.clear.mockReset();
  mocks.isInitialized.mockResolvedValue(true);
  mocks.auth.isAuthenticated = false;
  mocks.current.user = null;
  mocks.current.loading = false;
  mocks.current.error = "";
  // Nuxt auto-import used by <script setup>; not transformed under Vitest.
  vi.stubGlobal("AuthenticationStore", () => mocks.auth);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProfileSettings bootstrap", () => {
  it("shows the first-administrator hint before any user exists", async () => {
    mocks.isInitialized.mockResolvedValue(false);
    const { wrapper } = mountProfile();
    await flushPromises();

    expect(wrapper.text()).toContain("New User");
    expect(wrapper.text()).toContain("No users exist yet");
    expect(wrapper.text()).toContain("first administrator account");
    const create = wrapper
      .findAll("button")
      .find((button) => button.text() === "Create");
    expect(create).toBeDefined();
    wrapper.unmount();
  });

  it("shows the login form once users exist", async () => {
    const { wrapper } = mountProfile();
    await flushPromises();

    expect(wrapper.text()).toContain("Login");
    expect(wrapper.text()).not.toContain("No users exist yet");
    wrapper.unmount();
  });
});

describe("ProfileSettings login and logout", () => {
  it("stores the token and live user on login", async () => {
    const liveUser = {
      id: "user-1",
      name: "alice",
      role: "user",
      scopes: ["k8s:read"],
    };
    mocks.post.mockResolvedValue({
      data: { token: "jwt-token", user: liveUser },
    });
    const { wrapper, router } = mountProfile({
      return: "/kubernetes?objectType=pod",
    });
    await flushPromises();

    await wrapper.find("#username").setValue("alice");
    await wrapper.find("#passwrd").setValue("secret");
    await wrapper.vm.login();
    await flushPromises();

    expect(mocks.post).toHaveBeenCalledWith(
      "/api/users/session",
      { name: "alice", password: "secret" },
      { headers: { Authorization: "Bearer jwt" } },
    );
    expect(mocks.saveToken).toHaveBeenCalledWith("jwt-token");
    expect(mocks.auth.isAuthenticated).toBe(true);
    expect(wrapper.vm.isInitialized).toBe(true);
    expect(mocks.setUser).toHaveBeenCalledWith(liveUser);
    expect(router.push).toHaveBeenCalledWith("/kubernetes?objectType=pod");
    wrapper.unmount();
  });

  it("ignores an unsafe return path", async () => {
    mocks.post.mockResolvedValue({
      data: { token: "jwt-token", user: { name: "alice" } },
    });
    const { wrapper, router } = mountProfile({ return: "//evil.com" });
    await flushPromises();

    await wrapper.find("#username").setValue("alice");
    await wrapper.find("#passwrd").setValue("secret");
    await wrapper.vm.login();
    await flushPromises();

    expect(router.push).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("clears the token and cached user on logout", async () => {
    mocks.auth.isAuthenticated = true;
    const { wrapper } = mountProfile();
    await flushPromises();

    const logout = wrapper
      .findAll("button")
      .find((button) => button.text() === "Logout");
    await logout!.trigger("click");

    expect(mocks.removeToken).toHaveBeenCalledTimes(1);
    expect(mocks.auth.isAuthenticated).toBe(false);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

describe("ProfileSettings access summary", () => {
  it("shows the current role and scopes", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.current.user = {
      id: "user-1",
      name: "alice",
      role: "user",
      scopes: ["k8s:read", "stats:read"],
    };
    const { wrapper } = mountProfile();
    await flushPromises();

    expect(mocks.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("Signed in as");
    expect(wrapper.text()).toContain("alice");
    expect(wrapper.text()).toContain("Kubernetes read");
    expect(wrapper.text()).toContain("Stats read");
    wrapper.unmount();
  });

  it("retries through the shared session refresh API", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.current.error = "Your role and scopes could not be loaded.";
    const { wrapper } = mountProfile();
    await flushPromises();

    const retry = wrapper
      .findAll("button")
      .find((button) => button.text() === "Retry");
    await retry!.trigger("click");
    await flushPromises();

    expect(mocks.ensureLoaded).toHaveBeenLastCalledWith(true);
    wrapper.unmount();
  });
});
