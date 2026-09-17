import { PodResourceMeasurement } from "../model/PodResourceMeasurement";
import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import {
  BuildNotificationSource,
  BuildRecommendationSummary,
  GetLatestNodeStats,
  ParseRecommendationResponse,
} from "./StatsDataRecommendation";

describe("StatsDataRecommendation", () => {
  describe("GetLatestNodeStats", () => {
    test("keeps only the most recent measurement per node", () => {
      const stats = [
        new StatsNodeMesurement({
          node: "node-1",
          cpuUsage: 10,
          memoryUsage: 20,
          pods: 3,
          timestamp: new Date("2026-08-01T10:00:00Z"),
          podRestarts: 0,
        }),
        new StatsNodeMesurement({
          node: "node-1",
          cpuUsage: 50,
          memoryUsage: 60,
          pods: 4,
          timestamp: new Date("2026-08-01T11:00:00Z"),
          podRestarts: 1,
        }),
        new StatsNodeMesurement({
          node: "node-2",
          cpuUsage: 30,
          memoryUsage: 40,
          pods: 5,
          timestamp: new Date("2026-08-01T10:30:00Z"),
          podRestarts: 0,
        }),
      ];
      const latest = GetLatestNodeStats(stats);
      expect(latest).toHaveLength(2);
      const node1 = latest.find((s) => s.node === "node-1");
      expect(node1?.cpuUsage).toBe(50);
      expect(node1?.pods).toBe(4);
    });
  });

  describe("BuildRecommendationSummary", () => {
    test("includes nodes, pods and known resource values only", () => {
      const nodeStats = [
        new StatsNodeMesurement({
          node: "node-1",
          cpuUsage: 12.34,
          memoryUsage: null,
          pods: 18,
          timestamp: new Date("2026-08-01T10:00:00Z"),
          podRestarts: 2,
        }),
      ];
      const podResources = [
        new PodResourceMeasurement({
          name: "app-pod",
          namespace: "default",
          node: "node-1",
          cpuRequest: "100m",
          cpuLimit: "500m",
          memoryRequest: null,
          memoryLimit: null,
          cpuUsage: "45m",
          memoryUsage: null,
          timestamp: new Date("2026-08-01T10:00:00Z"),
        }),
      ];
      const podStatuses = new Map([
        ["default/app-pod", { status: "Running", restarts: 3 }],
      ]);

      const summary = BuildRecommendationSummary(
        nodeStats,
        podResources,
        podStatuses,
      );

      expect(summary).toContain("Nodes: 1, Pods: 1");
      expect(summary).toContain("node=node-1 cpu=12.3% pods=18 podRestarts=2");
      expect(summary).not.toContain("mem=");
      expect(summary).toContain(
        "ns=default pod=app-pod status=Running restarts=3 " +
          "cpuReq=100m cpuLim=500m cpuUse=45m",
      );
      expect(summary).not.toContain("memReq=");
    });

    test("omits status when pod is unknown", () => {
      const summary = BuildRecommendationSummary(
        [],
        [
          new PodResourceMeasurement({
            name: "app-pod",
            namespace: "default",
            node: "node-1",
            cpuRequest: null,
            cpuLimit: null,
            memoryRequest: null,
            memoryLimit: null,
            cpuUsage: null,
            memoryUsage: null,
            timestamp: new Date(),
          }),
        ],
        new Map(),
      );
      expect(summary).toContain("ns=default pod=app-pod");
      expect(summary).not.toContain("status=");
      expect(summary).not.toContain("restarts=");
    });
  });

  describe("BuildNotificationSource", () => {
    test("appends a normalized application name as suffix", () => {
      expect(BuildNotificationSource("Kubernetes")).toBe(
        "kubernetes-web-lightclient-kubernetes",
      );
      expect(BuildNotificationSource("Kubernetes Web")).toBe(
        "kubernetes-web-lightclient-kubernetes-web",
      );
    });

    test("returns the plain service name when the application name is not set", () => {
      expect(BuildNotificationSource(undefined)).toBe(
        "kubernetes-web-lightclient",
      );
      expect(BuildNotificationSource("")).toBe("kubernetes-web-lightclient");
      expect(BuildNotificationSource("   ")).toBe("kubernetes-web-lightclient");
    });

    test("trims surrounding whitespace and normalizes separators", () => {
      expect(BuildNotificationSource("  Kubernetes Web  ")).toBe(
        "kubernetes-web-lightclient-kubernetes-web",
      );
      expect(BuildNotificationSource("Kubernetes_Web")).toBe(
        "kubernetes-web-lightclient-kubernetes-web",
      );
    });
  });

  describe("ParseRecommendationResponse", () => {
    test("splits analysis and recommendations sections", () => {
      const content =
        "## Analysis\nThe cluster looks healthy.\n\n" +
        "## Recommendations\n- Set resource requests\n- Check restarts";
      const parsed = ParseRecommendationResponse(content);
      expect(parsed.analysis).toBe("The cluster looks healthy.");
      expect(parsed.recommendations).toBe(
        "- Set resource requests\n- Check restarts",
      );
    });

    test("falls back to full content when sections are missing", () => {
      const content = "Everything seems fine.";
      const parsed = ParseRecommendationResponse(content);
      expect(parsed.analysis).toBe("Everything seems fine.");
      expect(parsed.recommendations).toBe("");
    });
  });
});
