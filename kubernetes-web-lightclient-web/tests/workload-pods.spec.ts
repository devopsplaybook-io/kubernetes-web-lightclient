import { describe, expect, it } from "vitest";
import {
  BuildPodSelector,
  DetectPodWaiting,
  MERGED_LOG_POD_CAP,
  MergeLogStreams,
  ParseWorkloadRoute,
  PodRestartCount,
  PodWarningEvents,
  ResolveWorkloadPods,
  WaitingGuidance,
  WorkloadDrilldownQuery,
  WorkloadKindLabel,
} from "../services/WorkloadPods";

function pod(
  name: string,
  labels: Record<string, string> = {},
  ownerUid?: string,
): Record<string, any> {
  return {
    metadata: {
      uid: `uid-${name}`,
      name,
      namespace: "default",
      labels,
      ownerReferences: ownerUid
        ? [{ kind: "ReplicaSet", name: "owner", uid: ownerUid }]
        : [],
    },
  };
}

function deployment(uid: string, matchLabels: Record<string, string>) {
  return {
    kind: "Deployment",
    metadata: { uid, name: "web", namespace: "default" },
    spec: { selector: { matchLabels } },
  };
}

describe("ParseWorkloadRoute", () => {
  it("reads a valid drill-down route", () => {
    expect(
      ParseWorkloadRoute({
        workload: "deployment",
        workloadName: "web",
        namespace: "default",
      }),
    ).toEqual({ kind: "deployment", name: "web", namespace: "default" });
  });

  it("rejects malformed or incomplete routes", () => {
    expect(ParseWorkloadRoute(null)).toBeNull();
    expect(ParseWorkloadRoute({})).toBeNull();
    expect(
      ParseWorkloadRoute({ workload: "pod", workloadName: "web", namespace: "default" }),
    ).toBeNull();
    expect(
      ParseWorkloadRoute({ workload: "deployment", workloadName: "web" }),
    ).toBeNull();
    expect(
      ParseWorkloadRoute({
        workload: "deployment",
        workloadName: "web",
        namespace: "../../etc",
      }),
    ).toBeNull();
    expect(
      ParseWorkloadRoute({
        workload: "deployment",
        workloadName: "web;id",
        namespace: "default",
      }),
    ).toBeNull();
  });
});

describe("BuildPodSelector", () => {
  it("serializes matchLabels in a canonical, sorted order", () => {
    expect(
      BuildPodSelector(deployment("d1", { tier: "web", app: "frontend" })),
    ).toBe("app=frontend,tier=web");
  });

  it("returns null when a selector cannot be expressed safely", () => {
    expect(BuildPodSelector({ kind: "CronJob", spec: {} })).toBeNull();
    expect(BuildPodSelector({ spec: {} })).toBeNull();
    expect(
      BuildPodSelector(deployment("d1", { app: "white space" })),
    ).toBeNull();
    expect(
      BuildPodSelector({
        spec: { selector: { matchExpressions: [{ key: "app", operator: "In", values: ["web"] }] } },
      }),
    ).toBeNull();
  });
});

