import { Span } from "@opentelemetry/api";
import { Config } from "../Config";
import { StatsDataMetricsInit, StatsDataGet } from "./StatsDataMetrics";
import {
  StatsDataPodUsageInit,
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
