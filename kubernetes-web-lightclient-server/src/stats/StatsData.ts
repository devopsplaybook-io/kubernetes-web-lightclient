import { Span } from "@opentelemetry/api";
import { Config } from "../Config";
import {
  StatsDataMetricsRunCapture,
  StatsDataMetricsSetup,
  StatsDataMetricsReconfigure,
  StatsDataGet,
  StatsDataGetEtag,
} from "./StatsDataMetrics";
import {
  StatsDataPodUsageRunCapture,
  StatsDataPodUsageSetup,
  StatsDataPodUsageReconfigure,
  PodResourcesGet,
  PodResourcesGetEtag,
  PodUsageStatsGet,
  PodUsageStatsGetEtag,
} from "./StatsDataPodUsage";
import { StatsDataUtilsInit, kubernetesCommand } from "./StatsDataUtils";

export {
  StatsDataGet,
  StatsDataGetEtag,
  PodResourcesGet,
  PodResourcesGetEtag,
  PodUsageStatsGet,
  PodUsageStatsGetEtag,
  kubernetesCommand,
};

const STATS_INITIAL_CAPTURE_DEADLINE_MS = 5000;

let ready = false;
let initialCapturePromise: Promise<void> | null = null;

/**
 * Prepare stats state and intervals. Deliberately performs no kubectl call:
 * the HTTP listener must start before the first captures run.
 */
export async function StatsDataInit(
  _context: Span,
  config: Config,
): Promise<void> {
  StatsDataUtilsInit(config);
  await StatsDataMetricsSetup(config);
  await StatsDataPodUsageSetup(config);
  ready = false;
  initialCapturePromise = null;
}

/**
 * Run the initial captures without blocking startup. Readiness is released
 * when both captures settle or after a short deadline, whichever comes
 * first, so a slow or unavailable cluster never hangs the probe.
 */
export function StatsDataStartInitialCapture(config: Config): Promise<void> {
  if (initialCapturePromise) {
    return initialCapturePromise;
  }
  initialCapturePromise = ExecuteInitialCapture(config);
  return initialCapturePromise;
}

export function StatsDataIsReady(): boolean {
  return ready;
}

/**
 * Re-arm the scheduled capture loops, e.g. after a configuration reload.
 */
export function StatsDataReconfigure(config: Config): void {
  StatsDataUtilsInit(config);
  StatsDataMetricsReconfigure(config);
  StatsDataPodUsageReconfigure(config);
}

async function ExecuteInitialCapture(config: Config): Promise<void> {
  let deadline: NodeJS.Timeout;
  const deadlinePromise = new Promise<void>((resolve) => {
    deadline = setTimeout(resolve, STATS_INITIAL_CAPTURE_DEADLINE_MS);
  });
  try {
    await Promise.race([
      Promise.allSettled([
        StatsDataMetricsRunCapture(config),
        StatsDataPodUsageRunCapture(config),
      ]),
      deadlinePromise,
    ]);
  } finally {
    if (deadline) {
      clearTimeout(deadline);
    }
    ready = true;
  }
}
