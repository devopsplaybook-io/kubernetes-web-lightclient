import { Span } from "@opentelemetry/api";
import { Config } from "../Config";
import {
  StatsDataMetricsInit,
  StatsDataMetricsReconfigure,
  StatsDataGet,
} from "./StatsDataMetrics";
import {
  StatsDataPodUsageInit,
  StatsDataPodUsageReconfigure,
  PodResourcesGet,
  PodUsageStatsGet,
} from "./StatsDataPodUsage";
import { kubernetesCommand } from "./StatsDataUtils";

export { StatsDataGet, PodResourcesGet, PodUsageStatsGet, kubernetesCommand };

export async function StatsDataInit(
  context: Span,
  config: Config,
): Promise<void> {
  await StatsDataMetricsInit(context, config);
  await StatsDataPodUsageInit(context, config);
}

/**
 * Re-arm the scheduled capture loops, e.g. after a configuration reload.
 */
export function StatsDataReconfigure(config: Config): void {
  StatsDataMetricsReconfigure(config);
  StatsDataPodUsageReconfigure(config);
}
