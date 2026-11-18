/**
 * I/O for the global search palette. Items come from the existing cached
 * list endpoint (`GET /api/resources/data/:type`) or from the object store
 * already loaded by the current list; no kubectl command is issued here.
 * Loads are lazy, deduplicated, briefly cached and bounded in concurrency so
 * a palette search cannot flood the server's request queue.
 */
import axios from "axios";
import { AuthService } from "~~/services/AuthService";
import { ResourceService } from "~~/services/ResourceService";
import { UtilsDecompressData } from "~~/services/Utils";
import { KubernetesObjectStore } from "~~/stores/KubernetesObjectStore";
import type { ResourceTypeLike } from "~~/services/ObjectLinks";

export const SEARCH_CACHE_TTL_MS = 30000;
export const SEARCH_LOAD_CONCURRENCY = 2;

const SEARCH_TYPE_PRIORITY = [
  "pod",
  "deployment",
  "statefulset",
  "daemonset",
  "job",
  "cronjob",
  "replicaset",
  "service",
  "ingress",
  "configmap",
  "secret",
  "pvc",
  "serviceaccount",
  "node",
  "namespace",
  "events",
  "hpa",
  "pdb",
  "networkpolicy",
  "storageclass",
  "role",
  "rolebinding",
  "clusterrole",
  "clusterrolebinding",
  "customresourcedefinition",
];

interface CacheEntry {
  items: any[];
  loadedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<any[]>>();

export class SearchLoadError extends Error {
  busy: boolean;

  constructor(message: string, busy: boolean) {
    super(message);
    this.name = "SearchLoadError";
    this.busy = busy;
  }
}

export function ClearSearchCache(): void {
  cache.clear();
}

function Delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Items already loaded by the object store for that type, if any. */
export function StoreItemsFor(typeId: string): any[] | null {
  try {
    const store = KubernetesObjectStore();
    const items = store?.dataFull?.[typeId];
    return Array.isArray(items) ? items : null;
  } catch {
    return null;
  }
}

async function FetchTypeItems(typeId: string): Promise<any[]> {
  const url = await ResourceService.getDataUrl(typeId);
  const response = await axios.get(url, await AuthService.getAuthHeader());
  const parsed = JSON.parse(await UtilsDecompressData(response.data.data));
  return Array.isArray(parsed?.items) ? parsed.items : [];
}

function ToSearchLoadError(error: unknown): SearchLoadError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 429) {
      return new SearchLoadError("Server is busy, please retry in a moment.", true);
    }
    const serverMessage = (error.response?.data as { error?: string })?.error;
    if (status === 400 && serverMessage) {
      return new SearchLoadError(serverMessage, false);
    }
  }
  return new SearchLoadError("Failed to load this resource type.", false);
}

async function FetchWithRetry(typeId: string): Promise<any[]> {
  try {
    return await FetchTypeItems(typeId);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      // A single bounded retry keeps the palette usable when the server
      // queue is briefly saturated without turning into a poll loop.
      await Delay(1000);
      try {
        return await FetchTypeItems(typeId);
      } catch (retryError) {
        throw ToSearchLoadError(retryError);
      }
    }
    throw ToSearchLoadError(error);
  }
}

export interface LoadTypeOptions {
  force?: boolean;
  ttlMs?: number;
}

export async function LoadTypeItems(
  typeId: string,
  options: LoadTypeOptions = {},
): Promise<any[]> {
  const ttl = options.ttlMs ?? SEARCH_CACHE_TTL_MS;
  const cached = cache.get(typeId);
  if (cached && Date.now() - cached.loadedAt < ttl) {
    return cached.items;
  }
  const pending = inFlight.get(typeId);
  if (pending) {
    return pending;
  }
  if (!options.force) {
    const seeded = StoreItemsFor(typeId);
    if (seeded) {
      cache.set(typeId, { items: seeded, loadedAt: Date.now() });
      return seeded;
    }
  }
  const request = FetchWithRetry(typeId)
    .then((items) => {
      cache.set(typeId, { items, loadedAt: Date.now() });
      return items;
    })
    .finally(() => {
      inFlight.delete(typeId);
    });
  inFlight.set(typeId, request);
  return request;
}

/**
 * The types the palette searches, in priority order: types already loaded in
 * the store first, then the common built-ins, then remaining types (CRDs).
 */
export function OrderTypesForSearch(
  types: ResourceTypeLike[],
  selectedIds: string[] | null = null,
): ResourceTypeLike[] {
  const selected = selectedIds
    ? (types || []).filter((type) => selectedIds.includes(type.id))
    : types || [];
  let store: { dataFull?: Record<string, any[]> } | null = null;
  try {
    store = KubernetesObjectStore();
  } catch {
    store = null;
  }
  const priority = (type: ResourceTypeLike) => {
    const index = SEARCH_TYPE_PRIORITY.indexOf(type.id);
    return index === -1 ? SEARCH_TYPE_PRIORITY.length : index;
  };
  const storeLoaded = (type: ResourceTypeLike) =>
    Array.isArray(store?.dataFull?.[type.id]) ? 0 : 1;
  return [...selected].sort((a, b) => {
    const byStore = storeLoaded(a) - storeLoaded(b);
    if (byStore !== 0) {
      return byStore;
    }
    const byPriority = priority(a) - priority(b);
    if (byPriority !== 0) {
      return byPriority;
    }
    return String(a.name).localeCompare(String(b.name));
  });
}

async function RunWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const index = next++;
        await tasks[index]();
      }
    },
  );
  await Promise.all(workers);
}

export interface LoadTypesOptions extends LoadTypeOptions {
  selectedIds?: string[] | null;
  concurrency?: number;
}

/**
 * Load every type in priority order (bounded concurrency) and report each
 * result as soon as it is available so the palette can render incrementally.
 * Never throws: failures are reported per type.
 */
export async function LoadTypesIncrementally(
  types: ResourceTypeLike[],
  onTypeLoaded: (type: ResourceTypeLike, items: any[]) => void,
  onTypeError: (type: ResourceTypeLike, error: SearchLoadError) => void,
  options: LoadTypesOptions = {},
): Promise<void> {
  const ordered = OrderTypesForSearch(types, options.selectedIds ?? null);
  const tasks = ordered.map((type) => async () => {
    try {
      const items = await LoadTypeItems(type.id, options);
      onTypeLoaded(type, items);
    } catch (error) {
      onTypeError(
        type,
        error instanceof SearchLoadError
          ? error
          : new SearchLoadError("Failed to load this resource type.", false),
      );
    }
  });
  await RunWithConcurrency(tasks, options.concurrency ?? SEARCH_LOAD_CONCURRENCY);
}
