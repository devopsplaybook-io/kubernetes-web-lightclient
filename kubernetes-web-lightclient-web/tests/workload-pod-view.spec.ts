import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchWorkloadPods = vi.hoisted(() => vi.fn());

vi.mock("~~/services/WorkloadPodsService", () => ({
  FetchWorkloadPods: fetchWorkloadPods,
}));

import WorkloadPodView from "../components/WorkloadPodView.vue";

function makePod(name: string, namespace = "default") {
  return {
    metadata: { uid: `uid-${name}`, name, namespace },
    status: { phase: "Running" },
  };
}

function mountView(
  props: Record<string, unknown> = {},
  query: Record<string, string> = {},
) {
  const router = { replace: vi.fn(), push: vi.fn() };
  const wrapper = mount(WorkloadPodView, {
    props: {
      kind: "deployment",
      name: "web",
      namespace: "default",
      ...props,
    },
    global: {
      config: {
        globalProperties: {
          $route: { path: "/kubernetes", query },
          $router: router,
        },
      },
      stubs: {
        Loading: true,
        KubernetesPodList: true,
        DialogLogs: true,
      },
    },
  });
  return { wrapper, router };
}

async function mountLoaded(
  props: Record<string, unknown> = {},
  query: Record<string, string> = {},
) {
  const mounted = mountView(props, query);
  await flushPromises();
  return mounted;
}

function button(wrapper: any, label: string) {
  const found = wrapper
    .findAll("button")
    .find((candidate: any) => candidate.text().includes(label));
  expect(found, `button ${label} should exist`).toBeDefined();
  return found;
}

beforeEach(() => {
  fetchWorkloadPods.mockResolvedValue({
    pods: [makePod("web-a"), makePod("web-b")],
    strategy: "selector",
    selector: "app=web",
    workload: {},
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkloadPodView", () => {
  it("loads the workload pods and renders them in the pod list", async () => {
    const { wrapper } = await mountLoaded();

    expect(fetchWorkloadPods).toHaveBeenCalledWith({
      kind: "deployment",
      name: "web",
      namespace: "default",
    });
    expect(wrapper.text()).toContain("Deployment web");
    expect(wrapper.text()).toContain("2 pod(s)");
    const list = wrapper.findComponent({ name: "kubernetes-pod-list" });
    expect(list.exists()).toBe(true);
    expect((list.props("pods") as any[]).map((p) => p.metadata.name)).toEqual([
      "web-a",
      "web-b",
    ]);
    expect(list.props("autoFetch")).toBe(false);
    wrapper.unmount();
  });

  it("exposes refresh so the parent can reload the pods", async () => {
    const { wrapper } = await mountLoaded();
    expect(fetchWorkloadPods).toHaveBeenCalledTimes(1);

    await wrapper.vm.refresh();
    await flushPromises();

    expect(fetchWorkloadPods).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("keeps the search filter and legacy delete flag on the pod list", async () => {
    const { wrapper } = await mountLoaded({
      search: "web-b",
      deletable: true,
    });

    const list = wrapper.findComponent({ name: "kubernetes-pod-list" });
    expect((list.props("pods") as any[]).map((p) => p.metadata.name)).toEqual([
      "web-b",
    ]);
    expect(list.props("deletable")).toBe(true);
    wrapper.unmount();
  });

  it("shows the workload error and retries on demand", async () => {
    fetchWorkloadPods.mockReset();
    fetchWorkloadPods.mockRejectedValueOnce(
      new Error("This workload no longer exists."),
    );
    fetchWorkloadPods.mockResolvedValueOnce({
      pods: [makePod("web-a")],
      strategy: "owner",
      selector: null,
      workload: {},
    });
    const { wrapper } = await mountLoaded();

    expect(wrapper.text()).toContain("no longer exists");
    await button(wrapper, "Retry").trigger("click");
    await flushPromises();

    expect(fetchWorkloadPods).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("1 pod(s)");
    wrapper.unmount();
  });

  it("reports an empty workload without crashing", async () => {
    fetchWorkloadPods.mockResolvedValue({
      pods: [],
      strategy: "selector",
      selector: "app=web",
      workload: {},
    });
    const { wrapper } = await mountLoaded();

    expect(wrapper.text()).toContain("No pods found for this workload.");
    expect(button(wrapper, "Merged logs").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("opens the merged logs dialog and deep-links it in the query", async () => {
    const { wrapper, router } = await mountLoaded();

    await button(wrapper, "Merged logs").trigger("click");
    await flushPromises();

    const dialog = wrapper.findComponent({ name: "dialog-logs" });
    expect(dialog.exists()).toBe(true);
    expect(dialog.props("workloadKind")).toBe("deployment");
    expect(dialog.props("workloadName")).toBe("web");
    expect((dialog.props("pods") as any[]).map((p) => p.metadata.name)).toEqual([
      "web-a",
      "web-b",
    ]);
    expect(router.replace).toHaveBeenCalledWith({
      path: "/kubernetes",
      query: { dialog: "merged-logs" },
    });
    wrapper.unmount();
  });

  it("opens the merged logs directly from a deep link", async () => {
    const { wrapper } = await mountLoaded(
      { openMergedLogs: true },
      { dialog: "merged-logs" },
    );

    expect(wrapper.findComponent({ name: "dialog-logs" }).exists()).toBe(true);
    wrapper.unmount();
  });

  it("navigates back to the workload list and drops the drill-down params", async () => {
    fetchWorkloadPods.mockResolvedValue({
      pods: [makePod("nightly-manual-pod")],
      strategy: "owner",
      selector: null,
      workload: {},
    });
    const { wrapper, router } = await mountLoaded(
      { kind: "cronjob", name: "nightly" },
      {
        objectType: "pod",
        workload: "cronjob",
        workloadName: "nightly",
        namespace: "default",
        dialog: "merged-logs",
      },
    );

    expect(wrapper.text()).toContain("CronJob nightly");
    const back = wrapper
      .findAll("a")
      .find((link: any) => link.text() === "Back to CronJobs");
    expect(back).toBeDefined();
    await back.trigger("click");

    expect(router.replace).toHaveBeenCalledWith({
      path: "/kubernetes",
      query: { objectType: "cronjob", namespace: "default" },
    });
    wrapper.unmount();
  });
  it("explains a 403 with the scope the workload lookup needs", async () => {
    fetchWorkloadPods.mockRejectedValue({
      isAxiosError: true,
      message: "Request failed with status code 403",
      config: { url: "/api/kubectl/command", data: { command: "get" } },
      response: { status: 403, data: { error: "Forbidden" } },
    });
    const { wrapper } = await mountLoaded();

    expect(wrapper.text()).toContain("k8s:read");
    expect(wrapper.text()).not.toContain("Forbidden");
    wrapper.unmount();
  });
});
