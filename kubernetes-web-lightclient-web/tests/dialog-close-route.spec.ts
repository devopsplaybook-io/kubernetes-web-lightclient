import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~~/services/ListPreferencesService", () => ({
  ListPreferencesService: {
    ensureLoaded: vi.fn(async () => {}),
    isLoaded: vi.fn(() => true),
    get: vi.fn(() => ({})),
    set: vi.fn(),
  },
}));

vi.mock("~~/services/ManifestService", () => ({
  describeObject: vi.fn(async () => "DESCRIBE TEXT"),
  getObjectManifestYaml: vi.fn(async () => ""),
}));

vi.mock("~~/stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => ({}),
}));

import KubernetesPodList from "../components/KubernetesPodList.vue";
import KubernetesIndex from "../pages/kubernetes/index.vue";
import DialogDetails from "../components/DialogDetails.vue";
import DialogLogs from "../components/DialogLogs.vue";
import DialogConfirm from "../components/DialogConfirm.vue";

function makePod(name: string) {
  return {
    metadata: {
      uid: `uid-${name}`,
      name,
      namespace: "default",
      creationTimestamp: "2026-10-15T00:00:00Z",
    },
    status: { phase: "Running", containerStatuses: [] },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("closing a deep-linked dialog", () => {
  it("clears the dialog query params from the URL", async () => {
    const store = {
      data: { pods: [makePod("my-pod")] },
      loading: false,
      getPods: vi.fn(),
    };
    vi.stubGlobal("KubernetesObjectStore", () => store);
    vi.stubGlobal("NamespaceStore", () => ({}));

    const replace = vi.fn(async () => {});
    const route = {
      path: "/kubernetes",
      query: {
        objectType: "pod",
        dialog: "details",
        name: "my-pod",
        dialogNamespace: "default",
      },
    };

    const wrapper = mount(KubernetesPodList, {
      global: {
        components: { DialogDetails, DialogLogs, DialogConfirm },
        config: {
          globalProperties: { $route: route, $router: { replace } },
        },
      },
    });
    await flushPromises();
    expect(document.body.textContent).toContain("Details: my-pod");

    const anchor = document.body.querySelector<HTMLAnchorElement>("a.close");
    expect(anchor).not.toBeNull();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(event);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(replace).toHaveBeenLastCalledWith({
      path: "/kubernetes",
      query: { objectType: "pod" },
    });
    wrapper.unmount();
  });
});

describe("switching object type with a dialog open", () => {
  it("waits for the dialog query cleanup before changing objectType", async () => {
    let finishReplace: (() => void) | undefined;
    const replace = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReplace = resolve;
        }),
    );
    const route = {
      path: "/kubernetes",
      query: {
        objectType: "pod",
        dialog: "logs",
        name: "my-pod",
        dialogNamespace: "default",
      },
    };
    vi.stubGlobal("useRouter", () => ({ replace }));
    vi.stubGlobal("useRoute", () => route);

    const context: { objectType: string } = { objectType: "pod" };
    const pending = KubernetesIndex.methods.onObjectTypeChange.call(context, {
      target: { value: "deployment" },
    });
    await flushPromises();

    expect(replace).toHaveBeenCalledWith({
      path: "/kubernetes",
      query: { objectType: "pod" },
    });
    expect(context.objectType).toBe("pod");

    finishReplace!();
    await pending;
    expect(context.objectType).toBe("deployment");
  });
});
