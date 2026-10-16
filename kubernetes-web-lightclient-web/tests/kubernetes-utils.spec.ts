import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus, EventTypes } from "../services/EventBus";

const mockStore = vi.hoisted(() => ({
  invalidateAndRefresh: vi.fn(),
}));

vi.mock("../stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => mockStore,
}));

import {
  getPodLastRestartAt,
  getPodReadyCount,
  getPodRestartCount,
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

describe("pod cell helpers", () => {
  function makePod(status: Record<string, any>): any {
    return { status };
  }

  it("getPodReadyCount returns ready and total container counts", () => {
    expect(
      getPodReadyCount(
        makePod({
          containerStatuses: [
            { ready: true, restartCount: 0 },
            { ready: false, restartCount: 2 },
          ],
        }),
      ),
    ).toEqual({ ready: 1, total: 2 });
    expect(getPodReadyCount(makePod({}))).toEqual({ ready: 0, total: 0 });
  });

  it("getPodRestartCount sums the container restart counts", () => {
    expect(
      getPodRestartCount(
        makePod({
          containerStatuses: [
            { ready: true, restartCount: 2 },
            { ready: true, restartCount: 3 },
          ],
        }),
      ),
    ).toBe(5);
    expect(getPodRestartCount(makePod({}))).toBe(0);
    expect(
      getPodRestartCount(
        makePod({ containerStatuses: [{ ready: true }] }),
      ),
    ).toBe(0);
  });

  it("getPodLastRestartAt returns the latest restart timestamp", () => {
    expect(
      getPodLastRestartAt(
        makePod({
          containerStatuses: [
            {
              lastState: { terminated: { finishedAt: "2026-10-14T00:00:00Z" } },
            },
            {
              state: { terminated: { finishedAt: "2026-10-15T00:00:00Z" } },
            },
          ],
        }),
      ),
    ).toBe("2026-10-15T00:00:00Z");
    expect(getPodLastRestartAt(makePod({}))).toBe("");
  });
});
