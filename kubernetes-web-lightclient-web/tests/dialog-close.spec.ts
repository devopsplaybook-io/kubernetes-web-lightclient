import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: {
    post: vi.fn().mockRejectedValue(new Error("offline")),
    isAxiosError: vi.fn(() => false),
  },
}));

vi.mock("~~/services/Config.ts", () => ({
  default: { get: vi.fn(async () => ({ SERVER_URL: "http://server.test" })) },
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: { getAuthHeader: vi.fn(async () => ({})) },
}));

vi.mock("~~/services/ManifestService", () => ({
  describeObject: vi.fn(async () => ""),
  getObjectManifestYaml: vi.fn(async () => ""),
}));

vi.mock("~~/stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => ({}),
}));

import DialogDetails from "../components/DialogDetails.vue";
import DialogLogs from "../components/DialogLogs.vue";
import DialogConfirm from "../components/DialogConfirm.vue";
import DialogAlert from "../components/DialogAlert.vue";
import DialogApiTokenCreated from "../components/DialogApiTokenCreated.vue";
import DialogScaleDeployment from "../components/DialogScaleDeployment.vue";

function closeAnchor(): HTMLAnchorElement {
  const anchor = document.body.querySelector<HTMLAnchorElement>("a.close");
  if (!anchor) {
    throw new Error("close anchor not found");
  }
  return anchor;
}

async function mountAndClickClose(
  component: unknown,
  props: Record<string, unknown>,
  eventName: string,
) {
  const wrapper = mount(component as never, { props });
  await flushPromises();

  const anchor = closeAnchor();
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  await flushPromises();

  expect(event.defaultPrevented).toBe(true);
  expect(wrapper.emitted(eventName)).toHaveLength(1);
  wrapper.unmount();
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("dialog close controls", () => {
  it("prevents the native #close navigation in DialogDetails", async () => {
    await mountAndClickClose(
      DialogDetails,
      { objectType: "pod", objectName: "my-pod", namespace: "default" },
      "onClose",
    );
  });

  it("prevents the native #close navigation in DialogLogs", async () => {
    await mountAndClickClose(
      DialogLogs,
      { podname: "my-pod", namespace: "default" },
      "onClose",
    );
  });

  it("prevents the native #close navigation in DialogConfirm", async () => {
    await mountAndClickClose(DialogConfirm, {}, "onCancel");
  });

  it("prevents the native #close navigation in DialogAlert", async () => {
    await mountAndClickClose(DialogAlert, {}, "onClose");
  });

  it("prevents the native #close navigation in DialogApiTokenCreated", async () => {
    await mountAndClickClose(DialogApiTokenCreated, { token: "secret" }, "onClose");
  });

  it("prevents the native #close navigation in DialogScaleDeployment", async () => {
    await mountAndClickClose(
      DialogScaleDeployment,
      { namespace: "default", deploymentName: "web", currentReplicas: 2 },
      "onClose",
    );
  });
});