describe("ResolveWorkloadPods", () => {
  it("matches pods through the workload selector", () => {
    const result = ResolveWorkloadPods({
      kind: "deployment",
      workload: deployment("d1", { app: "web" }),
      pods: [
        pod("web-a", { app: "web" }),
        pod("web-b", { app: "web" }),
        pod("other", { app: "api" }),
      ],
    });
    expect(result.strategy).toBe("selector");
    expect(result.pods.map((p) => p.metadata.name)).toEqual(["web-a", "web-b"]);
  });

  it("walks Deployment -> ReplicaSet -> Pod when forced to the owner chain", () => {
    const result = ResolveWorkloadPods({
      kind: "deployment",
      workload: deployment("d1", { app: "web" }),
      pods: [pod("web-a", {}, "rs-1"), pod("other", {}, "rs-2")],
      replicasets: [
        {
          metadata: { uid: "rs-1", ownerReferences: [{ uid: "d1" }] },
        },
        {
          metadata: { uid: "rs-2", ownerReferences: [{ uid: "other" }] },
        },
      ],
      forceOwner: true,
    });
    expect(result.strategy).toBe("owner");
    expect(result.pods.map((p) => p.metadata.name)).toEqual(["web-a"]);
  });

  it("walks CronJob -> Job -> Pod", () => {
    const result = ResolveWorkloadPods({
      kind: "cronjob",
      workload: {
        kind: "CronJob",
        metadata: { uid: "c1", name: "nightly", namespace: "default" },
      },
      pods: [pod("job-a-pod", {}, "job-1"), pod("job-b-pod", {}, "job-2")],
      jobs: [
        { metadata: { uid: "job-1", ownerReferences: [{ uid: "c1" }] } },
        { metadata: { uid: "job-2", ownerReferences: [{ uid: "elsewhere" }] } },
      ],
    });
    expect(result.strategy).toBe("owner");
    expect(result.pods.map((p) => p.metadata.name)).toEqual(["job-a-pod"]);
  });

  it("resolves a StatefulSet through its direct owner reference", () => {
    const result = ResolveWorkloadPods({
      kind: "statefulset",
      workload: {
        kind: "StatefulSet",
        metadata: { uid: "s1", name: "db", namespace: "default" },
        spec: {},
      },
      pods: [pod("db-0", {}, "s1")],
    });
    expect(result.pods.map((p) => p.metadata.name)).toEqual(["db-0"]);
  });

  it("deduplicates and sorts the resolved pods", () => {
    const result = ResolveWorkloadPods({
      kind: "deployment",
      workload: deployment("d1", { app: "web" }),
      pods: [
        pod("web-b", { app: "web" }),
        pod("web-a", { app: "web" }),
        pod("web-b", { app: "web" }),
      ],
    });
    expect(result.pods.map((p) => p.metadata.name)).toEqual(["web-a", "web-b"]);
  });
});

describe("PodRestartCount", () => {
  it("sums regular and init container restarts", () => {
    expect(
      PodRestartCount({
        status: {
          containerStatuses: [{ restartCount: 2 }, { restartCount: 1 }],
          initContainerStatuses: [{ restartCount: 4 }],
        },
      }),
    ).toBe(7);
    expect(PodRestartCount({})).toBe(0);
  });
});

describe("DetectPodWaiting", () => {
  it("detects allow-listed waiting reasons", () => {
    expect(
      DetectPodWaiting({
        status: {
          containerStatuses: [
            { name: "app", state: { waiting: { reason: "ImagePullBackOff" } } },
          ],
        },
      }),
    ).toEqual({ container: "app", reason: "ImagePullBackOff" });
  });

  it("falls back to a Pending phase and ignores running pods", () => {
    expect(DetectPodWaiting({ status: { phase: "Pending" } })).toEqual({
      container: "",
      reason: "Pending",
    });
    expect(
      DetectPodWaiting({
        status: {
          phase: "Running",
          containerStatuses: [
            { name: "app", state: { running: { startedAt: "now" } } },
          ],
        },
      }),
    ).toBeNull();
    expect(
      DetectPodWaiting({
        status: {
          containerStatuses: [
            { name: "app", state: { waiting: { reason: "SomeCustomReason" } } },
          ],
        },
      }),
    ).toBeNull();
  });
});

describe("WaitingGuidance", () => {
  it("maps waiting reasons to actionable guidance", () => {
    expect(WaitingGuidance("ImagePullBackOff")).toContain("imagePullSecrets");
    expect(WaitingGuidance("CreateContainerConfigError")).toContain(
      "ConfigMap/Secret",
    );
    expect(WaitingGuidance("CrashLoopBackOff")).toContain("Previous");
    expect(WaitingGuidance("Unexpected")).toContain("Events");
  });
});

