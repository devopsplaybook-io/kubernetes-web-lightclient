/**
 * Stats API client with conditional GET support: every request may carry an
 * `If-None-Match` header and the server answers `304 Not Modified` when the
 * data did not change, so unchanged polls transfer no payload.
 */
import axios from "axios";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config.ts";

// Pod requests/limits change rarely: the server refreshes them every 30
// minutes by default (POD_RESOURCES_FETCH_FREQUENCY).
export const POD_RESOURCES_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export interface ConditionalResult<T> {
  notModified: boolean;
  etag: string | null;
  data: T | null;
}

export interface StatsNodesPayload {
  stats: any[];
}

export interface PodResourcesPayload {
  podResources: any[];
}

export interface PodUsagePayload {
  podUsageStats: any[];
}

export interface RecommendationPayload {
  enabled: boolean;
  recommendation: any | null;
}

async function conditionalGet<T>(
  path: string,
  etag: string | null,
): Promise<ConditionalResult<T>> {
  const config = await Config.get();
  const auth = await AuthService.getAuthHeader();
  const headers = {
    ...auth.headers,
    ...(etag ? { "If-None-Match": etag } : {}),
  };
  const response = await axios.get(`${config.SERVER_URL}${path}`, {
    headers,
    validateStatus: (status) =>
      (status >= 200 && status < 300) || status === 304,
  });
  if (response.status === 304) {
    return {
      notModified: true,
      etag: response.headers?.etag ?? etag,
      data: null,
    };
  }
  return {
    notModified: false,
    etag: response.headers?.etag ?? null,
    data: response.data as T,
  };
}

async function getNodes(etag: string | null) {
  return conditionalGet<StatsNodesPayload>("/stats/nodes", etag);
}

async function getPodResources(etag: string | null) {
  return conditionalGet<PodResourcesPayload>("/stats/pod-resources", etag);
}

async function getPodUsage(etag: string | null) {
  return conditionalGet<PodUsagePayload>("/stats/pod-usage", etag);
}

async function getRecommendation(etag: string | null) {
  return conditionalGet<RecommendationPayload>("/stats/recommendation", etag);
}

async function regenerateRecommendation() {
  const config = await Config.get();
  const response = await axios.post(
    `${config.SERVER_URL}/stats/recommendation/regenerate`,
    {},
    await AuthService.getAuthHeader(),
  );
  return response.data as RecommendationPayload;
}

export const StatsApi = {
  getNodes,
  getPodResources,
  getPodUsage,
  getRecommendation,
  regenerateRecommendation,
};

/**
 * Stable fingerprint of the node stats series, used to skip chart rebuilds
 * when a refresh returned the same data with a different etag.
 */
export function BuildStatsFingerprint(stats: any[]): string {
  return JSON.stringify(
    (stats || []).map((s) => [
      s.node,
      s.timestamp,
      s.cpuUsage,
      s.memoryUsage,
      s.pods,
      s.podRestarts,
    ]),
  );
}
