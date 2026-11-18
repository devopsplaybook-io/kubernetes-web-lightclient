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

const fetchWarningEvents = vi.hoisted(() => vi.fn(async () => []));

vi.mock("../services/WorkloadPodsService", () => ({
  FetchWarningEvents: fetchWarningEvents,
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

function makePod(name: string, extra: Record<string, any> = {}) {
  return {
    metadata: {
      uid: `uid-${name}`,
      name,
      namespace: "default",
    },
    spec: { containers: [{ name: "app" }] },
    status: {
      phase: "Running",
      containerStatuses: [{ name: "app", restartCount: 0 }],
    },
    ...extra,
  };
}

async function mountMerged(
  pods: Record<string, any>[],
  props: Record<string, any> = {},
) {
  const wrapper = mount(DialogLogs, {
    props: {
      pods,
      namespace: "default",
      workloadKind: "deployment",
      workloadName: "web",
      ...props,
    },
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

function filterInput(): DOMWrapper<Element> {
  const input = document.body.querySelector(".filter-input");
  if (!input) {
    throw new Error("Filter input not found");
  }
  return new DOMWrapper(input);
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

    // Let the immediate follow-up fetch settle before the next tick
    await flushPromises();
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

  it("skips Follow ticks while a log request is still pending", async () => {
    vi.useFakeTimers();
    const pending: Array<(value: unknown) => void> = [];
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValueOnce({ data: { result: "LOG LINE 1" } })
      .mockImplementation(
        () => new Promise((resolve) => pending.push(resolve)),
      );

    const wrapper = await mountDialog();
    await advancedToggle().trigger("click");

    const callsAtOpen = postMock().mock.calls.length;
    await checkbox("Follow").setValue(true);
    // Follow polls immediately; this request stays pending
    expect(postMock().mock.calls.length).toBe(callsAtOpen + 1);
    expect(pending).toHaveLength(1);

    // A timer tick during the pending request must not stack a new one
    vi.advanceTimersByTime(4000);
    await flushPromises();
    expect(postMock().mock.calls.length).toBe(callsAtOpen + 1);

    // Once the pending request settles, the next tick fetches again
    pending[0]({ data: { result: "LOG LINE 2" } });
    await flushPromises();
    vi.advanceTimersByTime(4000);
    await flushPromises();
    expect(postMock().mock.calls.length).toBe(callsAtOpen + 2);

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
    // Let the immediate auto-refresh fetch settle before the next tick
    await flushPromises();
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

  it("shows the waiting panel when the logs endpoint answers 409", async () => {
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockRejectedValueOnce(
        Object.assign(new Error("waiting"), {
          isAxiosError: true,
          response: {
            status: 409,
            data: { reason: "ImagePullBackOff", container: "app" },
          },
        }),
      );

    const wrapper = await mountDialog();

    expect(document.body.textContent).toContain(
      "Container is waiting: ImagePullBackOff",
    );
    expect(document.body.textContent).toContain("imagePullSecrets");
    expect(wrapper.vm.waitingEntries).toHaveLength(1);
    wrapper.unmount();
  });

  it("fetches every selected pod and merges the streams chronologically", async () => {
    const posts = vi
      .spyOn(axios, "post")
      .mockImplementation(async (_url, payload: any) => ({
        data: {
          result:
            payload.pod === "web-a"
              ? "2026-10-16T10:00:01Z a-first\n2026-10-16T10:00:03Z a-second"
              : "2026-10-16T10:00:02Z b-first",
        },
      }));

    const wrapper = await mountMerged([makePod("web-a"), makePod("web-b")]);

    expect(posts).toHaveBeenCalledTimes(2);
    for (const call of posts.mock.calls) {
      expect((call[1] as any).timestamps).toBe(true);
      expect((call[1] as any).namespace).toBe("default");
    }
    expect(document.body.textContent).toContain(
      "Deployment web logs — 2 pod(s) (default)",
    );
    const lines = (
      document.body.querySelector("#dialog-details-logs-text")?.textContent || ""
    ).split("\n");
    expect(lines).toEqual([
      "[web-a] 2026-10-16T10:00:01Z a-first",
      "[web-b] 2026-10-16T10:00:02Z b-first",
      "[web-a] 2026-10-16T10:00:03Z a-second",
    ]);
    wrapper.unmount();
  });

  it("caps the merged stream at the first ten pods and only queries those", async () => {
    const pods = Array.from({ length: 12 }, (_, index) =>
      makePod(`web-${String(index).padStart(2, "0")}`),
    );
    const posts = vi
      .spyOn(axios, "post")
      .mockResolvedValue({ data: { result: "2026-10-16T10:00:01Z line" } });

    const wrapper = await mountMerged(pods);
    await advancedToggle().trigger("click");
    await flushPromises();

    expect(wrapper.vm.selectedPods).toHaveLength(10);
    expect(posts).toHaveBeenCalledTimes(10);
    expect(document.body.textContent).toContain(
      "Showing logs for the first 10 of 12 pods",
    );
    wrapper.unmount();
  });

  it("skips a waiting pod, keeps the other logs and reports partial failures", async () => {
    const waitingPod = makePod("web-waiting", {
      status: {
        phase: "Pending",
        containerStatuses: [
          {
            name: "app",
            restartCount: 0,
            state: { waiting: { reason: "CreateContainerConfigError" } },
          },
        ],
      },
    });
    const posts = vi
      .spyOn(axios, "post")
      .mockImplementation(async (_url, payload: any) => {
        if (payload.pod === "web-failing") {
          throw axiosError(500);
        }
        return { data: { result: "2026-10-16T10:00:01Z ok-line" } };
      });

    const wrapper = await mountMerged([
      makePod("web-ok"),
      waitingPod,
      makePod("web-failing"),
    ]);

    // Only the healthy pod is queried: the waiting one is blocked locally.
    expect(posts).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("ok-line");
    expect(document.body.textContent).toContain(
      "Container is waiting: CreateContainerConfigError",
    );
    expect(document.body.textContent).toContain("web-failing: gone");
    expect(fetchWarningEvents).toHaveBeenCalledWith("default", ["web-waiting"]);
    wrapper.unmount();
  });

  it("honours a container selection across the merged pods", async () => {
    const podA = makePod("web-a", { spec: { containers: [{ name: "app" }, { name: "sidecar" }] } });
    const podB = makePod("web-b", { spec: { containers: [{ name: "app" }] } });
    const posts = vi
      .spyOn(axios, "post")
      .mockResolvedValue({ data: { result: "2026-10-16T10:00:01Z line" } });

    const wrapper = await mountMerged([podA, podB]);
    posts.mockClear();
    wrapper.vm.selectedContainer = "sidecar";
    await wrapper.vm.fetchLogs();
    await flushPromises();

    // Only the pod that actually has the selected container is queried.
    expect(posts).toHaveBeenCalledTimes(1);
    expect((posts.mock.calls[0][1] as any).pod).toBe("web-a");
    expect((posts.mock.calls[0][1] as any).container).toBe("sidecar");
    wrapper.unmount();
  });

  it("filters the logs and highlights the matches", async () => {
    vi.useFakeTimers();
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValue({ data: { result: "INFO one\nERROR boom" } });

    const wrapper = await mountDialog();
    await advancedToggle().trigger("click");
    await filterInput().setValue("boom");
    vi.advanceTimersByTime(300);
    await flushPromises();

    const pre = document.body.querySelector("#dialog-details-logs-text") as HTMLElement;
    expect(pre.textContent).toBe("ERROR boom");
    expect(pre.innerHTML).toContain("<mark>boom</mark>");
    expect(document.body.textContent).toContain("1 of 2 lines");
    wrapper.unmount();
  });

  it("reports an invalid regex filter and keeps the logs visible", async () => {
    vi.useFakeTimers();
    vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValue({ data: { result: "INFO one\nERROR boom" } });

    const wrapper = await mountDialog();
    await advancedToggle().trigger("click");
    await checkbox("Regex").setValue(true);
    await filterInput().setValue("([");
    vi.advanceTimersByTime(300);
    await flushPromises();

    expect(document.body.textContent).toContain("Invalid regular expression");
    const pre = document.body.querySelector("#dialog-details-logs-text") as HTMLElement;
    expect(pre.textContent).toContain("INFO one");
    wrapper.unmount();
  });

  it("requests the previous logs when the pod has restarted", async () => {
    const posts = vi
      .spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { result: POD_JSON } })
      .mockResolvedValue({ data: { result: "PREVIOUS LINE" } });

    const wrapper = await mountDialog();
    await advancedToggle().trigger("click");
    await checkbox("Previous").setValue(true);
    await flushPromises();

    const payload = posts.mock.calls.at(-1)?.[1] as any;
    expect(payload.pod).toBe("my-pod");
    expect(payload.argument).toContain("--previous");
    wrapper.unmount();
  });

  it("retries a busy merged request once before giving up on that pod", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(axios, "post").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("busy"), {
          isAxiosError: true,
          response: {
            status: 429,
            data: { error: "Server is busy, please retry" },
          },
        });
      }
      return { data: { result: "2026-10-16T10:00:01Z retried-line" } };
    });

    const wrapper = mount(DialogLogs, {
      props: {
        pods: [makePod("web-a")],
        namespace: "default",
        workloadKind: "deployment",
        workloadName: "web",
      },
    });
    await flushPromises();
    vi.advanceTimersByTime(1000);
    await flushPromises();

    expect(calls).toBe(2);
    expect(document.body.textContent).toContain("retried-line");
    wrapper.unmount();
  });
});
