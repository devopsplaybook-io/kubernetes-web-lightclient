import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resourceMock = vi.hoisted(() => ({
  getAvailableTypes: vi.fn(),
}));

vi.mock("~~/services/ResourceService", () => ({
  ResourceService: resourceMock,
}));

import KubernetesPage from "../pages/kubernetes/index.vue";
import RootPage from "../pages/index.vue";

const methods = (KubernetesPage as any).methods;
const computed = (KubernetesPage as any).computed;

function forbidden(url: string, data: unknown = {}): unknown {
  return {
    isAxiosError: true,
    message: "Request failed with status code 403",
    config: { url, data },
    response: { status: 403, data: { error: "Forbidden" } },
  };
}

beforeEach(() => {
  resourceMock.getAvailableTypes.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("root page bootstrap redirect", () => {
  it("sends authenticated visitors to the cluster overview page", async () => {
    const router = { push: vi.fn(async () => {}) };
    vi.stubGlobal("AuthenticationStore", () => ({
      ensureAuthenticated: vi.fn(async () => true),
    }));
    vi.stubGlobal("useRouter", () => router);
    vi.stubGlobal("useRoute", () => ({ fullPath: "/" }));

    const wrapper = mount(RootPage);
    await flushPromises();

    expect(router.push).toHaveBeenCalledWith({ path: "/overview" });
    wrapper.unmount();
  });

  it("sends unauthenticated visitors to the Profile tab with a return path", async () => {
    const router = { push: vi.fn(async () => {}) };
    vi.stubGlobal("AuthenticationStore", () => ({
      ensureAuthenticated: vi.fn(async () => false),
    }));
    vi.stubGlobal("useRouter", () => router);
    vi.stubGlobal("useRoute", () => ({
      fullPath: "/kubernetes?objectType=pod",
    }));

    const wrapper = mount(RootPage);
    await flushPromises();

    expect(router.push).toHaveBeenCalledWith({
      path: "/settings",
      query: {
        tab: "profile",
        return: "/kubernetes?objectType=pod",
      },
    });
    wrapper.unmount();
  });
});

describe("kubernetes list access denial", () => {
  it("derives the denial from a page error or the store's failed load", () => {
    const fromStore = computed.accessDenial.call({
      accessError: null,
      kubernetesObjectStore: { permissionError: "k8s:read" },
    });
    expect(fromStore.scope).toBe("k8s:read");
    expect(fromStore.message).toContain("k8s:read");

    const pageError = {
      scope: "admin",
      title: "Missing scope",
      message: "Needs admin",
    };
    expect(
      computed.accessDenial.call({
        accessError: pageError,
        kubernetesObjectStore: { permissionError: null },
      }),
    ).toBe(pageError);

    expect(
      computed.accessDenial.call({
        accessError: null,
        kubernetesObjectStore: { permissionError: null },
      }),
    ).toBeNull();
  });

  it("stops polling when a 403 is classified", () => {
    const ctx = { accessError: null as any, stopPolling: vi.fn() };

    expect(
      methods.applyAccessError.call(ctx, forbidden("/api/resources/types")),
    ).toBe(true);
    expect(ctx.accessError.scope).toBe("k8s:read");
    expect(ctx.stopPolling).toHaveBeenCalledTimes(1);

    expect(methods.applyAccessError.call(ctx, new Error("network down"))).toBe(
      false,
    );
    expect(ctx.stopPolling).toHaveBeenCalledTimes(1);
  });

  it("aborts the initial load on a forbidden type list", async () => {
    resourceMock.getAvailableTypes.mockRejectedValue(
      forbidden("/api/resources/types"),
    );
    vi.stubGlobal("useRoute", () => ({ query: {} }));
    const store = {
      clearPermissionError: vi.fn(),
      selectedTypes: [],
      loadSelectedTypes: vi.fn(async () => {}),
    };
    vi.stubGlobal("KubernetesObjectStore", () => store);
    const ctx = {
      accessError: null as any,
      stopPolling: vi.fn(),
      availableTypes: [],
      typesLoaded: false,
      kubernetesObjectStore: store,
      objectType: "pod",
      drilldown: null,
      applyAccessError: methods.applyAccessError,
    };

    await methods.loadInitialData.call(ctx);

    expect(ctx.accessError.scope).toBe("k8s:read");
    expect(ctx.typesLoaded).toBe(false);
    expect(store.loadSelectedTypes).not.toHaveBeenCalled();
    expect(ctx.stopPolling).toHaveBeenCalledTimes(1);
  });

  it("clears the denial and restarts polling on retry", async () => {
    const refreshLast = vi.fn();
    vi.stubGlobal("KubernetesObjectStore", () => ({ refreshLast }));
    const ctx = {
      accessError: { scope: "k8s:read" } as any,
      accessDenial: null,
      kubernetesObjectStore: { clearPermissionError: vi.fn() },
      loadInitialData: vi.fn(async () => {}),
      startPolling: vi.fn(),
    };

    await methods.retryAccess.call(ctx);

    expect(ctx.accessError).toBeNull();
    expect(ctx.kubernetesObjectStore.clearPermissionError).toHaveBeenCalled();
    expect(ctx.startPolling).toHaveBeenCalledTimes(1);
    expect(refreshLast).toHaveBeenCalledTimes(1);
  });

  it("does not restart polling when the retry is still denied", async () => {
    vi.stubGlobal("KubernetesObjectStore", () => ({ refreshLast: vi.fn() }));
    const ctx = {
      accessError: { scope: "k8s:read" } as any,
      accessDenial: { scope: "k8s:read" } as any,
      kubernetesObjectStore: { clearPermissionError: vi.fn() },
      loadInitialData: vi.fn(async () => {}),
      startPolling: vi.fn(),
    };

    await methods.retryAccess.call(ctx);

    expect(ctx.startPolling).not.toHaveBeenCalled();
  });

  it("loads types and namespaces again when the retry is allowed", async () => {
    resourceMock.getAvailableTypes.mockResolvedValue([{ id: "pod" }]);
    vi.stubGlobal("useRoute", () => ({ query: {} }));
    const store = {
      clearPermissionError: vi.fn(),
      selectedTypes: [],
      loadSelectedTypes: vi.fn(async () => {}),
    };
    vi.stubGlobal("KubernetesObjectStore", () => store);
    const ctx = {
      accessError: null as any,
      stopPolling: vi.fn(),
      availableTypes: [],
      typesLoaded: false,
      kubernetesObjectStore: store,
      objectType: "pod",
      drilldown: null,
      namespaceStore: { loadNamespaces: vi.fn(async () => {}) },
      refreshIntervalValue: "0",
      applyAccessError: methods.applyAccessError,
    };

    await methods.loadInitialData.call(ctx);

    expect(ctx.typesLoaded).toBe(true);
    expect(ctx.availableTypes).toEqual([{ id: "pod" }]);
    expect(ctx.namespaceStore.loadNamespaces).toHaveBeenCalledTimes(1);
    expect(ctx.accessError).toBeNull();
  });
});
