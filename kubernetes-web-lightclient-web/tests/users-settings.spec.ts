import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  tokensList: vi.fn(),
  tokensRevoke: vi.fn(),
  ensureLoaded: vi.fn(async () => {}),
  current: {
    user: { id: "u-admin", name: "root", role: "admin", scopes: ["admin"] },
    isAdmin: true,
  },
}));

vi.mock("~~/services/UsersService", () => ({
  UsersService: {
    list: mocks.list,
    create: mocks.create,
    update: mocks.update,
    remove: mocks.remove,
  },
}));

vi.mock("~~/services/ApiTokensService", () => ({
  ApiTokensService: {
    list: mocks.tokensList,
    revoke: mocks.tokensRevoke,
  },
}));

vi.mock("~~/stores/CurrentUserStore", () => ({
  CurrentUserStore: () => ({
    ...mocks.current,
    ensureLoaded: mocks.ensureLoaded,
  }),
}));

import UsersSettings from "../components/UsersSettings.vue";

const ADMIN = {
  id: "u-admin",
  name: "root",
  role: "admin",
  scopes: ["admin", "k8s:read", "stats:read"],
};

const ALICE = {
  id: "u-1",
  name: "alice",
  role: "user",
  scopes: ["k8s:read"],
};

function httpError(url: string, status = 403): unknown {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    config: { url },
    response: { status, data: { error: "Forbidden" } },
  };
}

function mountComponent() {
  const router = { push: vi.fn(), replace: vi.fn() };
  const wrapper = mount(UsersSettings, {
    global: {
      config: {
        globalProperties: {
          $router: router,
          $route: { query: {} },
        },
      },
    },
  });
  return { wrapper, router };
}

