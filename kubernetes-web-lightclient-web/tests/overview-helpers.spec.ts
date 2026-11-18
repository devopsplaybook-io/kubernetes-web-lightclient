import { describe, expect, it, vi } from "vitest";

vi.mock("~~/stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => ({}),
}));

import {
  FormatKiB,
  FormatMillicores,
  FormatRatio,
  GetCapacitySummary,
  GetNodeHealth,
  GetPodHealth,
  GetPodProblemState,
  GetRecentWarnings,
  GetTopRestartingWorkloads,
  NODE_PROBLEMS_QUERY,
  ParseCpuToMillicores,
  ParseMemoryToKiB,
  PODS_NOT_RUNNING_QUERY,
  PodStateListPath,
  WARNINGS_QUERY,
  WorkloadDrilldownPath,
} from "~~/services/Overview";

function makePod(name: string, overrides: Record<string, any> = {}): any {
  return {
    metadata: {
      name,
      namespace: "default",
      uid: `uid-${name}`,
      labels: {},
      creationTimestamp: "2026-11-01T00:00:00Z",
    },
    spec: { containers: [] },
    status: { phase: "Running", containerStatuses: [{ ready: true, restartCount: 0 }] },
    ...overrides,
  };
}

function waitingPod(name: string, reason: string): any {
  return makePod(name, {
    status: {
      phase: "Running",
      containerStatuses: [
        { ready: false, restartCount: 1, state: { waiting: { reason } } },
      ],
    },
  });
}

describe("GetPodProblemState", () => {
  it("classifies terminating, crashloop and image-pull pods", () => {
    expect(
      GetPodProblemState(
        makePod("term", {
          metadata: { name: "term", namespace: "default", deletionTimestamp: "2026-11-01T00:00:00Z" },
        }),
      ),
    ).toBe("terminating");
    expect(GetPodProblemState(waitingPod("crash", "CrashLoopBackOff"))).toBe(
      "crashloop",
    );
    for (const reason of [
      "ImagePullBackOff",
      "ErrImagePull",
      "InvalidImageName",
      "ErrImageNeverPull",
      "RegistryUnavailable",
    ]) {
      expect(GetPodProblemState(waitingPod(`img-${reason}`, reason))).toBe(
        "imagepull",
      );
    }
  });

  it("classifies pending pods including init-container states", () => {
    expect(
      GetPodProblemState(makePod("pending", { status: { phase: "Pending" } })),
    ).toBe("pending");
    expect(
      GetPodProblemState(waitingPod("creating", "ContainerCreating")),
    ).toBe("pending");
    expect(
      GetPodProblemState(
        makePod("init", {
          status: {
            phase: "Pending",
            initContainerStatuses: [
              { state: { waiting: { reason: "PodInitializing" } } },
            ],
          },
        }),
      ),
    ).toBe("pending");
  });

  it("classifies every other non-running state as failed", () => {
    for (const reason of [
      "Failed",
      "Error",
      "OOMKilled",
      "Evicted",
      "Unknown",
      "StartupError",
      "CreateContainerConfigError",
      "RunContainerError",
    ]) {
      expect(GetPodProblemState(waitingPod(`failed-${reason}`, reason))).toBe(
        "failed",
      );
    }
    expect(
      GetPodProblemState(makePod("failed-phase", { status: { phase: "Failed" } })),
    ).toBe("failed");
  });

  it("returns no problem for running, succeeded and completed pods", () => {
    expect(GetPodProblemState(makePod("running"))).toBe("");
    expect(
      GetPodProblemState(makePod("succeeded", { status: { phase: "Succeeded" } })),
    ).toBe("");
    expect(
      GetPodProblemState(
        makePod("completed", {
          status: {
            phase: "Succeeded",
            containerStatuses: [
              { ready: false, state: { terminated: { reason: "Completed" } } },
            ],
          },
        }),
      ),
    ).toBe("");
  });

  it("uses a fixed precedence: terminating wins over the waiting reason", () => {
    const pod = waitingPod("both", "CrashLoopBackOff");
    pod.metadata.deletionTimestamp = "2026-11-01T00:00:00Z";
    expect(GetPodProblemState(pod)).toBe("terminating");
  });
});

