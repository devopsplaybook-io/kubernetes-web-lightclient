import {
  LLMClient,
  LLMMessage,
  NotificationsClient,
} from "@devopsplaybook.io/common-utils";
import { Span } from "@opentelemetry/sdk-trace-base";
import * as fse from "fs-extra";
import * as cron from "node-cron";
import * as path from "path";
import { Config } from "../Config";
import { PodResourceMeasurement } from "../model/PodResourceMeasurement";
import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { PodResourcesGet, StatsDataGet, kubernetesCommand } from "./StatsData";

const logger = OTelLogger().createModuleLogger("StatsDataRecommendation");
const RECOMMENDATION_FILE = "llm-recommendation.json";

let config: Config;
let llmClient: LLMClient | null = null;
let notificationsClient: NotificationsClient | null = null;
let recommendationFilePath = "";
let cachedRecommendation: RecommendationResult | null = null;

export interface RecommendationResult {
  generatedAt: string;
  analysis: string;
  recommendations: string;
}

export interface PodStatusInfo {
  status: string;
  restarts: number;
}

export async function StatsDataRecommendationInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("StatsDataRecommendationInit", context);
  config = configIn;
  recommendationFilePath = path.join(config.DATA_DIR, RECOMMENDATION_FILE);

  try {
    if (await fse.pathExists(recommendationFilePath)) {
      cachedRecommendation = await fse.readJson(recommendationFilePath);
      logger.info(`Loaded cached recommendation from ${recommendationFilePath}`);
    }
  } catch (error) {
    logger.error("Failed to load cached recommendation", error, span);
  }

  llmClient = new LLMClient({
    apiKey: config.LLM_API_KEY,
    apiUrl: config.LLM_API_URL,
    model: config.LLM_MODEL,
    logger,
  });
  notificationsClient = new NotificationsClient({
    apiEndpoint: config.NOTIFICATIONS_API,
    apiToken: config.NOTIFICATIONS_TOKEN,
    logger,
  });

  if (RecommendationIsEnabled()) {
    if (cron.validate(config.LLM_RECOMMENDATIONS_CRON)) {
      logger.info(
        `Scheduling LLM recommendations: ${config.LLM_RECOMMENDATIONS_CRON}`,
      );
      cron.schedule(config.LLM_RECOMMENDATIONS_CRON, () => {
        RecommendationGenerate().catch((err) =>
          logger.error(`Failed to generate scheduled recommendation: ${err.message}`),
        );
      });
    } else {
      logger.warn(
        `Invalid LLM_RECOMMENDATIONS_CRON: ${config.LLM_RECOMMENDATIONS_CRON}`,
      );
    }
    // Generate on startup if no cached recommendation exists
    if (!cachedRecommendation) {
      logger.info(
        "No cached recommendation found, triggering initial generation",
      );
      RecommendationGenerate().catch((err) =>
        logger.error(`Failed to generate initial recommendation: ${err.message}`),
      );
    }
  } else {
    logger.info("LLM recommendations disabled");
  }
  span.end();
}

/**
 * The feature is enabled when turned on in the configuration and the
 * LLM client is fully configured (API key, URL and model).
 */
export function RecommendationIsEnabled(): boolean {
  return !!config?.LLM_RECOMMENDATIONS_ENABLED && !!llmClient?.isEnabled();
}

export async function RecommendationGetCached(): Promise<RecommendationResult | null> {
  return cachedRecommendation;
}

export async function RecommendationGenerate(): Promise<void> {
  const span = OTelTracer().startSpan("RecommendationGenerate");
  try {
    if (!RecommendationIsEnabled() || !llmClient) {
      logger.warn("Cannot generate recommendation: LLM recommendations are not enabled");
      return;
    }

    logger.info("Collecting cluster stats for LLM recommendation", span);

    const nodeStats = GetLatestNodeStats(await StatsDataGet());
    const podResources = await PodResourcesGet();
    const podStatuses = await GetPodStatuses();

    const summary = BuildRecommendationSummary(
      nodeStats,
      podResources,
      podStatuses,
    );

    const messages: LLMMessage[] = [
      {
        role: "system",
        content:
          "You are an experienced Kubernetes administrator. Analyze the provided " +
          "cluster statistics and give a concise assessment of the cluster health " +
          "and resource usage, with actionable advice. Answer in Markdown with " +
          "exactly two sections: '## Analysis' and '## Recommendations'.",
      },
      {
        role: "user",
        content: `Cluster stats summary (generated at ${new Date().toISOString()}):\n\n${summary}`,
      },
    ];

    let analysis = "";
    let recommendations = "";
    try {
      const llmResponse = await llmClient.request(messages);
      if (!llmResponse.content || llmResponse.content.trim().length < 20) {
        logger.warn("LLM returned empty or very short response");
        analysis =
          "LLM returned an empty response. Please check the LLM configuration.";
      } else {
        const parsed = ParseRecommendationResponse(llmResponse.content);
        analysis = parsed.analysis;
        recommendations = parsed.recommendations;
      }
    } catch (error) {
      logger.error(`LLM API call failed: ${error.message}`, error, span);
      analysis = `LLM recommendation generation failed: ${error.message}`;
    }

    cachedRecommendation = {
      generatedAt: new Date().toISOString(),
      analysis,
      recommendations,
    };
    await fse.ensureDir(path.dirname(recommendationFilePath));
    await fse.writeJson(recommendationFilePath, cachedRecommendation, {
      spaces: 2,
    });
    logger.info("LLM recommendation generated and cached successfully", span);

    await NotificationSendRecommendation(cachedRecommendation);
  } catch (error) {
    logger.error(`Failed to generate recommendation: ${error.message}`, error, span);
  }
  span.end();
}

