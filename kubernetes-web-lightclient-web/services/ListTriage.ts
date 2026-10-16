/**
 * Pure client-side list triage helpers: sorting and quick filters applied on
 * top of the store's keyword/namespace filtering. No side effects, no server
 * calls — everything here is unit-testable in isolation.
 */
import { getPodRestartCount } from "~~/services/KubernetesUtils";

export interface ListSortState {
  sortBy: string;
  sortDir: "asc" | "desc";
}

export interface ListFilterDef<T = any> {
  id: string;
  label: string;
  predicate: (item: T) => boolean;
}

export interface ListPreference {
  sortBy?: string;
  sortDir?: "asc" | "desc";
  filters?: string[];
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Returns a sorted copy of the items. Stable for equal keys, and returns the
 * items unchanged when there is no active sort or the sort key is unknown.
 * String dates (ISO timestamps) compare chronologically.
 */
export function sortListItems<T>(
  items: T[],
  sortState: ListSortState | null | undefined,
  accessors: Record<string, (item: T) => unknown>,
): T[] {
  if (!sortState || !accessors[sortState.sortBy]) {
    return items;
  }
  const accessor = accessors[sortState.sortBy];
  const direction = sortState.sortDir === "desc" ? -1 : 1;
  return [...items].sort(
    (a, b) => direction * compareValues(accessor(a), accessor(b)),
  );
}

/**
 * Returns the items kept by every active filter (AND composition). Items are
 * returned unchanged when no filter is active.
 */
export function applyListFilters<T>(
  items: T[],
  activeFilterIds: string[],
  filterDefs: ListFilterDef<T>[],
): T[] {
  const active = filterDefs.filter((def) =>
    activeFilterIds.includes(def.id),
  );
  if (active.length === 0) {
    return items;
  }
  return items.filter((item) => active.every((def) => def.predicate(item)));
}

function isPodFullyReady(pod: any): boolean {
  const statuses = pod.status?.containerStatuses || [];
  if (statuses.length === 0) {
    // Pods without container statuses (e.g. pending scheduling) are only
    // considered fine once they reached a terminal/running phase
    const phase = pod.status?.phase || "";
    return phase === "Running" || phase === "Succeeded";
  }
  return statuses.every((s) => s.ready);
}

export function createPodFilters(): ListFilterDef[] {
  return [
    {
      id: "not-ready",
      label: "Not ready",
      predicate: (pod: any) => !isPodFullyReady(pod),
    },
    {
      id: "restarts",
      label: "Restarts > 0",
      predicate: (pod: any) => getPodRestartCount(pod) > 0,
    },
  ];
}

export function createEventFilters(): ListFilterDef[] {
  return [
    {
      id: "warnings",
      label: "Warnings only",
      predicate: (event: any) => event.type === "Warning",
    },
  ];
}