describe("GetPodHealth", () => {
  it("counts the non-running pods in mutually exclusive buckets", () => {
    const health = GetPodHealth([
      makePod("ok"),
      makePod("pending", { status: { phase: "Pending" } }),
      waitingPod("crash", "CrashLoopBackOff"),
      waitingPod("image", "ImagePullBackOff"),
      waitingPod("failed", "OOMKilled"),
      makePod("term", {
        metadata: { name: "term", namespace: "default", deletionTimestamp: "2026-11-01T00:00:00Z" },
      }),
    ]);

    expect(health.total).toBe(6);
    expect(health.notRunning).toBe(5);
    expect(health.states.pending).toHaveLength(1);
    expect(health.states.crashloop).toHaveLength(1);
    expect(health.states.imagepull).toHaveLength(1);
    expect(health.states.failed).toHaveLength(1);
    expect(health.states.terminating).toHaveLength(1);
  });

  it("handles an empty list", () => {
    const health = GetPodHealth([]);
    expect(health.total).toBe(0);
    expect(health.notRunning).toBe(0);
  });
});

describe("GetNodeHealth", () => {
  it("counts ready nodes and lists the not-ready ones", () => {
    const node = (name: string, status?: string) => ({
      metadata: { name },
      status: { conditions: status ? [{ type: "Ready", status }] : [] },
    });

    const health = GetNodeHealth([
      node("ready", "True"),
      node("not-ready", "False"),
      node("no-condition"),
    ]);

    expect(health.total).toBe(3);
    expect(health.ready).toBe(1);
    expect(health.notReady.map((item: any) => item.metadata.name)).toEqual([
      "not-ready",
      "no-condition",
    ]);
  });
});

describe("GetRecentWarnings", () => {
  const warning = (
    name: string,
    reason: string,
    time: string,
    count: number,
    extra: Record<string, any> = {},
  ) => ({
    type: "Warning",
    reason,
    message: `${reason} on ${name}`,
    count,
    lastTimestamp: time,
    involvedObject: { kind: "Pod", name, namespace: "default" },
    metadata: { name: `${name}-event`, creationTimestamp: time },
    ...extra,
  });

  it("keeps only warnings, newest first", () => {
    const rows = GetRecentWarnings([
      warning("old", "BackOff", "2026-11-01T00:00:00Z", 1),
      { type: "Normal", reason: "Started", involvedObject: { kind: "Pod", name: "x" } },
      warning("new", "Failed", "2026-11-02T00:00:00Z", 2),
    ]);

    expect(rows.map((row) => row.name)).toEqual(["new", "old"]);
    expect(rows[0].count).toBe(2);
  });

  it("deduplicates by involved object and reason, keeping the newest count", () => {
    const rows = GetRecentWarnings([
      warning("api", "BackOff", "2026-11-01T00:00:00Z", 3),
      warning("api", "BackOff", "2026-11-02T00:00:00Z", 9),
      warning("api", "Failed", "2026-11-01T00:00:00Z", 1),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].reason).toBe("BackOff");
    expect(rows[0].count).toBe(9);
  });

  it("uses the series count and a minimum of one", () => {
    const rows = GetRecentWarnings([
      {
        type: "Warning",
        reason: "BackOff",
        involvedObject: { kind: "Pod", name: "api", namespace: "default" },
        series: { count: 7 },
        metadata: { creationTimestamp: "2026-11-02T00:00:00Z" },
      },
      {
        type: "Warning",
        reason: "Failed",
        involvedObject: { kind: "Pod", name: "web", namespace: "default" },
        metadata: { creationTimestamp: "2026-11-01T00:00:00Z" },
      },
    ]);

    expect(rows[0].count).toBe(7);
    expect(rows[1].count).toBe(1);
  });

  it("limits the result", () => {
    const events = Array.from({ length: 8 }, (_, index) =>
      warning(`pod-${index}`, "BackOff", `2026-11-0${index + 1}T00:00:00Z`, 1),
    );
    expect(GetRecentWarnings(events, 3)).toHaveLength(3);
    expect(GetRecentWarnings(events)).toHaveLength(5);
  });
});

