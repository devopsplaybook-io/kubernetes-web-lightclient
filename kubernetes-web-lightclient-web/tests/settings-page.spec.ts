import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: true, ensureAuthenticated: vi.fn(async () => true) },
  current: {
    isAdmin: true,
    ensureLoaded: vi.fn(async () => {}),
    clear: vi.fn(),
  },
  route: {
    path: "/settings",
    fullPath: "/settings",
    query: {} as Record<string, string>,
  },
  router: {
    push: vi.fn(async () => {}),
    replace: vi.fn(async () => {}),
  },
}));

vi.mock("~~/stores/AuthenticationStore", () => ({
  AuthenticationStore: () => mocks.auth,
}));

vi.mock("~~/stores/CurrentUserStore", () => ({
  CurrentUserStore: () => mocks.current,
}));

import SettingsPage from "../pages/settings.vue";

function mountPage() {
  return mount(SettingsPage, {
    shallow: true,
    global: {
      config: {
        globalProperties: {
          $route: mocks.route,
          $router: mocks.router,
        },
      },
    },
  });
}

beforeEach(() => {
  mocks.auth.isAuthenticated = true;
  mocks.auth.ensureAuthenticated.mockReset();
  mocks.auth.ensureAuthenticated.mockResolvedValue(true);
  mocks.current.isAdmin = true;
  mocks.current.ensureLoaded.mockReset();
  mocks.current.clear.mockReset();
  mocks.route.query = {};
  mocks.router.push.mockReset();
  mocks.router.replace.mockReset();
  vi.stubGlobal("useRoute", () => mocks.route);
  vi.stubGlobal("useRouter", () => mocks.router);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SettingsPage tabs", () => {
  it("shows the Users tab to administrators and honours ?tab=users", async () => {
    mocks.route.query = { tab: "users" };
    const wrapper = mountPage();
    await flushPromises();

    const labels = wrapper.findAll(".settings-tab").map((tab) => tab.text());
    expect(labels).toEqual([
      "Profile",
      "Resources",
      "API Token",
      "Users",
    ]);
    expect(wrapper.vm.activeTab).toBe("users");
    expect(mocks.current.ensureLoaded).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("hides the Users tab and falls back to Profile for non-admins", async () => {
    mocks.current.isAdmin = false;
    mocks.route.query = { tab: "users" };
    const wrapper = mountPage();
    await flushPromises();

    const labels = wrapper.findAll(".settings-tab").map((tab) => tab.text());
    expect(labels).not.toContain("Users");
    expect(wrapper.vm.activeTab).toBe("profile");
    wrapper.unmount();
  });

  it("clears the cached user when signed out", async () => {
    mocks.auth.isAuthenticated = false;
    mocks.auth.ensureAuthenticated.mockResolvedValue(false);
    const wrapper = mountPage();
    await flushPromises();

    const labels = wrapper.findAll(".settings-tab").map((tab) => tab.text());
    expect(labels).toEqual(["Profile"]);
    expect(mocks.current.clear).toHaveBeenCalledTimes(1);
    expect(mocks.current.ensureLoaded).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("mirrors a tab selection into the URL", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const resources = wrapper
      .findAll(".settings-tab")
      .find((tab) => tab.text() === "Resources");
    await resources!.trigger("click");

    expect(wrapper.vm.activeTab).toBe("resources");
    expect(mocks.router.replace).toHaveBeenCalledWith({
      path: "/settings",
      query: { tab: "resources" },
    });
    wrapper.unmount();
  });
});
