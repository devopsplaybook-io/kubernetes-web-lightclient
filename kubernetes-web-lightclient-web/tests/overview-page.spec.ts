import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statsApiMocks = vi.hoisted(() => ({
  getPodUsage: vi.fn(),
}));

vi.mock("~~/services/StatsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/services/StatsApi")>();
  return { ...actual, StatsApi: { ...actual.StatsApi, ...statsApiMocks } };
});

const userMock = vi.hoisted(() => ({
  ensureLoaded: vi.fn(async () => {}),
  error: "",
  isAdmin: false,
  scopes: [] as string[],
  hasScope(scope: string) {
    return this.scopes.includes(scope);
  },
}));

vi.mock("~~/stores/CurrentUserStore", () => ({
  CurrentUserStore: () => userMock,
}));

import OverviewPage from "../pages/overview.vue";

const NuxtLinkStub = {
  name: "NuxtLink",
  props: { to: { type: [String, Object], default: "" } },
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
};

function makePod(name: string, overrides: Record<string, any> = {}): any {
  return {
    metadata: {
      name,
      namespace: "default",
      uid: `uid-${name}`,
      labels: {},
      creationTimestamp: "2026-11-01T00:00:00Z",
    },
    spec: { containers: [{ resources: { requests: { cpu: "100m" }, limits: { cpu: "200m" } } }] },
    status: { phase: "Running", containerStatuses: [{ ready: true, restartCount: 0 }] },
    ...overrides,
  };
}

function makeStore(overrides: Record<string, any> = {}) {
  return {
    dataFull: { node: [], pod: [], events: [], deployment: [] },
    loadingTypes: {},
    loadErrors: {},
    permissionError: null,
    getNodes: vi.fn(async () => {}),
    getPods: vi.fn(async () => {}),
    getEvents: vi.fn(async () => {}),
    getDeployments: vi.fn(async () => {}),
    ...overrides,
  };
}

function mountOverview(store: any, router = { push: vi.fn() }) {
  vi.stubGlobal("KubernetesObjectStore", () => store);
  vi.stubGlobal("useRouter", () => router);
  vi.stubGlobal("useRoute", () => ({ fullPath: "/", query: {} }));
  const wrapper = mount(OverviewPage, {
    global: { stubs: { NuxtLink: NuxtLinkStub } },
  });
  return { wrapper, router };
}

function hrefs(wrapper: any): string[] {
  return wrapper.findAll("a").map((link: any) => link.attributes("href"));
}

