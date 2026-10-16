import { DOMWrapper, mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { EventBus, EventTypes } from "../services/EventBus";

const mockStore = vi.hoisted(() => ({
  invalidateAndRefresh: vi.fn(),
}));

vi.mock("../stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => mockStore,
}));

vi.mock("../services/Utils", () => ({
  UtilsDecompressData: vi.fn(async (value: string) => value),
  UtilsRelativeTime: vi.fn(() => "just now"),
}));

import DialogLogs from "../components/DialogLogs.vue";

const POD_JSON = JSON.stringify({
  spec: { containers: [{ name: "app" }] },
  status: { containerStatuses: [{ restartCount: 2 }] },
});

function axiosError(status: number): unknown {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: { error: "gone" } },
  });
}

const postMock = () => axios.post as unknown as ReturnType<typeof vi.fn>;

async function mountDialog() {
  const wrapper = mount(DialogLogs, {
    props: { podname: "my-pod", namespace: "default" },
  });
  await flushPromises();
  return wrapper;
}

function checkbox(labelText: string): DOMWrapper<Element> {
  const label = Array.from(document.body.querySelectorAll("label")).find(
    (l) => l.textContent?.includes(labelText),
  );
  if (!label) {
    throw new Error(`Label not found: ${labelText}`);
  }
  const input = label.querySelector('input[type="checkbox"]');
  if (!input) {
    throw new Error(`Checkbox not found: ${labelText}`);
  }
  return new DOMWrapper(input);
}

function advancedToggle(): DOMWrapper<Element> {
  const toggle = document.body.querySelector(".advanced-toggle");
  if (!toggle) {
    throw new Error("Advanced toggle not found");
  }
  return new DOMWrapper(toggle);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("DialogLogs", () => {
  it("loads pod details and logs on open", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValue({ data: { result: "LOG LINE 1\nLOG LINE 2" } });

    const wrapper = await mountDialog();

    expect(document.body.textContent).toContain("LOG LINE 1");
    expect(wrapper.vm.containers).toEqual(["app"]);
    wrapper.unmount();
  });

  it("Follow enables a 4s polling interval and disables Auto-refresh", async () => {
    vi.useFakeTimers();
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValue({ data: { result: "LOG LINE 1" } });

    const wrapper = await mountDialog();
    await advancedToggle().trigger("click");

    const callsAtOpen = postMock().mock.calls.length;
    await checkbox("Follow").setValue(true);

    // Enabling Follow polls immediately and unchecks Auto-refresh
    expect(postMock().mock.calls.length).toBe(callsAtOpen + 1);
    expect(
      (checkbox("Auto-refresh").element as HTMLInputElement).checked,
    ).toBe(false);

    vi.advanceTimersByTime(4000);
    await flushPromises();
    expect(postMock().mock.calls.length).toBe(callsAtOpen + 2);

    await checkbox("Follow").setValue(false);
    const callsAfterStop = postMock().mock.calls.length;
    vi.advanceTimersByTime(12000);
    await flushPromises();
    expect(postMock().mock.calls.length).toBe(callsAfterStop);
    wrapper.unmount();
  });

  it("Auto-refresh disables Follow and keeps its own interval", async () => {
    vi.useFakeTimers();
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValue({ data: { result: "LOG LINE 1" } });

    const wrapper = await mountDialog();
    await advancedToggle().trigger("click");

    await checkbox("Auto-refresh").setValue(true);

    expect(
      (checkbox("Follow").element as HTMLInputElement).checked,
    ).toBe(false);

    const callsAtStart = postMock().mock.calls.length;
    vi.advanceTimersByTime(10000);
    await flushPromises();
    expect(postMock().mock.calls.length).toBe(callsAtStart + 1);
    wrapper.unmount();
  });

  it("Copy writes the filtered logs to the clipboard", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValue({ data: { result: "LOG LINE 1\nLOG LINE 2" } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const emitSpy = vi.spyOn(EventBus, "emit");

    const wrapper = await mountDialog();
    await wrapper.vm.copyLogs();

    expect(writeText).toHaveBeenCalledWith("LOG LINE 1\nLOG LINE 2");
    expect(emitSpy).toHaveBeenCalledWith(EventTypes.ALERT_MESSAGE, {
      type: "info",
      text: "Logs copied to clipboard",
    });
    wrapper.unmount();
  });

  it("Copy falls back to execCommand when the clipboard API is unavailable", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValue({ data: { result: "LOG LINE 1" } });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("insecure context")),
      },
      configurable: true,
    });
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand as unknown as typeof document.execCommand;
    const emitSpy = vi.spyOn(EventBus, "emit");

    const wrapper = await mountDialog();
    await wrapper.vm.copyLogs();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(emitSpy).toHaveBeenCalledWith(EventTypes.ALERT_MESSAGE, {
      type: "info",
      text: "Logs copied to clipboard",
    });
    wrapper.unmount();
  });

  it("Download builds a namespaced .log blob of the filtered text", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValue({ data: { result: "LOG LINE 1" } });
    const createObjectURL = vi
      .fn()
      .mockImplementation(() => `blob:mock-${createObjectURL.mock.calls.length}`);
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const wrapper = await mountDialog();
    await wrapper.vm.downloadLogs();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("LOG LINE 1");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const link = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(link.getAttribute("download")).toBe("default_my-pod_app.log");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    wrapper.unmount();
  });

  it("shows the stale-object message and refreshes the pod list on 404", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockRejectedValue(axiosError(404));
    const emitSpy = vi.spyOn(EventBus, "emit");

    const wrapper = await mountDialog();

    expect(mockStore.invalidateAndRefresh).toHaveBeenCalledWith("pod");
    const alerts = emitSpy.mock.calls
      .filter(([type]) => type === EventTypes.ALERT_MESSAGE)
      .map(([, payload]) => payload as { type: string; text: string });
    expect(
      alerts.some(
        (a) => a.type === "warning" && a.text.includes("no longer exists"),
      ),
    ).toBe(true);
    expect(alerts.every((a) => a.type !== "error")).toBe(true);
    wrapper.unmount();
  });
});
