import { Span } from "@opentelemetry/sdk-trace-base";
import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import type { Config } from "../Config";
import { PodResourceMeasurement } from "../model/PodResourceMeasurement";
import { StatsNodeMesurement } from "../model/StatsNodeMesurement";

const mockSpan = {
  end: jest.fn(),
  setAttribute: jest.fn(),
};

jest.mock("../OTelContext", () => ({
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  }),
  OTelTracer: () => ({
    startSpan: () => mockSpan,
  }),
}));

const mockLlmIsEnabled = jest.fn(() => true);
const mockLlmRequest = jest.fn();
const mockNotificationsIsEnabled = jest.fn(() => false);
const mockNotificationsInfo = jest.fn(async (..._args: unknown[]) => true);

jest.mock("@devopsplaybook.io/common-utils", () => ({
  LLMClient: jest.fn(() => ({
    isEnabled: () => mockLlmIsEnabled(),
    request: (messages: unknown) => mockLlmRequest(messages),
  })),
  NotificationsClient: jest.fn(() => ({
    isEnabled: () => mockNotificationsIsEnabled(),
    info: (...args: unknown[]) => mockNotificationsInfo(...args),
  })),
}));

const mockStatsDataGet = jest.fn(async () => []);
const mockPodResourcesGet = jest.fn(async () => []);
const mockKubernetesCommand = jest.fn(async (_args: string[]) =>
  JSON.stringify({ items: [] }),
);

jest.mock("./StatsData", () => ({
  StatsDataGet: () => mockStatsDataGet(),
  PodResourcesGet: () => mockPodResourcesGet(),
  kubernetesCommand: (args: string[]) => mockKubernetesCommand(args),
}));

import {
  BuildNotificationSource,
  BuildRecommendationSummary,
  GetLatestNodeStats,
  ParseRecommendationResponse,
  RecommendationGenerate,
  RecommendationGetCached,
  RecommendationIsGenerating,
  StatsDataRecommendationInit,
} from "./StatsDataRecommendation";

