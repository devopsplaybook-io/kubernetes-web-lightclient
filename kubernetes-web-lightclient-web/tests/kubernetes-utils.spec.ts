import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus, EventTypes } from "../services/EventBus";

const mockStore = vi.hoisted(() => ({
  invalidateAndRefresh: vi.fn(),
}));

vi.mock("../stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => mockStore,
}));

import {
  handleStaleObjectError,
  isObjectNotFoundError,
} from "../services/KubernetesUtils";

function axiosError(status: number): unknown {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: { error: "not found" } },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("isObjectNotFoundError", () => {
  it("detects an axios 404 response", () => {
    expect(isObjectNotFoundError(axiosError(404))).toBe(true);
  });

  it("rejects other axios statuses", () => {
    expect(isObjectNotFoundError(axiosError(500))).toBe(false);
  });

  it("rejects non-axios errors", () => {
    expect(isObjectNotFoundError(new Error("boom"))).toBe(false);
  });
});

describe("handleStaleObjectError", () => {
  it("emits a warning, refreshes the type cache and returns true on 404", () => {
    const emitSpy = vi.spyOn(EventBus, "emit");

    const handled = handleStaleObjectError(axiosError(404), "pod");

    expect(handled).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(EventTypes.ALERT_MESSAGE, {
      type: "warning",
      text: "This pod no longer exists — the list has been refreshed.",
    });
    expect(mockStore.invalidateAndRefresh).toHaveBeenCalledWith("pod");
    emitSpy.mockRestore();
  });

  it("ignores non-404 errors without side effects", () => {
    const emitSpy = vi.spyOn(EventBus, "emit");

    const handled = handleStaleObjectError(axiosError(500), "pod");

    expect(handled).toBe(false);
    expect(emitSpy).not.toHaveBeenCalled();
    expect(mockStore.invalidateAndRefresh).not.toHaveBeenCalled();
    emitSpy.mockRestore();
  });
});
