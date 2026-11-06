import { StatsNodeMesurement } from "../model/StatsNodeMesurement";

/** Upper bound of measurements returned per node, regardless of retention. */
export const STATS_MAX_POINTS_PER_NODE = 360;

/**
 * Bound the size of the stats history returned to clients: measurements are
 * grouped per node and each group above the cap is aggregated into
 * consecutive buckets (average usage, latest pods/restarts/timestamp). The
 * input is never mutated.
 */
export function DownsampleStatsPerNode(
  stats: StatsNodeMesurement[],
  maxPoints: number = STATS_MAX_POINTS_PER_NODE,
): StatsNodeMesurement[] {
  if (!stats || stats.length === 0) {
    return [];
  }

  const byNode = new Map<string, StatsNodeMesurement[]>();
  for (const stat of stats) {
    const group = byNode.get(stat.node);
    if (group) {
      group.push(stat);
    } else {
      byNode.set(stat.node, [stat]);
    }
  }

  const result: StatsNodeMesurement[] = [];
  for (const group of byNode.values()) {
    const sorted = [...group].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    if (sorted.length <= maxPoints) {
      result.push(...sorted);
      continue;
    }

    const bucketCount = Math.ceil(sorted.length / maxPoints);
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      const start = Math.floor((bucket * sorted.length) / bucketCount);
      const end = Math.floor(((bucket + 1) * sorted.length) / bucketCount);
      const slice = sorted.slice(start, end);
      if (slice.length === 0) {
        continue;
      }
      const last = slice[slice.length - 1];
      const cpuValues = slice
        .map((stat) => stat.cpuUsage)
        .filter((value) => value !== null && value !== undefined);
      const memoryValues = slice
        .map((stat) => stat.memoryUsage)
        .filter((value) => value !== null && value !== undefined);
      result.push(
        new StatsNodeMesurement({
          node: last.node,
          cpuUsage: cpuValues.length
            ? cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length
            : null,
          memoryUsage: memoryValues.length
            ? memoryValues.reduce((sum, value) => sum + value, 0) /
              memoryValues.length
            : null,
          pods: last.pods,
          timestamp: last.timestamp,
          podRestarts: last.podRestarts,
        }),
      );
    }
  }
  return result;
}