beforeEach(() => {
  statsApiMocks.getPodUsage.mockReset();
  statsApiMocks.getPodUsage.mockResolvedValue({
    notModified: false,
    etag: '"usage-1"',
    data: { podUsageStats: [] },
  });
  userMock.ensureLoaded.mockClear();
  userMock.error = "";
  userMock.isAdmin = false;
  userMock.scopes = ["k8s:read", "stats:read"];
  vi.stubGlobal("AuthenticationStore", () => ({
    ensureAuthenticated: vi.fn(async () => true),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("overview page authentication", () => {
  it("sends unauthenticated visitors to Settings with a return path", async () => {
    vi.stubGlobal("AuthenticationStore", () => ({
      ensureAuthenticated: vi.fn(async () => false),
    }));
    const store = makeStore();
    const { wrapper, router } = mountOverview(store);
    await flushPromises();

    expect(router.push).toHaveBeenCalledWith({
      path: "/settings",
      query: { tab: "profile", return: "/" },
    });
    expect(store.getNodes).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("overview page data flow", () => {
  function richStore() {
    return makeStore({
      dataFull: {
        node: [
          {
            metadata: { name: "node-a", uid: "n1" },
            status: {
              conditions: [{ type: "Ready", status: "True" }],
              allocatable: { cpu: "2", memory: "4Gi" },
            },
          },
          {
            metadata: { name: "node-b", uid: "n2" },
            status: {
              conditions: [{ type: "Ready", status: "False" }],
              allocatable: { cpu: "2", memory: "4Gi" },
            },
          },
        ],
        pod: [
          makePod("pod-ready"),
          makePod("pod-pending", { status: { phase: "Pending" } }),
          makePod("pod-crash", {
            metadata: {
              name: "pod-crash",
              namespace: "default",
              uid: "uid-pod-crash",
              labels: { app: "web" },
              ownerReferences: [{ kind: "ReplicaSet", name: "web-abc", uid: "rs-uid" }],
            },
            status: {
              phase: "Running",
              containerStatuses: [
                {
                  ready: false,
                  restartCount: 3,
                  state: { waiting: { reason: "CrashLoopBackOff" } },
                  lastState: { terminated: { finishedAt: "2026-11-02T00:00:00Z" } },
                },
              ],
            },
          }),
        ],
        events: [
          {
            type: "Warning",
            reason: "BackOff",
            message: "Back-off restarting failed container",
            count: 4,
            lastTimestamp: "2026-11-02T00:00:00Z",
            involvedObject: { kind: "Pod", name: "pod-crash", namespace: "default" },
            metadata: { uid: "event-1" },
          },
        ],
        deployment: [
          {
            metadata: { name: "web", namespace: "default" },
            spec: { selector: { matchLabels: { app: "web" } } },
          },
        ],
      },
    });
  }

  it("loads every source once and renders the live values", async () => {
    statsApiMocks.getPodUsage.mockResolvedValue({
      notModified: false,
      etag: '"usage-1"',
      data: {
        podUsageStats: [
          { name: "pod-ready", namespace: "default", cpuLatest: 100, memoryLatest: 1024 },
        ],
      },
    });
    const store = richStore();
    const { wrapper } = mountOverview(store);
    await flushPromises();

    expect(store.getNodes).toHaveBeenCalledTimes(1);
    expect(store.getPods).toHaveBeenCalledTimes(1);
    expect(store.getEvents).toHaveBeenCalledTimes(1);
    expect(store.getDeployments).toHaveBeenCalledTimes(1);
    expect(statsApiMocks.getPodUsage).toHaveBeenCalledTimes(1);

    const text = wrapper.text();
    expect(text).toContain("1/2");
    expect(text).toContain("node-b");
    expect(text).toContain("CrashLoopBackOff");
    expect(text).toContain("BackOff");
    expect(text).toContain("web");
    expect(text).toContain("usage");
    wrapper.unmount();
  });

  it("deep-links every tile and row into the existing filtered lists", async () => {
    const store = richStore();
    const { wrapper } = mountOverview(store);
    await flushPromises();

    const links = hrefs(wrapper);
    expect(links).toContain("/kubernetes");
    expect(links).toContain("/kubernetes/stats");
    expect(links).toContain("/kubernetes?objectType=node&filter=has-warnings");
    expect(links).toContain("/kubernetes?objectType=pod&filter=not-running");
    expect(links).toContain("/kubernetes?objectType=pod&filter=pending");
    expect(links).toContain("/kubernetes?objectType=pod&filter=crashloop");
    expect(links).toContain("/kubernetes?objectType=events&filter=warnings");
    expect(links).toContain("/kubernetes?objectType=pod&filter=restarts");
    expect(links).toContain(
      "/kubernetes?objectType=pod&workload=deployment&workloadName=web&namespace=default",
    );
    expect(links).toContain(
      "/kubernetes?objectType=node&dialog=details&name=node-b",
    );
    wrapper.unmount();
  });

  it("does not fetch cluster resources without the k8s:read scope", async () => {
    userMock.scopes = ["stats:read"];
    const store = richStore();
    const { wrapper } = mountOverview(store);
    await flushPromises();

    expect(store.getNodes).not.toHaveBeenCalled();
    expect(store.getPods).not.toHaveBeenCalled();
    expect(store.getEvents).not.toHaveBeenCalled();
    expect(store.getDeployments).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("k8s:read");
    wrapper.unmount();
  });

  it("does not fetch pod usage without the stats:read scope", async () => {
    userMock.scopes = ["k8s:read"];
    const store = richStore();
    const { wrapper } = mountOverview(store);
    await flushPromises();

    expect(statsApiMocks.getPodUsage).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("stats:read");
    wrapper.unmount();
  });

  it("renders a neutral metrics state when metrics-server returns no usage", async () => {
    statsApiMocks.getPodUsage.mockResolvedValue({
      notModified: false,
      etag: '"usage-1"',
      data: {
        podUsageStats: [{ name: "pod-ready", namespace: "default", cpuLatest: null, memoryLatest: null }],
      },
    });
    const store = richStore();
    const { wrapper } = mountOverview(store);
    await flushPromises();

    expect(wrapper.text()).toContain("Metrics unavailable");
    wrapper.unmount();
  });

  it("renders a neutral metrics state when the usage request fails", async () => {
    statsApiMocks.getPodUsage.mockRejectedValue(new Error("network down"));
    const store = richStore();
    const { wrapper } = mountOverview(store);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("Metrics unavailable");
    expect(text).not.toContain("Could not load");
    wrapper.unmount();
  });

  it("shows the tile error state with a retry when a listing fails", async () => {
    const store = richStore();
    store.loadErrors = { pod: "Could not load pod data." };
    const { wrapper } = mountOverview(store);
    await flushPromises();

    expect(wrapper.text()).toContain("Could not load pod data.");
    const retry = wrapper
      .findAll("button")
      .find((button: any) => button.text() === "Retry");
    expect(retry).toBeDefined();

    await retry.trigger("click");
    await flushPromises();
    expect(store.getPods).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
