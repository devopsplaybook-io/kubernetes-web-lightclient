import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import KubernetesEventList from "../components/KubernetesEventList.vue";

function makeEvent(overrides: Record<string, unknown>): Record<string, any> {
  return {
    metadata: { uid: "uid-default", creationTimestamp: "2026-10-15T00:00:00Z" },
    type: "Warning",
    reason: "BackOff",
    message: "Back-off restarting failed container",
    count: 5,
    lastTimestamp: "2026-10-16T00:00:00Z",
    involvedObject: { kind: "Pod", name: "my-pod", namespace: "default" },
    ...overrides,
  };
}

function mountWithEvents(events: Record<string, any>[]) {
  const store = {
    data: { events } as { [key: string]: any[] },
    loading: false,
    getEvents: vi.fn(),
  };
  vi.stubGlobal("KubernetesObjectStore", () => store);
  const replaceMock = vi.fn();
  const wrapper = mount(KubernetesEventList, {
    global: {
      mocks: {
        $route: { path: "/kubernetes", query: {} },
        $router: { replace: replaceMock },
      },
    },
  });
  return { wrapper, store, replaceMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KubernetesEventList", () => {
  it("loads events and applies the warnings-only default", async () => {
    const { wrapper, store } = mountWithEvents([
      makeEvent({ metadata: { uid: "uid-w" }, type: "Warning" }),
      makeEvent({
        metadata: { uid: "uid-n" },
        type: "Normal",
        reason: "Started",
        message: "Started container",
      }),
    ]);
    await flushPromises();

    expect(store.getEvents).toHaveBeenCalled();
    const rows = wrapper.findAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("Warning");
    expect(rows[0].text()).toContain("BackOff");
    expect(wrapper.text()).not.toContain("Started container");
    const checkbox = wrapper.find('input[type="checkbox"]')
      .element as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    wrapper.unmount();
  });

  it("shows Normal events when warnings-only is disabled", async () => {
    const { wrapper } = mountWithEvents([
      makeEvent({ metadata: { uid: "uid-w" }, type: "Warning" }),
      makeEvent({
        metadata: { uid: "uid-n" },
        type: "Normal",
        reason: "Started",
        message: "Started container",
      }),
    ]);
    await flushPromises();

    await wrapper.find('input[type="checkbox"]').setValue(false);
    const rows = wrapper.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain("Started container");
    wrapper.unmount();
  });

  it("sorts events by last timestamp descending", async () => {
    const { wrapper } = mountWithEvents([
      makeEvent({
        metadata: { uid: "uid-old" },
        reason: "OldEvent",
        lastTimestamp: "2026-10-14T00:00:00Z",
      }),
      makeEvent({
        metadata: { uid: "uid-new" },
        reason: "NewEvent",
        lastTimestamp: "2026-10-16T12:00:00Z",
      }),
    ]);
    await flushPromises();

    await wrapper.find('input[type="checkbox"]').setValue(false);
    const rows = wrapper.findAll("tbody tr");
    expect(rows[0].text()).toContain("NewEvent");
    expect(rows[1].text()).toContain("OldEvent");
    wrapper.unmount();
  });

  it("renders the involved object, count and age columns", async () => {
    const { wrapper } = mountWithEvents([
      makeEvent({
        metadata: { uid: "uid-x" },
        involvedObject: {
          kind: "Deployment",
          name: "my-deployment",
          namespace: "prod",
        },
        count: 7,
      }),
    ]);
    await flushPromises();

    const row = wrapper.findAll("tbody tr")[0];
    expect(row.text()).toContain("Deployment my-deployment");
    expect(row.text()).toContain("7");
    const headers = wrapper.findAll("thead th").map((th) => th.text());
    expect(headers).toEqual([
      "Type",
      "Reason",
      "Message",
      "Involved Object",
      "Count",
      "Age",
      "Logs",
    ]);
    wrapper.unmount();
  });

  it("offers pod logs only for events involving a Pod", async () => {
    const { wrapper, replaceMock } = mountWithEvents([
      makeEvent({ metadata: { uid: "uid-pod" } }),
      makeEvent({
        metadata: { uid: "uid-dep" },
        involvedObject: {
          kind: "Deployment",
          name: "my-deployment",
          namespace: "default",
        },
      }),
    ]);
    await flushPromises();

    const logIcons = wrapper.findAll(".bi-file-text-fill");
    expect(logIcons).toHaveLength(1);

    await logIcons[0].trigger("click");
    expect(wrapper.vm.dialogLogs).toEqual({
      enable: true,
      podname: "my-pod",
      namespace: "default",
    });
    expect(replaceMock).toHaveBeenCalledWith({
      path: "/kubernetes",
      query: { dialog: "logs", name: "my-pod", dialogNamespace: "default" },
    });
    wrapper.unmount();
  });

  it("renders a truncation note when more than 200 events match", async () => {
    const events = Array.from({ length: 205 }, (_, i) =>
      makeEvent({ metadata: { uid: `uid-${i}` } }),
    );
    const { wrapper } = mountWithEvents(events);
    await flushPromises();

    expect(wrapper.findAll("tbody tr")).toHaveLength(200);
    expect(wrapper.text()).toContain("Showing latest 200 of 205 events");
    wrapper.unmount();
  });
});
