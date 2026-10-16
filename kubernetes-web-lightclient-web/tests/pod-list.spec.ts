import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KubernetesPodList from "../components/KubernetesPodList.vue";
import { ListPreferencesService } from "~~/services/ListPreferencesService";

const prefsState = vi.hoisted(() => ({
  preferences: {} as Record<string, any>,
}));

vi.mock("~~/services/ListPreferencesService", () => ({
  ListPreferencesService: {
    ensureLoaded: vi.fn(async () => {}),
    isLoaded: vi.fn(() => true),
    get: vi.fn((typeId: string) => prefsState.preferences[typeId] || {}),
    set: vi.fn((typeId: string, pref: any) => {
      prefsState.preferences[typeId] = pref;
    }),
  },
}));

vi.mock("~~/stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => ({}),
}));

function makePod(
  name: string,
  ready: boolean,
  restarts: number,
  overrides: Record<string, any> = {},
): Record<string, any> {
  return {
    metadata: {
      uid: `uid-${name}`,
      name,
      namespace: "default",
      creationTimestamp: "2026-10-15T00:00:00Z",
    },
    status: {
      phase: "Running",
      containerStatuses: [{ ready, restartCount: restarts }],
    },
    ...overrides,
  };
}

function mountWithPods(pods: Record<string, any>[]) {
  const store = {
    data: { pods } as { [key: string]: any[] },
    loading: false,
    getPods: vi.fn(),
  };
  vi.stubGlobal("KubernetesObjectStore", () => store);
  vi.stubGlobal("NamespaceStore", () => ({}));
  const wrapper = mount(KubernetesPodList, {
    global: {
      config: {
        globalProperties: {
          $route: { path: "/kubernetes", query: {} },
          $router: { replace: vi.fn() },
        },
      },
    },
  });
  return wrapper;
}

function rowNames(wrapper: any): string[] {
  return wrapper.findAll("tbody tr").map((row: any) => row.findAll("td")[1].text());
}

async function clickHeader(wrapper: any, label: string) {
  const header = wrapper
    .findAll("thead th")
    .find((th: any) => th.text().startsWith(label));
  expect(header, `header ${label} should exist`).toBeDefined();
  await header.trigger("click");
  await flushPromises();
  return header;
}

beforeEach(() => {
  prefsState.preferences = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("KubernetesPodList", () => {
  it("renders one row per pod with the expected columns", async () => {
    const wrapper = mountWithPods([makePod("pod-a", true, 0)]);

    const rows = wrapper.findAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("pod-a");
    const headers = wrapper.findAll("thead th").map((th: any) => th.text());
    expect(headers.slice(0, 6)).toEqual([
      "Namespace",
      "Pod",
      "Status",
      "Age",
      "Ready",
      "Restarts",
    ]);
    wrapper.unmount();
  });

  it("sorts by Restarts descending on first click and toggles direction", async () => {
    const wrapper = mountWithPods([
      makePod("pod-zero", true, 0),
      makePod("pod-three", true, 3),
      makePod("pod-one", true, 1),
    ]);

    await clickHeader(wrapper, "Restarts");
    expect(rowNames(wrapper)).toEqual(["pod-three", "pod-one", "pod-zero"]);

    await clickHeader(wrapper, "Restarts");
    expect(rowNames(wrapper)).toEqual(["pod-zero", "pod-one", "pod-three"]);
    wrapper.unmount();
  });

  it("marks sorted headers with aria-sort", async () => {
    const wrapper = mountWithPods([makePod("pod-a", true, 0)]);

    const header = await clickHeader(wrapper, "Pod");
    expect(header.attributes("aria-sort")).toBe("ascending");
    wrapper.unmount();
  });

  it("hides fully ready pods with the Not ready filter", async () => {
    const wrapper = mountWithPods([
      makePod("pod-ready", true, 0),
      makePod("pod-crashloop", false, 5),
    ]);

    const notReadyChip = wrapper
      .findAll("button")
      .find((button: any) => button.text() === "Not ready");
    expect(notReadyChip).toBeDefined();
    expect(notReadyChip.attributes("aria-pressed")).toBe("false");

    await notReadyChip.trigger("click");
    await flushPromises();

    expect(rowNames(wrapper)).toEqual(["pod-crashloop"]);
    expect(notReadyChip.attributes("aria-pressed")).toBe("true");
    wrapper.unmount();
  });

  it("hides pods without restarts with the Restarts > 0 filter", async () => {
    const wrapper = mountWithPods([
      makePod("pod-ready", true, 0),
      makePod("pod-restarted", true, 2),
    ]);

    const restartsChip = wrapper
      .findAll("button")
      .find((button: any) => button.text() === "Restarts > 0");
    await restartsChip.trigger("click");
    await flushPromises();

    expect(rowNames(wrapper)).toEqual(["pod-restarted"]);
    wrapper.unmount();
  });

  it("composes filters and clears them with the Clear button", async () => {
    const wrapper = mountWithPods([
      makePod("pod-ready", true, 0),
      makePod("pod-restarted-ready", true, 2),
      makePod("pod-restarted-crashloop", false, 2),
    ]);

    await wrapper
      .findAll("button")
      .find((button: any) => button.text() === "Not ready")
      .trigger("click");
    await wrapper
      .findAll("button")
      .find((button: any) => button.text() === "Restarts > 0")
      .trigger("click");
    await flushPromises();
    expect(rowNames(wrapper)).toEqual(["pod-restarted-crashloop"]);

    await wrapper
      .findAll("button")
      .find((button: any) => button.text() === "Clear")
      .trigger("click");
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(3);
    wrapper.unmount();
  });

  it("restores the persisted sort and filters on mount", async () => {
    prefsState.preferences["pod"] = {
      sortBy: "restarts",
      sortDir: "desc",
      filters: ["not-ready"],
    };
    const wrapper = mountWithPods([
      makePod("pod-ready", true, 0),
      makePod("pod-crashloop", false, 5),
      makePod("pod-slow", false, 1),
    ]);
    await flushPromises();

    expect(rowNames(wrapper)).toEqual(["pod-crashloop", "pod-slow"]);

    // Toggling a filter persists the updated preference
    await wrapper
      .findAll("button")
      .find((button: any) => button.text() === "Not ready")
      .trigger("click");
    await flushPromises();
    expect(ListPreferencesService.set).toHaveBeenCalledWith("pod", {
      sortBy: "restarts",
      sortDir: "desc",
      filters: [],
    });
    wrapper.unmount();
  });

  it("renders data-label attributes for the mobile card layout", async () => {
    const wrapper = mountWithPods([makePod("pod-a", true, 0)]);

    for (const label of ["Namespace", "Pod", "Status", "Age", "Ready", "Restarts"]) {
      expect(
        wrapper.find(`td[data-label="${label}"]`).exists(),
        `missing td[data-label="${label}"]`,
      ).toBe(true);
    }
    wrapper.unmount();
  });
});
