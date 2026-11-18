import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const relatedMock = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("../stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => ({ invalidateAndRefresh: vi.fn() }),
}));

vi.mock("../services/ManifestService", () => ({
  describeObject: vi.fn(),
  getObjectManifestYaml: vi.fn(),
}));

vi.mock("../services/RelatedObjectsService", () => ({
  FetchRelatedObjects: relatedMock.fetch,
}));

vi.mock("../services/ResourceService", () => ({
  ResourceService: {
    getAvailableTypes: vi.fn(async () => [
      { id: "pod", name: "Pod" },
      { id: "deployment", name: "Deployment" },
      { id: "replicaset", name: "ReplicaSet" },
      { id: "service", name: "Service" },
    ]),
  },
}));

import DialogDetails from "../components/DialogDetails.vue";
import { describeObject } from "../services/ManifestService";
import { DetailsPath, FilteredListPath } from "../services/ObjectLinks";

const describeMock = describeObject as unknown as ReturnType<typeof vi.fn>;

function relatedResult(overrides: Record<string, any> = {}) {
  return {
    kind: "Deployment",
    owners: [],
    pods: [],
    replicaSets: [],
    services: [],
    ingresses: [],
    configMaps: [],
    secrets: [],
    node: null,
    events: [],
    usedByPods: [],
    errors: [],
    ...overrides,
  };
}

const pod = (name: string) => ({
  metadata: { uid: `uid-${name}`, name, namespace: "default" },
});
const service = (name: string) => ({
  metadata: { uid: `uid-${name}`, name, namespace: "default" },
});
const replicaSet = (name: string) => ({
  metadata: { uid: `uid-${name}`, name, namespace: "default" },
});

function mountDialog(props: Record<string, string>) {
  const router = { push: vi.fn(async () => {}), replace: vi.fn() };
  const route = { path: "/kubernetes", query: {} as Record<string, string> };
  const wrapper = mount(DialogDetails, {
    props,
    global: { mocks: { $router: router, $route: route } },
  });
  return { wrapper, router, route };
}

function tabButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) {
    throw new Error(`Tab not found: ${label}`);
  }
  return button as HTMLButtonElement;
}

function anchorWithText(text: string): HTMLAnchorElement {
  const anchor = Array.from(document.body.querySelectorAll("a")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!anchor) {
    throw new Error(`Link not found: ${text}`);
  }
  return anchor as HTMLAnchorElement;
}

const bodyText = () => document.body.textContent || "";

afterEach(() => {
  vi.restoreAllMocks();
  relatedMock.fetch.mockReset();
  document.body.innerHTML = "";
});