beforeEach(() => {
  mocks.list.mockReset();
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.remove.mockReset();
  mocks.tokensList.mockReset();
  mocks.tokensRevoke.mockReset();
  mocks.ensureLoaded.mockReset();
  mocks.list.mockResolvedValue([ADMIN, ALICE]);
  mocks.tokensList.mockResolvedValue([]);
  mocks.current.isAdmin = true;
  mocks.current.user = {
    id: "u-admin",
    name: "root",
    role: "admin",
    scopes: ["admin"],
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("UsersSettings access control", () => {
  it("hides user administration from non-admins", async () => {
    mocks.current.isAdmin = false;
    const { wrapper } = mountComponent();
    await flushPromises();

    expect(mocks.list).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Administrator role required");
    expect(wrapper.text()).toContain("Only users with the administrator role");
    expect(wrapper.find(".user-list").exists()).toBe(false);
    wrapper.unmount();
  });

  it("lists users and marks the signed-in account", async () => {
    const { wrapper } = mountComponent();
    await flushPromises();

    expect(mocks.list).toHaveBeenCalledTimes(1);
    const cards = wrapper.findAll(".user-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].classes()).toContain("is-self");
    expect(cards[0].text()).toContain("root");
    expect(cards[0].text()).toContain("You");
    expect(cards[1].text()).toContain("alice");
    expect(wrapper.findAll(".user-card")[0].find(".user-delete").exists()).toBe(
      false,
    );
    expect(wrapper.findAll(".user-card")[1].find(".user-delete").exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("shows the empty and generic-error states with retry", async () => {
    mocks.list.mockResolvedValueOnce([]);
    const empty = mountComponent().wrapper;
    await flushPromises();
    expect(empty.text()).toContain("No users found.");
    empty.unmount();

    mocks.list.mockReset();
    mocks.list.mockRejectedValueOnce(new Error("network down"));
    const failing = mountComponent().wrapper;
    await flushPromises();
    expect(failing.text()).toContain("Unable to load the users");
    failing.unmount();
  });

  it("shows the administrator-role denial for a 403 from the users API", async () => {
    mocks.list.mockReset();
    mocks.list.mockRejectedValueOnce(httpError("/api/users?limit=1000"));
    const { wrapper } = mountComponent();
    await flushPromises();

    expect(wrapper.text()).toContain("Administrator role required");
    expect(wrapper.text()).toContain("promote your account");
    wrapper.unmount();
  });
});

describe("UsersSettings user changes", () => {
  it("creates a user with the chosen role and scopes", async () => {
    mocks.create.mockResolvedValue({ ...ALICE, id: "u-2", name: "bob" });
    const { wrapper } = mountComponent();
    await flushPromises();

    wrapper.vm.newUser = {
      name: " bob ",
      password: "secret",
      role: "user",
      scopes: ["k8s:read", "stats:read"],
    };
    await wrapper.vm.createUser();
    await flushPromises();

    expect(mocks.create).toHaveBeenCalledWith({
      name: "bob",
      password: "secret",
      role: "user",
      scopes: ["k8s:read", "stats:read"],
    });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("does not create a user without a name or password", async () => {
    const { wrapper } = mountComponent();
    await flushPromises();

    wrapper.vm.newUser = {
      name: "",
      password: "",
      role: "user",
      scopes: [],
    };
    await wrapper.vm.createUser();

    expect(mocks.create).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("saves an ordinary user change without asking for confirmation", async () => {
    mocks.update.mockResolvedValue({ ...ALICE, role: "admin" });
    const { wrapper } = mountComponent();
    await flushPromises();

    wrapper.vm.draftFor(ALICE).role = "admin";
    await wrapper.vm.requestSave(ALICE);
    await flushPromises();

    expect(wrapper.vm.pendingEdit).toBeNull();
    expect(mocks.update).toHaveBeenCalledWith("u-1", {
      role: "admin",
      scopes: ["k8s:read"],
    });
    wrapper.unmount();
  });

  it("asks for confirmation before changing your own account", async () => {
    mocks.update.mockResolvedValue(ADMIN);
    const { wrapper } = mountComponent();
    await flushPromises();

    wrapper.vm.draftFor(ADMIN).scopes = ["admin", "k8s:read"];
    await wrapper.vm.requestSave(ADMIN);
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.pendingEdit).not.toBeNull();
    expect(document.body.querySelector("#dialog-confirm")).not.toBeNull();
    expect(document.body.textContent).toContain("your own account");

    document.body
      .querySelector<HTMLButtonElement>(
        "#dialog-confirm footer button:last-child",
      )!
      .click();
    await flushPromises();

    expect(mocks.update).toHaveBeenCalledWith("u-admin", {
      role: "admin",
      scopes: ["admin", "k8s:read"],
    });
    wrapper.unmount();
  });

  it("confirms before removing admin rights from another user", async () => {
    const operator = { ...ALICE, role: "admin", scopes: ["admin"] };
    mocks.list.mockResolvedValue([ADMIN, operator]);
    const { wrapper } = mountComponent();
    await flushPromises();

    wrapper.vm.draftFor(operator).role = "user";
    await wrapper.vm.requestSave(operator);

    expect(wrapper.vm.pendingEdit).not.toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();

    await wrapper.vm.confirmSave();
    expect(mocks.update).toHaveBeenCalledWith("u-1", {
      role: "user",
      scopes: ["admin"],
    });
    wrapper.unmount();
  });

  it("resets a password only after confirmation and never prefills it", async () => {
    mocks.update.mockResolvedValue(ALICE);
    const { wrapper } = mountComponent();
    await flushPromises();

    wrapper.vm.startPasswordReset(ALICE);
    expect(wrapper.vm.newPassword).toBe("");
    wrapper.vm.requestPasswordReset();
    expect(wrapper.vm.pendingPassword).toBeNull();

    wrapper.vm.newPassword = "brand-new";
    wrapper.vm.requestPasswordReset();
    expect(wrapper.vm.pendingPassword).not.toBeNull();
    expect(wrapper.vm.newPassword).toBe("");

    await wrapper.vm.confirmPasswordReset();

    expect(mocks.update).toHaveBeenCalledWith("u-1", {
      password: "brand-new",
    });
    expect(wrapper.vm.pendingPassword).toBeNull();
    wrapper.unmount();
  });

  it("deletes a user after confirmation", async () => {
    mocks.remove.mockResolvedValue(undefined);
    const { wrapper } = mountComponent();
    await flushPromises();

    wrapper.vm.requestDelete(ALICE);
    expect(wrapper.vm.deleteTarget).toEqual(ALICE);

    await wrapper.vm.confirmDelete();

    expect(mocks.remove).toHaveBeenCalledWith("u-1");
    wrapper.unmount();
  });

  it("asks before demoting yourself and redirects away from the Users tab", async () => {
    mocks.update.mockResolvedValue({ ...ADMIN, role: "user" });
    mocks.ensureLoaded.mockImplementation(async () => {
      mocks.current.isAdmin = false;
      mocks.current.user = { ...ADMIN, role: "user" };
    });
    const { wrapper, router } = mountComponent();
    await flushPromises();

    wrapper.vm.draftFor(ADMIN).role = "user";
    await wrapper.vm.requestSave(ADMIN);
    await wrapper.vm.confirmSave();
    await flushPromises();

    expect(mocks.update).toHaveBeenCalledWith("u-admin", {
      role: "user",
      scopes: ["k8s:read", "stats:read", "admin"],
    });
    expect(mocks.ensureLoaded).toHaveBeenCalledWith(true);
    expect(router.replace).toHaveBeenCalledWith({
      path: "/settings",
      query: { tab: "profile" },
    });
    wrapper.unmount();
  });

  it("reports an action 403 with the missing role instead of the raw server body", async () => {
    mocks.update.mockRejectedValue(httpError("/api/users/u-1"));
    const { wrapper } = mountComponent();
    await flushPromises();

    wrapper.vm.draftFor(ALICE).role = "admin";
    await wrapper.vm.requestSave(ALICE);
    await flushPromises();

    expect(wrapper.text()).toContain("administrator role");
    expect(wrapper.text()).not.toContain("Forbidden");
    wrapper.unmount();
  });

  it("never renders password hashes or API token values", async () => {
    mocks.list.mockResolvedValue([
      {
        ...ALICE,
        passwordHash: "$2b$10$super-secret-hash",
        token: "plain-token-value",
      },
    ]);
    mocks.tokensList.mockResolvedValue([
      {
        id: "token-1",
        name: "machine-client",
        dateCreated: "2026-10-07T10:00:00.000Z",
        expiresAt: null,
        lastUsedAt: null,
        token: "plain-token-value",
      },
    ]);
    const { wrapper } = mountComponent();
    await flushPromises();

    expect(wrapper.text()).toContain("machine-client");
    expect(wrapper.text()).not.toContain("$2b$10$super-secret-hash");
    expect(wrapper.text()).not.toContain("plain-token-value");
    wrapper.unmount();
  });
});

describe("UsersSettings own API tokens", () => {
  it("lists only metadata and revokes after confirmation", async () => {
    const token = {
      id: "token-1",
      name: "machine-client",
      dateCreated: "2026-10-07T10:00:00.000Z",
      expiresAt: null,
      lastUsedAt: null,
    };
    mocks.tokensList.mockResolvedValue([token]);
    mocks.tokensRevoke.mockResolvedValue({});
    const { wrapper } = mountComponent();
    await flushPromises();

    expect(wrapper.text()).toContain("machine-client");
    expect(wrapper.text()).toContain("Never");

    wrapper.vm.tokenToRevoke = token;
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector("#dialog-confirm")).not.toBeNull();

    await wrapper.vm.confirmRevokeToken();
    await flushPromises();

    expect(mocks.tokensRevoke).toHaveBeenCalledWith("token-1");
    expect(mocks.tokensList).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