describe("PodWarningEvents", () => {
  it("keeps Warning events for the given pods, newest first", () => {
    const events = [
      {
        type: "Warning",
        reason: "Old",
        lastTimestamp: "2026-10-14T00:00:00Z",
        involvedObject: { kind: "Pod", name: "web-a" },
      },
      {
        type: "Warning",
        reason: "New",
        lastTimestamp: "2026-10-16T00:00:00Z",
        involvedObject: { kind: "Pod", name: "web-a" },
      },
      {
        type: "Normal",
        reason: "Started",
        lastTimestamp: "2026-10-16T00:00:00Z",
        involvedObject: { kind: "Pod", name: "web-a" },
      },
      {
        type: "Warning",
        reason: "Elsewhere",
        lastTimestamp: "2026-10-16T00:00:00Z",
        involvedObject: { kind: "Pod", name: "other" },
      },
      {
        type: "Warning",
        reason: "Node",
        lastTimestamp: "2026-10-16T00:00:00Z",
        involvedObject: { kind: "Node", name: "web-a" },
      },
    ];
    expect(
      PodWarningEvents(events, ["web-a"]).map((event) => event.reason),
    ).toEqual(["New", "Old"]);
  });
});

describe("MergeLogStreams", () => {
  const streams = [
    {
      pod: "web-b",
      text:
        "2026-10-16T10:00:02Z b-second\n2026-10-16T10:00:04Z b-fourth\n",
    },
    {
      pod: "web-a",
      text:
        "2026-10-16T10:00:01Z a-first\n2026-10-16T10:00:03Z a-third\n",
    },
  ];

  it("merges the streams chronologically with pod prefixes", () => {
    const merged = MergeLogStreams(streams, true);
    expect(merged.lineCount).toBe(4);
    expect(merged.text.split("\n")).toEqual([
      "[web-a] 2026-10-16T10:00:01Z a-first",
      "[web-b] 2026-10-16T10:00:02Z b-second",
      "[web-a] 2026-10-16T10:00:03Z a-third",
      "[web-b] 2026-10-16T10:00:04Z b-fourth",
    ]);
  });

  it("strips the timestamps when the display toggle is off", () => {
    expect(MergeLogStreams(streams, false).text.split("\n")[0]).toBe(
      "[web-a] a-first",
    );
  });

  it("keeps multi-line messages together using the last timestamp", () => {
    const merged = MergeLogStreams(
      [
        {
          pod: "web-a",
          text:
            "2026-10-16T10:00:01Z first\ncontinuation\n2026-10-16T10:00:05Z last\n",
        },
      ],
      true,
    );
    expect(merged.text.split("\n")).toEqual([
      "[web-a] 2026-10-16T10:00:01Z first",
      "[web-a] 2026-10-16T10:00:01Z continuation",
      "[web-a] 2026-10-16T10:00:05Z last",
    ]);
  });

  it("handles empty streams", () => {
    expect(MergeLogStreams([{ pod: "web-a", text: "" }], true)).toEqual({
      text: "",
      lineCount: 0,
    });
    expect(MergeLogStreams([], true)).toEqual({ text: "", lineCount: 0 });
  });
});

describe("WorkloadDrilldownQuery", () => {
  it("builds the pod drill-down query", () => {
    expect(WorkloadDrilldownQuery("deployment", "web", "default")).toEqual({
      objectType: "pod",
      workload: "deployment",
      workloadName: "web",
      namespace: "default",
    });
  });

  it("optionally opens the merged logs dialog", () => {
    expect(
      WorkloadDrilldownQuery("cronjob", "nightly", "default", {
        mergedLogs: true,
      }).dialog,
    ).toBe("merged-logs");
  });

  it("exposes the merged pod cap", () => {
    expect(MERGED_LOG_POD_CAP).toBe(10);
  });
});

describe("WorkloadKindLabel", () => {
  it("uses the Kubernetes spelling of each workload kind", () => {
    expect(WorkloadKindLabel("deployment")).toBe("Deployment");
    expect(WorkloadKindLabel("statefulset")).toBe("StatefulSet");
    expect(WorkloadKindLabel("daemonset")).toBe("DaemonSet");
    expect(WorkloadKindLabel("job")).toBe("Job");
    expect(WorkloadKindLabel("cronjob")).toBe("CronJob");
    expect(WorkloadKindLabel("")).toBe("Workload");
  });
});
