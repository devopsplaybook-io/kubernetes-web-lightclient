import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus, EventTypes } from "../services/EventBus";

const mockStore = vi.hoisted(() => ({
  invalidateAndRefresh: vi.fn(),
}));

vi.mock("../stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => mockStore,
}));

vi.mock("../services/ManifestService", () => ({
  describeObject: vi.fn(),
  getObjectManifestYaml: vi.fn(),
}));

import DialogDetails from "../components/DialogDetails.vue";
import { describeObject, getObjectManifestYaml } from "../services/ManifestService";

const describeMock = describeObject as unknown as ReturnType<typeof vi.fn>;
const yamlMock = getObjectManifestYaml as unknown as ReturnType<typeof vi.fn>;

function axiosError(status: number): unknown {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: { error: "gone" } },
  });
}

async function mountDialog(
  props: Record<string, string> = { objectType: "pod", objectName: "my-pod", namespace: "default" },
) {
  const wrapper = mount(DialogDetails, { props });
  await flushPromises();
  return wrapper;
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function tabButton(label: string) {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) {
    throw new Error(`Tab not found: ${label}`);
  }
  return button;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("DialogDetails", () => {
  it("renders the Describe tab content on open", async () => {
    describeMock.mockResolvedValue("DESCRIBE TEXT");

    const wrapper = await mountDialog();

    expect(describeMock).toHaveBeenCalledWith("pod", "default", "my-pod");
    expect(yamlMock).not.toHaveBeenCalled();
    expect(bodyText()).toContain("DESCRIBE TEXT");
    expect(bodyText()).toContain("Details: my-pod");
    wrapper.unmount();
  });

  it("shows a loading placeholder while describe is pending", async () => {
    describeMock.mockReturnValue(new Promise(() => {}));

    const wrapper = await mountDialog();

    expect(bodyText()).toContain("Loading...");
    wrapper.unmount();
  });

  it("fetches and shows the YAML manifest lazily on tab activation", async () => {
    describeMock.mockResolvedValue("DESCRIBE TEXT");
    yamlMock.mockResolvedValue("apiVersion: v1\n");

    const wrapper = await mountDialog();
    expect(yamlMock).not.toHaveBeenCalled();

    tabButton("YAML").click();
    await flushPromises();

    expect(yamlMock).toHaveBeenCalledTimes(1);
    expect(yamlMock).toHaveBeenCalledWith("pod", "default", "my-pod");
    expect(bodyText()).toContain("apiVersion: v1");

    // Switching back and forth does not refetch the YAML
    tabButton("Describe").click();
    tabButton("YAML").click();
    await flushPromises();
    expect(yamlMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("uses the default namespace-less props for cluster-scoped objects", async () => {
    describeMock.mockResolvedValue("NODE TEXT");
    yamlMock.mockResolvedValue("kind: Node\n");

    const wrapper = await mountDialog({
      objectType: "node",
      objectName: "my-node",
    });
    expect(describeMock).toHaveBeenCalledWith("node", "", "my-node");

    tabButton("YAML").click();
    await flushPromises();
    expect(yamlMock).toHaveBeenCalledWith("node", "", "my-node");
    wrapper.unmount();
  });

  it("copies the active tab text to the clipboard", async () => {
    describeMock.mockResolvedValue("DESCRIBE TEXT");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const emitSpy = vi.spyOn(EventBus, "emit");

    const wrapper = await mountDialog();
    document.body.querySelector<HTMLElement>(".details-tabs .actions i")?.click();
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("DESCRIBE TEXT");
    expect(emitSpy).toHaveBeenCalledWith(EventTypes.ALERT_MESSAGE, {
      type: "info",
      text: "Copied to clipboard",
    });
    wrapper.unmount();
  });

  it("copy falls back to execCommand when the clipboard API is unavailable", async () => {
    describeMock.mockResolvedValue("DESCRIBE TEXT");
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
    document.body.querySelector<HTMLElement>(".details-tabs .actions i")?.click();
    await flushPromises();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(emitSpy).toHaveBeenCalledWith(EventTypes.ALERT_MESSAGE, {
      type: "info",
      text: "Copied to clipboard",
    });
    wrapper.unmount();
  });

  it("shows the stale-object message and refreshes the list on 404", async () => {
    describeMock.mockRejectedValue(axiosError(404));
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

  it("surfaces other errors through the standard error alert", async () => {
    describeMock.mockRejectedValue(axiosError(500));
    const emitSpy = vi.spyOn(EventBus, "emit");

    const wrapper = await mountDialog();

    expect(mockStore.invalidateAndRefresh).not.toHaveBeenCalled();
    const alerts = emitSpy.mock.calls
      .filter(([type]) => type === EventTypes.ALERT_MESSAGE)
      .map(([, payload]) => payload as { type: string; text: string });
    expect(alerts.some((a) => a.type === "error")).toBe(true);
    wrapper.unmount();
  });
});