describe("GetTopRestartingWorkloads", () => {
  function restartingPod(
    name: string,
    restarts: number,
    owner: Record<string, string> | null,
    labels: Record<string, string> = {},
    finishedAt = "",
  ): any {
    return makePod(name, {
      metadata: {
        name,
        namespace: "default",
        uid: `uid-${name}`,
        labels,
        ...(owner
          ? { ownerReferences: [{ kind: owner.kind, name: owner.name, uid: "owner-uid" }] }
          : {}),
      },
      status: {
        phase: "Running",
        containerStatuses: [
          {
            ready: true,
            restartCount: restarts,
            lastState: finishedAt
              ? { terminated: { finishedAt } }
              : undefined,
          },
        ],
      },
    });
  }

  const deployments = [
    {
      metadata: { name: "web", namespace: "default" },
      spec: { selector: { matchLabels: { app: "web" } } },
    },
  ];

  it("resolves ReplicaSet pods back to their Deployment", () => {
    const rows = GetTopRestartingWorkloads(
      [
        restartingPod("web-abc-1", 3, { kind: "ReplicaSet", name: "web-abc" }, { app: "web" }),
        restartingPod("web-abc-2", 2, { kind: "ReplicaSet", name: "web-abc" }, { app: "web" }),
      ],
      deployments,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "deployment",
      name: "web",
      namespace: "default",
      restarts: 5,
    });
  });

  it("keeps the ReplicaSet when no deployment selector matches", () => {
    const rows = GetTopRestartingWorkloads(
      [restartingPod("other-abc-1", 4, { kind: "ReplicaSet", name: "other-abc" }, { app: "other" })],
      deployments,
    );

    expect(rows[0]).toMatchObject({ kind: "replicaset", name: "other-abc" });
  });

  it("resolves StatefulSet owners and reports standalone pods", () => {
    const rows = GetTopRestartingWorkloads(
      [
        restartingPod("db-0", 6, { kind: "StatefulSet", name: "db" }, { app: "db" }),
        restartingPod("standalone", 2, null),
      ],
      [],
    );

    expect(rows.map((row) => `${row.kind}/${row.name}`)).toEqual([
      "statefulset/db",
      "pod/standalone",
    ]);
  });

  it("ignores pods without restarts and sorts by restarts then last restart", () => {
    const rows = GetTopRestartingWorkloads(
      [
        restartingPod("idle", 0, null),
        restartingPod("old", 2, null, {}, "2026-11-01T00:00:00Z"),
        restartingPod("new", 2, null, {}, "2026-11-02T00:00:00Z"),
        restartingPod("top", 5, null),
      ],
      [],
    );

    expect(rows.map((row) => row.name)).toEqual(["top", "new", "old"]);
    expect(rows[1].lastRestartAt).toBe("2026-11-02T00:00:00Z");
  });

  it("limits the result", () => {
    const pods = Array.from({ length: 8 }, (_, index) =>
      restartingPod(`pod-${index}`, index + 1, null),
    );
    expect(GetTopRestartingWorkloads(pods, [], 3)).toHaveLength(3);
  });
});

describe("GetCapacitySummary", () => {
  function capacityPod(requests: any, limits: any): any {
    return makePod("pod", { spec: { containers: [{ resources: { requests, limits } }] } });
  }

  const nodes = [
    {
      metadata: { name: "n1" },
      status: { allocatable: { cpu: "2", memory: "4Gi" } },
    },
    {
      metadata: { name: "n2" },
      status: { capacity: { cpu: "1", memory: "2Gi" } },
    },
  ];

  it("sums allocatable, requests and limits and computes ratios", () => {
    const summary = GetCapacitySummary(
      nodes,
      [
        capacityPod({ cpu: "250m", memory: "128Mi" }, { cpu: "500m", memory: "256Mi" }),
        capacityPod({ cpu: "250m", memory: "128Mi" }, { cpu: "500m", memory: "256Mi" }),
      ],
      [],
    );

    expect(summary.cpuAllocatableMillicores).toBe(3000);
    expect(summary.memoryAllocatableKiB).toBe(6 * 1024 * 1024);
    expect(summary.cpuRequestsMillicores).toBe(500);
    expect(summary.cpuLimitsMillicores).toBe(1000);
    expect(summary.memoryRequestsKiB).toBe(256 * 1024);
    expect(summary.memoryLimitsKiB).toBe(512 * 1024);
    expect(summary.cpuRequestRatio).toBeCloseTo(500 / 3000);
    expect(summary.cpuLimitRatio).toBeCloseTo(1000 / 3000);
    expect(summary.usageAvailable).toBe(false);
    expect(summary.cpuUsageMillicores).toBeNull();
  });

  it("sums the non-null usage values and reports availability", () => {
    const summary = GetCapacitySummary(nodes, [], [
      { name: "a", namespace: "default", cpuLatest: 100, memoryLatest: 1024 },
      { name: "b", namespace: "default", cpuLatest: null, memoryLatest: 2048 },
      { name: "c", namespace: "default", cpuLatest: null, memoryLatest: null },
    ]);

    expect(summary.usageAvailable).toBe(true);
    expect(summary.cpuUsageMillicores).toBe(100);
    expect(summary.memoryUsageKiB).toBe(3072);
    expect(summary.cpuUsageRatio).toBeCloseTo(100 / 3000);
  });

  it("returns null ratios when there is no allocatable capacity", () => {
    const summary = GetCapacitySummary([], [], [{ cpuLatest: 10, memoryLatest: 10 }]);

    expect(summary.cpuRequestRatio).toBeNull();
    expect(summary.cpuUsageRatio).toBeNull();
    expect(summary.memoryUsageRatio).toBeNull();
  });

  it("ignores init containers, matching the Stats page", () => {
    const pod = makePod("init", {
      spec: {
        containers: [{ resources: { requests: { cpu: "1" } } }],
        initContainers: [{ resources: { requests: { cpu: "500m" } } }],
      },
    });

    expect(GetCapacitySummary([], [pod], []).cpuRequestsMillicores).toBe(1000);
  });
});

