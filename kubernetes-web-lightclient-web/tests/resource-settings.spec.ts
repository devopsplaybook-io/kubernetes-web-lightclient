import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResourceSettings from "../components/ResourceSettings.vue";
import { ResourceService } from "../services/ResourceService";

const SAMPLE_TYPES = [
  { id: "pod", name: "Pod", isCrd: false },
  { id: "deployment", name: "Deployment", isCrd: false },
  { id: "applications", name: "Application (CRD)", isCrd: true },
];

function mockTypes(selections: string[]): void {
  vi.spyOn(ResourceService, "getAvailableTypes").mockResolvedValue(
    SAMPLE_TYPES as never,
  );
  vi.spyOn(ResourceService, "getUserSelections").mockResolvedValue(
    selections as never,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ResourceSettings", () => {
  async function mountComponent() {
    const wrapper = mount(ResourceSettings);
    await flushPromises();
    return wrapper;
  }

  it("renders the available resource types grouped", async () => {
    mockTypes(["pod"]);

    const wrapper = await mountComponent();

    expect(wrapper.text()).toContain("Resources");
    expect(wrapper.text()).toContain("Built-in Resources");
    expect(wrapper.text()).toContain("Custom Resources (CRDs)");
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(3);
    expect((checkboxes[0].element as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1].element as HTMLInputElement).checked).toBe(false);
    wrapper.unmount();
  });

  it("saves the selected resource ids and updates the store", async () => {
    const store = { selectedTypes: [] as string[] };
    vi.stubGlobal("KubernetesObjectStore", () => store);
    mockTypes([]);
    const saveSpy = vi
      .spyOn(ResourceService, "saveUserSelections")
      .mockResolvedValue(undefined as never);

    const wrapper = await mountComponent();
    await wrapper.vm.toggleResource("pod");
    await wrapper.vm.saveSelections();
    await flushPromises();

    expect(saveSpy).toHaveBeenCalledWith(["pod"]);
    expect(store.selectedTypes).toEqual(["pod"]);
    wrapper.unmount();
  });

  it("refreshes the CRD types from the cluster", async () => {
    mockTypes([]);
    const refreshSpy = vi
      .spyOn(ResourceService, "refreshTypes")
      .mockResolvedValue(SAMPLE_TYPES as never);

    const wrapper = await mountComponent();
    await wrapper.vm.refreshCrds();
    await flushPromises();

    expect(refreshSpy).toHaveBeenCalled();
    expect(wrapper.vm.lastRefresh).toBeTruthy();
    wrapper.unmount();
  });
});