// ── Pure helpers (exported for testing) ───────────────────────────────────────

/**
 * Build a compact text summary of the cluster for the LLM prompt.
 * Unknown values are omitted to keep the context small.
 */
export function BuildRecommendationSummary(
  nodeStats: StatsNodeMesurement[],
  podResources: PodResourceMeasurement[],
  podStatuses: Map<string, PodStatusInfo>,
): string {
  const lines: string[] = [];

  lines.push(`Nodes: ${nodeStats.length}, Pods: ${podResources.length}`);
  lines.push("Nodes (name, cpu %, memory %, pods):");
  for (const node of nodeStats) {
    const parts = [`node=${node.node}`];
    if (node.cpuUsage !== null) parts.push(`cpu=${node.cpuUsage.toFixed(1)}%`);
    if (node.memoryUsage !== null) {
      parts.push(`mem=${node.memoryUsage.toFixed(1)}%`);
    }
    parts.push(`pods=${node.pods}`);
    if (node.podRestarts !== null && node.podRestarts !== undefined) {
      parts.push(`podRestarts=${node.podRestarts}`);
    }
    lines.push(parts.join(" "));
  }

  lines.push("Pods (namespace, name, status, restarts, cpu req/limit/usage, memory req/limit/usage):");
  for (const pod of podResources) {
    const parts = [`ns=${pod.namespace}`, `pod=${pod.name}`];
    const statusInfo = podStatuses.get(`${pod.namespace}/${pod.name}`);
    if (statusInfo) {
      parts.push(`status=${statusInfo.status}`);
      parts.push(`restarts=${statusInfo.restarts}`);
    }
    if (pod.cpuRequest) parts.push(`cpuReq=${pod.cpuRequest}`);
    if (pod.cpuLimit) parts.push(`cpuLim=${pod.cpuLimit}`);
    if (pod.cpuUsage) parts.push(`cpuUse=${pod.cpuUsage}`);
    if (pod.memoryRequest) parts.push(`memReq=${pod.memoryRequest}`);
    if (pod.memoryLimit) parts.push(`memLim=${pod.memoryLimit}`);
    if (pod.memoryUsage) parts.push(`memUse=${pod.memoryUsage}`);
    lines.push(parts.join(" "));
  }

  return lines.join("\n");
}

/**
 * Split an LLM response into its analysis and recommendations sections.
 * Falls back to the full content as analysis when sections are not found.
 */
export function ParseRecommendationResponse(content: string): {
  analysis: string;
  recommendations: string;
} {
  const analysisMatch = content.match(
    /^## Analysis\s*\n([\s\S]*?)(?=\n^## Recommendations|\n?$)/im,
  );
  const recommendationsMatch = content.match(
    /^## Recommendations\s*\n([\s\S]*)/im,
  );
  let analysis = (analysisMatch?.[1] || "").trim();
  const recommendations = (recommendationsMatch?.[1] || "").trim();
  if (!analysis && !recommendations) {
    analysis = content.trim();
  }
  return { analysis, recommendations };
}

/**
 * Build the notification source (service name) for this instance.
 * The application title is normalized (lowercased, non-alphanumeric
 * characters collapsed to dashes) and appended as suffix so multiple
 * instances can be told apart. When no title is set, the plain
 * service name is used.
 */
export function BuildNotificationSource(applicationTitle?: string): string {
  const serviceName = "kubernetes-web-lightclient";
  const normalized = (applicationTitle ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `${serviceName}-${normalized}` : serviceName;
}

/**
 * Keep only the most recent measurement of each node.
 */
export function GetLatestNodeStats(
  stats: StatsNodeMesurement[],
): StatsNodeMesurement[] {
  const latestByNode = new Map<string, StatsNodeMesurement>();
  for (const stat of stats) {
    const existing = latestByNode.get(stat.node);
    if (!existing || new Date(stat.timestamp) > new Date(existing.timestamp)) {
      latestByNode.set(stat.node, stat);
    }
  }
  return Array.from(latestByNode.values());
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function GetPodStatuses(): Promise<Map<string, PodStatusInfo>> {
  const podStatuses = new Map<string, PodStatusInfo>();
  try {
    const podsObj = JSON.parse(
      await kubernetesCommand(`kubectl get pods --all-namespaces -o json`),
    );
    for (const pod of podsObj.items || []) {
      const namespace = pod.metadata?.namespace;
      const name = pod.metadata?.name;
      if (!namespace || !name) continue;
      const restarts = (pod.status?.containerStatuses || []).reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sum: number, cs: any) => sum + (cs.restartCount || 0),
        0,
      );
      podStatuses.set(`${namespace}/${name}`, {
        status: pod.status?.phase || "Unknown",
        restarts,
      });
    }
  } catch (error) {
    logger.error(`Failed to get pod statuses: ${error.message}`, error);
  }
  return podStatuses;
}

async function NotificationSendRecommendation(
  recommendation: RecommendationResult,
): Promise<void> {
  if (!notificationsClient || !notificationsClient.isEnabled()) {
    return;
  }
  const title = "Kubernetes LLM Recommendation generated";
  const body = `## Analysis\n${recommendation.analysis}\n\n## Recommendations\n${recommendation.recommendations}`;
  const response = await notificationsClient.info(
    title,
    body,
    BuildNotificationSource(config?.APPLICATION_TITLE),
  );
  if (response) {
    logger.info("LLM recommendation notification sent successfully");
  }
}
