import { describe, expect, it } from "vitest";
import { getPodDisplayRow } from "~~/services/KubernetesUtils";

function makePod(overrides: Record<string, any> = {}): any {
  return {
    metadata: { name: "pod-1", namespace: "default" },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          ready: true,
          restartCount: 1,
          state: { terminated: { finishedAt: "2026-10-15T00:00:00Z" } },
        },
        {
          ready: true,
          restartCount: 2,
          lastState: { terminated: { finishedAt: "2026-10-14T00:00:00Z" } },
        },
      ],
    },
    ...overrides,
  };
}

describe("getPodDisplayRow", () => {
  it("returns the same cached object for the same pod", () => {
    const pod = makePod();
    expect(getPodDisplayRow(pod)).toBe(getPodDisplayRow(pod));
  });

  it("derives status and status class", () => {
    expect(getPodDisplayRow(makePod()).status).toBe("Running");
    expect(getPodDisplayRow(makePod()).statusClass).toBe("status-ok");

    const crash = makePod({
      status: {
        phase: "Running",
        containerStatuses: [
          { ready: false, state: { waiting: { reason: "CrashLoopBackOff" } } },
        ],
      },
    });
    expect(getPodDisplayRow(crash).status).toBe("CrashLoopBackOff");
    expect(getPodDisplayRow(crash).statusClass).toBe("status-error");
  });

  it("computes ready counts, ratio and restart count", () => {
    const row = getPodDisplayRow(makePod());
    expect(row.ready).toBe(2);
    expect(row.total).toBe(2);
    expect(row.readyRatio).toBe(1);
    expect(row.restartCount).toBe(3);
    expect(row.lastRestartAt).toBe("2026-10-15T00:00:00Z");
  });

  it("uses -1 as ready ratio when there is no container status", () => {
    const row = getPodDisplayRow(
      makePod({ status: { phase: "Pending" } }),
    );
    expect(row.ready).toBe(0);
    expect(row.total).toBe(0);
    expect(row.readyRatio).toBe(-1);
  });

  it("marks a pod fully ready only when every container is ready", () => {
    expect(getPodDisplayRow(makePod()).fullyReady).toBe(true);
    const notReady = makePod({
      status: {
        phase: "Running",
        containerStatuses: [{ ready: false, restartCount: 0 }],
      },
    });
    expect(getPodDisplayRow(notReady).fullyReady).toBe(false);
  });

  it("treats status-less pods as ready only in a terminal phase", () => {
    const running = makePod({ status: { phase: "Running" } });
    const succeeded = makePod({ status: { phase: "Succeeded" } });
    const pending = makePod({ status: { phase: "Pending" } });

    expect(getPodDisplayRow(running).fullyReady).toBe(true);
    expect(getPodDisplayRow(succeeded).fullyReady).toBe(true);
    expect(getPodDisplayRow(pending).fullyReady).toBe(false);
  });
});