describe("quantity parsers and formatters", () => {
  it("parses CPU quantities to millicores", () => {
    expect(ParseCpuToMillicores("250m")).toBe(250);
    expect(ParseCpuToMillicores("1.5")).toBe(1500);
    expect(ParseCpuToMillicores("2")).toBe(2000);
    expect(ParseCpuToMillicores(0.5)).toBe(500);
    expect(ParseCpuToMillicores("junk")).toBeNull();
    expect(ParseCpuToMillicores(undefined)).toBeNull();
  });

  it("parses memory quantities to KiB", () => {
    expect(ParseMemoryToKiB("1Ki")).toBe(1);
    expect(ParseMemoryToKiB("128Mi")).toBe(128 * 1024);
    expect(ParseMemoryToKiB("1Gi")).toBe(1024 * 1024);
    expect(ParseMemoryToKiB("1Ti")).toBe(1024 * 1024 * 1024);
    expect(ParseMemoryToKiB("512k")).toBeCloseTo((512 * 1000) / 1024);
    expect(ParseMemoryToKiB("1024")).toBe(1);
    expect(ParseMemoryToKiB("junk")).toBeNull();
  });

  it("formats millicores, KiB and ratios", () => {
    expect(FormatMillicores(250)).toBe("250m");
    expect(FormatMillicores(1500)).toBe("1.50");
    expect(FormatMillicores(null)).toBe("-");
    expect(FormatKiB(512)).toBe("512Ki");
    expect(FormatKiB(2048)).toBe("2.00Mi");
    expect(FormatKiB(1024 * 1024)).toBe("1.00Gi");
    expect(FormatKiB(null)).toBe("-");
    expect(FormatRatio(0.5)).toBe("50%");
    expect(FormatRatio(null)).toBe("-");
  });
});

describe("deep-link helpers", () => {
  it("builds the filtered list queries used by the tiles", () => {
    expect(NODE_PROBLEMS_QUERY).toBe(
      "/kubernetes?objectType=node&filter=has-warnings",
    );
    expect(WARNINGS_QUERY).toBe(
      "/kubernetes?objectType=events&filter=warnings",
    );
    expect(PODS_NOT_RUNNING_QUERY).toBe(
      "/kubernetes?objectType=pod&filter=not-running",
    );
    expect(PodStateListPath("pending")).toBe(
      "/kubernetes?objectType=pod&filter=pending",
    );
  });

  it("builds workload drill-down links only for supported kinds", () => {
    expect(WorkloadDrilldownPath("deployment", "web", "default")).toBe(
      "/kubernetes?objectType=pod&workload=deployment&workloadName=web&namespace=default",
    );
    expect(WorkloadDrilldownPath("replicaset", "web-abc", "default")).toBeNull();
    expect(WorkloadDrilldownPath("pod", "web", "default")).toBeNull();
  });
});
