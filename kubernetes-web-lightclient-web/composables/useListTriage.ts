import { computed, ref, watch } from "vue";
import { ListPreferencesService } from "~~/services/ListPreferencesService";
import {
  applyListFilters,
  sortListItems,
  type ListFilterDef,
  type ListSortState,
} from "~~/services/ListTriage";

export interface UseListTriageOptions<T> {
  rawItems: () => T[];
  accessors: Record<string, (item: T) => unknown>;
  filterDefs?: ListFilterDef<T>[];
  // First-click sort direction per key, when "asc" is not the right default
  // (e.g. numeric columns like restarts sort descending first)
  defaultSortDirections?: Record<string, "asc" | "desc">;
  // Filters active before any preference was ever stored (e.g. the events
  // "Warnings only" default)
  initialFilters?: string[];
}

/**
 * Shared list triage state for one list component: client-side sorting and
 * quick filters on top of the raw (store-filtered) items, persisted per user
 * through ListPreferencesService.
 */
export function useListTriage<T>(
  typeId: string,
  options: UseListTriageOptions<T>,
) {
  const sortState = ref<ListSortState | null>(null);
  const activeFilters = ref<string[]>([]);
  let userInteracted = false;

  const filterDefs = options.filterDefs || [];

  function validFilterIds(filterIds: string[] | undefined): string[] {
    if (!filterIds) return [];
    return filterIds.filter((id) => filterDefs.some((def) => def.id === id));
  }

  function applyStoredPreference() {
    const preference = ListPreferencesService.get(typeId);
    if (preference.sortBy && options.accessors[preference.sortBy]) {
      sortState.value = {
        sortBy: preference.sortBy,
        sortDir: preference.sortDir === "desc" ? "desc" : "asc",
      };
    }
    if (Array.isArray(preference.filters)) {
      activeFilters.value = validFilterIds(preference.filters);
    }
  }

  applyStoredPreference();
  if (!Array.isArray(ListPreferencesService.get(typeId).filters)) {
    activeFilters.value = validFilterIds(options.initialFilters);
  }

  ListPreferencesService.ensureLoaded();

  watch(
    () => ListPreferencesService.isLoaded(),
    (loaded) => {
      if (loaded && !userInteracted) {
        applyStoredPreference();
      }
    },
  );

  function persist() {
    ListPreferencesService.set(typeId, {
      ...(sortState.value
        ? { sortBy: sortState.value.sortBy, sortDir: sortState.value.sortDir }
        : {}),
      filters: [...activeFilters.value],
    });
  }

  function onSortToggle(key: string) {
    if (!options.accessors[key]) {
      return;
    }
    userInteracted = true;
    const current = sortState.value;
    if (current && current.sortBy === key) {
      sortState.value = {
        sortBy: key,
        sortDir: current.sortDir === "asc" ? "desc" : "asc",
      };
    } else {
      const direction =
        options.defaultSortDirections?.[key] === "desc" ? "desc" : "asc";
      sortState.value = { sortBy: key, sortDir: direction };
    }
    persist();
  }

  function toggleFilter(id: string) {
    userInteracted = true;
    activeFilters.value = activeFilters.value.includes(id)
      ? activeFilters.value.filter((active) => active !== id)
      : [...activeFilters.value, id];
    persist();
  }

  function clearAll() {
    userInteracted = true;
    sortState.value = null;
    activeFilters.value = [];
    persist();
  }

  const visibleItems = computed(() => {
    const items = options.rawItems() || [];
    const filtered = applyListFilters(items, activeFilters.value, filterDefs);
    return sortListItems(filtered, sortState.value, options.accessors);
  });

  function sortArrow(key: string): string {
    if (!sortState.value || sortState.value.sortBy !== key) {
      return "";
    }
    return sortState.value.sortDir === "asc" ? "↑" : "↓";
  }

  function ariaSort(key: string): "ascending" | "descending" | "none" {
    if (!sortState.value || sortState.value.sortBy !== key) {
      return "none";
    }
    return sortState.value.sortDir === "asc" ? "ascending" : "descending";
  }

  return {
    visibleItems,
    sortState,
    onSortToggle,
    availableFilters: filterDefs,
    activeFilters,
    toggleFilter,
    clearAll,
    sortArrow,
    ariaSort,
  };
}