describe("DialogDetails Related tab", () => {
  it("shows the Related tab without loading it before activation", async () => {
    describeMock.mockResolvedValue("DESCRIBE");
    relatedMock.fetch.mockResolvedValue(relatedResult());

    const { wrapper } = mountDialog({
      objectType: "deployment",
      objectName: "web",
      namespace: "default",
    });
    await flushPromises();

    expect(tabButton("Related")).toBeTruthy();
    expect(relatedMock.fetch).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("loads and renders the related sections lazily", async () => {
    describeMock.mockResolvedValue("DESCRIBE");
    relatedMock.fetch.mockResolvedValue(
      relatedResult({
        pods: [pod("web-1")],
        replicaSets: [replicaSet("web-rs")],
        services: [service("web-svc")],
        configMaps: [{ name: "app-config", via: "volume config" }],
        secrets: [{ name: "app-secret", via: "envFrom app" }],
        events: [
          {
            metadata: { uid: "e1", name: "web.1", creationTimestamp: "2026-01-01T00:00:00Z" },
            lastTimestamp: "2026-01-01T00:00:00Z",
            type: "Normal",
            reason: "ScalingReplicaSet",
            message: "Scaled up",
          },
        ],
      }),
    );

    const { wrapper } = mountDialog({
      objectType: "deployment",
      objectName: "web",
      namespace: "default",
    });
    await flushPromises();
    tabButton("Related").click();
    await flushPromises();

    expect(relatedMock.fetch).toHaveBeenCalledWith({
      objectType: "deployment",
      namespace: "default",
      name: "web",
      types: expect.any(Array),
    });
    const text = bodyText();
    expect(text).toContain("ReplicaSets");
    expect(text).toContain("web-rs");
    expect(text).toContain("Pods");
    expect(text).toContain("web-1");
    expect(text).toContain("Services");
    expect(text).toContain("web-svc");
    expect(text).toContain("Referenced ConfigMaps");
    expect(text).toContain("app-config");
    expect(text).toContain("Referenced Secrets");
    expect(text).toContain("app-secret");
    expect(text).toContain("ScalingReplicaSet");
    wrapper.unmount();
  });

  it("shows the global empty state", async () => {
    describeMock.mockResolvedValue("DESCRIBE");
    relatedMock.fetch.mockResolvedValue(relatedResult());
    const { wrapper } = mountDialog({
      objectType: "deployment",
      objectName: "web",
      namespace: "default",
    });
    await flushPromises();
    tabButton("Related").click();
    await flushPromises();
    expect(bodyText()).toContain(
      "No related objects found for this Deployment.",
    );
    wrapper.unmount();
  });

  it("shows the error state and retries", async () => {
    describeMock.mockResolvedValue("DESCRIBE");
    relatedMock.fetch.mockRejectedValueOnce(new Error("boom"));
    const { wrapper } = mountDialog({
      objectType: "deployment",
      objectName: "web",
      namespace: "default",
    });
    await flushPromises();
    tabButton("Related").click();
    await flushPromises();
    expect(bodyText()).toContain("boom");

    relatedMock.fetch.mockResolvedValueOnce(
      relatedResult({ pods: [pod("web-1")] }),
    );
    const retry = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    retry?.click();
    await flushPromises();
    expect(bodyText()).toContain("web-1");
    wrapper.unmount();
  });

  it("navigates inside the dialog for a same-type entry", async () => {
    describeMock.mockResolvedValue("DESCRIBE");
    relatedMock.fetch.mockResolvedValue(
      relatedResult({ kind: "Pod", pods: [pod("other-pod")] }),
    );
    const { wrapper, router } = mountDialog({
      objectType: "pod",
      objectName: "web-1",
      namespace: "default",
    });
    await flushPromises();
    tabButton("Related").click();
    await flushPromises();

    anchorWithText("other-pod").click();
    await flushPromises();

    expect(router.replace).toHaveBeenCalledWith({
      path: "/kubernetes",
      query: {
        dialog: "details",
        name: "other-pod",
        dialogNamespace: "default",
      },
    });
    expect(describeMock).toHaveBeenLastCalledWith(
      "pod",
      "default",
      "other-pod",
    );
    expect(bodyText()).toContain("← Back");
    wrapper.unmount();
  });

  it("pushes a details route for a cross-type entry", async () => {
    describeMock.mockResolvedValue("DESCRIBE");
    relatedMock.fetch.mockResolvedValue(
      relatedResult({ replicaSets: [replicaSet("web-rs")] }),
    );
    const { wrapper, router } = mountDialog({
      objectType: "deployment",
      objectName: "web",
      namespace: "default",
    });
    await flushPromises();
    tabButton("Related").click();
    await flushPromises();

    anchorWithText("web-rs").click();
    await flushPromises();

    expect(router.push).toHaveBeenCalledWith(
      DetailsPath("replicaset", "default", "web-rs"),
    );
    wrapper.unmount();
  });

  it("opens the events list filtered by the object", async () => {
    describeMock.mockResolvedValue("DESCRIBE");
    relatedMock.fetch.mockResolvedValue(
      relatedResult({
        events: [
          {
            metadata: { uid: "e1", name: "web.1" },
            type: "Warning",
            reason: "Failed",
            message: "Failed to pull",
          },
        ],
      }),
    );
    const { wrapper, router } = mountDialog({
      objectType: "deployment",
      objectName: "web",
      namespace: "default",
    });
    await flushPromises();
    tabButton("Related").click();
    await flushPromises();

    anchorWithText("View all events").click();
    await flushPromises();

    expect(router.push).toHaveBeenCalledWith(
      FilteredListPath("events", "default", "web"),
    );
    wrapper.unmount();
  });

  it("hides the copy action on the Related tab", async () => {
    describeMock.mockResolvedValue("DESCRIBE");
    relatedMock.fetch.mockResolvedValue(relatedResult());
    const { wrapper } = mountDialog({
      objectType: "deployment",
      objectName: "web",
      namespace: "default",
    });
    await flushPromises();

    expect(document.body.querySelector(".details-tabs .actions")).not.toBeNull();
    tabButton("Related").click();
    await flushPromises();
    expect(document.body.querySelector(".details-tabs .actions")).toBeNull();
    wrapper.unmount();
  });
});