const PREVIOUS_RECOMMENDATION = {
  generatedAt: "2026-10-01T00:00:00.000Z",
  analysis: "previous analysis",
  recommendations: "previous recommendations",
};

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

    test("keeps all lines of a multi-line analysis section", () => {
      const content =
        "## Analysis\nLine one.\nLine two.\n\nLine three.\n\n" +
        "## Recommendations\n- First\n- Second";
      const parsed = ParseRecommendationResponse(content);
      expect(parsed.analysis).toBe("Line one.\nLine two.\n\nLine three.");
      expect(parsed.recommendations).toBe("- First\n- Second");
    });

    test("keeps multi-line content when no recommendations section exists", () => {
      const content = "## Analysis\nLine one.\nLine two.\nLine three.";
      const parsed = ParseRecommendationResponse(content);
      expect(parsed.analysis).toBe("Line one.\nLine two.\nLine three.");
      expect(parsed.recommendations).toBe("");
    });

    test("falls back to full content when sections are missing", () => {
      const content = "Everything seems fine.";
      const parsed = ParseRecommendationResponse(content);
      expect(parsed.analysis).toBe("Everything seems fine.");
      expect(parsed.recommendations).toBe("");
    });
  });

  describe("RecommendationGenerate", () => {
    let tmpDir: string;

    function testConfig(): Config {
      return {
        DATA_DIR: tmpDir,
        LLM_RECOMMENDATIONS_ENABLED: true,
        LLM_RECOMMENDATIONS_CRON: "not-a-valid-cron",
        LLM_API_KEY: "test-key",
        LLM_API_URL: "http://localhost:11434",
        LLM_MODEL: "test-model",
        NOTIFICATIONS_API: "",
        NOTIFICATIONS_TOKEN: "",
        APPLICATION_TITLE: "Test",
      } as unknown as Config;
    }

    beforeEach(async () => {
      jest.clearAllMocks();
      tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), "recommendation-spec-"));
      // Preload a cached recommendation so Init does not trigger a stray
      // initial generation
      await fse.writeJson(
        path.join(tmpDir, "llm-recommendation.json"),
        PREVIOUS_RECOMMENDATION,
      );
      mockLlmIsEnabled.mockReturnValue(true);
      mockNotificationsIsEnabled.mockReturnValue(false);
      mockStatsDataGet.mockResolvedValue([]);
      mockPodResourcesGet.mockResolvedValue([]);
      mockKubernetesCommand.mockResolvedValue(JSON.stringify({ items: [] }));
      await StatsDataRecommendationInit(
        mockSpan as unknown as Span,
        testConfig(),
      );
    });

    afterEach(async () => {
      await fse.remove(tmpDir);
    });

    test("collapses two concurrent generations into a single LLM request", async () => {
      let releaseLlm!: (value: { content: string }) => void;
      mockLlmRequest.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseLlm = resolve;
          }),
      );

      const first = RecommendationGenerate();
      const second = RecommendationGenerate();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(RecommendationIsGenerating()).toBe(true);
      expect(mockLlmRequest).toHaveBeenCalledTimes(1);

      releaseLlm({
        content:
          "## Analysis\nCluster is healthy.\n\n## Recommendations\n- Nothing to do",
      });
      await Promise.all([first, second]);

      expect(RecommendationIsGenerating()).toBe(false);
      expect(mockLlmRequest).toHaveBeenCalledTimes(1);
      expect((await RecommendationGetCached())?.analysis).toBe(
        "Cluster is healthy.",
      );
    });

    test("keeps multi-line analysis sections through the generation pipeline", async () => {
      mockLlmRequest.mockResolvedValue({
        content:
          "## Analysis\nFirst line.\nSecond line.\nThird line.\n\n" +
          "## Recommendations\n- First recommendation\n- Second recommendation",
      });

      await RecommendationGenerate();

      const cached = await RecommendationGetCached();
      expect(cached?.analysis).toBe("First line.\nSecond line.\nThird line.");
      expect(cached?.recommendations).toBe(
        "- First recommendation\n- Second recommendation",
      );

      const persisted = await fse.readJson(
        path.join(tmpDir, "llm-recommendation.json"),
      );
      expect(persisted.analysis).toBe("First line.\nSecond line.\nThird line.");
    });

    test("keeps the previous recommendation when the LLM call fails", async () => {
      mockLlmRequest.mockRejectedValue(new Error("LLM unavailable"));

      await RecommendationGenerate();

      const cached = await RecommendationGetCached();
      expect(cached?.analysis).toBe(PREVIOUS_RECOMMENDATION.analysis);
      expect(cached?.recommendations).toBe(
        PREVIOUS_RECOMMENDATION.recommendations,
      );

      const persisted = await fse.readJson(
        path.join(tmpDir, "llm-recommendation.json"),
      );
      expect(persisted.analysis).toBe(PREVIOUS_RECOMMENDATION.analysis);
    });

    test("keeps the previous recommendation when the response is too short", async () => {
      mockLlmRequest.mockResolvedValue({ content: "too short" });

      await RecommendationGenerate();

      expect((await RecommendationGetCached())?.analysis).toBe(
        PREVIOUS_RECOMMENDATION.analysis,
      );
    });

    test("caches the recommendation even when the notification fails", async () => {
      mockNotificationsIsEnabled.mockReturnValue(true);
      mockNotificationsInfo.mockRejectedValue(new Error("notification down"));
      mockLlmRequest.mockResolvedValue({
        content:
          "## Analysis\nAll good everywhere.\n\n## Recommendations\n- Keep going",
      });

      await RecommendationGenerate();

      expect(mockNotificationsInfo).toHaveBeenCalledTimes(1);
      expect((await RecommendationGetCached())?.analysis).toBe(
        "All good everywhere.",
      );
    });
  });
});
