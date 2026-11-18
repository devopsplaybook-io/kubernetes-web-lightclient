import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchMock = vi.hoisted(() => ({ load: vi.fn() }));
const authState = vi.hoisted(() => ({ isAuthenticated: true }));

vi.mock("~~/stores/AuthenticationStore", () => ({
  AuthenticationStore: () => authState,
}));

vi.mock("~~/stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => ({
    selectedTypes: ["pod", "service"],
    dataFull: {},
    loadSelectedTypes: vi.fn(async () => {}),
  }),
}));

vi.mock("~~/services/ResourceService", () => ({
  ResourceService: {
    getAvailableTypes: vi.fn(async () => [
      { id: "pod", name: "Pod" },
      { id: "service", name: "Service" },
    ]),
  },
}));

vi.mock("~~/services/GlobalSearchService", () => ({
  LoadTypesIncrementally: searchMock.load,
}));

import GlobalSearchPalette from "../components/GlobalSearchPalette.vue";
import { EventBus, EventTypes } from "../services/EventBus";
import { DetailsPath, FilteredListPath } from "../services/ObjectLinks";

const ITEMS: Record<string, any[]> = {
  pod: [
    {
      metadata: {
        uid: "pod-1",
        name: "web-1",
        namespace: "default",
        labels: { app: "web" },
      },
      status: { phase: "Running" },
    },
  ],
  service: [
    {
      metadata: {
        uid: "svc-1",
        name: "web-svc",
        namespace: "default",
        labels: { app: "web" },
      },
      spec: { selector: { app: "web" } },
    },
  ],
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let router: { push: ReturnType<typeof vi.fn> };

function mountPalette() {
  router = { push: vi.fn(async () => {}) };
  return mount(GlobalSearchPalette, {
    global: {
      mocks: {
        $router: router,
        $route: { path: "/kubernetes" },
      },
    },
  });
}

function paletteDialog(): HTMLElement | null {
  return document.body.querySelector("#command-palette");
}

function paletteInput(): HTMLInputElement | null {
  return document.body.querySelector("#command-palette input");
}

async function openWithQuery(query: string) {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
  );
  await flushPromises();
  const input = paletteInput();
  if (!input) {
    throw new Error("palette input not rendered");
  }
  input.value = query;
  input.dispatchEvent(new Event("input"));
  await wait(260);
  await flushPromises();
  return input;
}

beforeEach(() => {
  searchMock.load.mockReset();
  searchMock.load.mockImplementation(
    async (types: any[], onLoaded: (type: any, items: any[]) => void) => {
      for (const type of types) {
        onLoaded(type, ITEMS[type.id] || []);
      }
    },
  );
  authState.isAuthenticated = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("GlobalSearchPalette shortcuts", () => {
  it("opens with Ctrl/Cmd+K", async () => {
    const wrapper = mountPalette();
    expect(paletteDialog()).toBeNull();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
    );
    await flushPromises();

    expect(paletteDialog()).not.toBeNull();
    expect(document.body.textContent).toContain("Search across 2 resource type(s)");
    wrapper.unmount();
  });

  it("opens with / when focus is not in an input", async () => {
    const wrapper = mountPalette();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    await flushPromises();
    expect(paletteDialog()).not.toBeNull();
    wrapper.unmount();
  });

  it("ignores / inside an input", async () => {
    const wrapper = mountPalette();
    const external = document.createElement("input");
    document.body.appendChild(external);
    external.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );
    await flushPromises();
    expect(paletteDialog()).toBeNull();
    wrapper.unmount();
  });

  it("does not open when unauthenticated", async () => {
    authState.isAuthenticated = false;
    const wrapper = mountPalette();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
    );
    await flushPromises();
    expect(paletteDialog()).toBeNull();
    wrapper.unmount();
  });

  it("opens from the navigation event and closes on Escape", async () => {
    const wrapper = mountPalette();
    EventBus.emit(EventTypes.OPEN_COMMAND_PALETTE, {});
    await flushPromises();
    expect(paletteDialog()).not.toBeNull();

    const input = paletteInput()!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(paletteDialog()).toBeNull();
    wrapper.unmount();
  });
});

describe("GlobalSearchPalette results", () => {
  it("renders grouped, debounced results", async () => {
    const wrapper = mountPalette();
    await openWithQuery("web");

    expect(searchMock.load).toHaveBeenCalledTimes(1);
    const text = document.body.textContent || "";
    expect(text).toContain("Pod");
    expect(text).toContain("Service");
    expect(text).toContain("web-1");
    expect(text).toContain("web-svc");
    expect(text).toContain("Name");
    wrapper.unmount();
  });

  it("opens details on Enter and the filtered list on Shift+Enter", async () => {
    const wrapper = mountPalette();
    const input = await openWithQuery("web");

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await flushPromises();
    expect(router.push).toHaveBeenCalledWith(
      DetailsPath("pod", "default", "web-1"),
    );

    router.push.mockClear();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
    );
    await flushPromises();
    const reopened = await openWithQuery("web");
    reopened.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
      }),
    );
    await flushPromises();
    expect(router.push).toHaveBeenCalledWith(
      FilteredListPath("pod", "default", "web-1"),
    );
    wrapper.unmount();
  });

  it("moves the active row with the arrow keys", async () => {
    const wrapper = mountPalette();
    const input = await openWithQuery("web");

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await flushPromises();

    expect(router.push).toHaveBeenCalledWith(
      DetailsPath("service", "default", "web-svc"),
    );
    wrapper.unmount();
  });

  it("shows the failed-type retry state", async () => {
    searchMock.load.mockImplementation(
      async (
        types: any[],
        _onLoaded: any,
        onError: (type: any) => void,
      ) => {
        for (const type of types) {
          onError(type);
        }
      },
    );
    const wrapper = mountPalette();
    await openWithQuery("web");

    expect(document.body.textContent).toContain("2 type(s) failed — Retry");
    wrapper.unmount();
  });

  it("does not search for an empty query", async () => {
    const wrapper = mountPalette();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
    );
    await flushPromises();
    await wait(260);
    expect(searchMock.load).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
