import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";

const storeState = vi.hoisted(() => ({
  dataFull: {} as Record<string, any[]>,
  selectedTypes: [] as string[],
  loadSelectedTypes: vi.fn(async () => {}),
}));

vi.mock("~~/stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => storeState,
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: { getAuthHeader: async () => ({ headers: {} }) },
}));

vi.mock("~~/services/Utils", () => ({
  UtilsDecompressData: vi.fn(async (value: string) => value),
}));

vi.mock("~~/services/ResourceService", () => ({
  ResourceService: {
    getDataUrl: vi.fn(
      async (type: string) => `http://server.test/api/resources/data/${type}`,
    ),
  },
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    isAxiosError: (error: any) => !!error?.isAxiosError,
  },
}));

import {
  ClearSearchCache,
  LoadTypeItems,
  LoadTypesIncrementally,
  OrderTypesForSearch,
  SEARCH_CACHE_TTL_MS,
  SearchLoadError,
} from "../services/GlobalSearchService";

const getMock = axios.get as unknown as ReturnType<typeof vi.fn>;

function compressedItems(items: any[]) {
  return { data: { data: JSON.stringify({ items }) } };
}

function axiosError(status: number): unknown {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: {} },
  });
}

const TYPES = [
  { id: "pod", name: "Pod" },
  { id: "service", name: "Service" },
  { id: "deployment", name: "Deployment" },
];

beforeEach(() => {
  ClearSearchCache();
  getMock.mockReset();
  storeState.dataFull = {};
  storeState.selectedTypes = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LoadTypeItems", () => {
  it("seeds from the object store without an HTTP request", async () => {
    const items = [{ metadata: { name: "cached" } }];
    storeState.dataFull.pod = items;

    await expect(LoadTypeItems("pod")).resolves.toBe(items);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("fetches the cached list endpoint and parses the payload", async () => {
    const items = [{ metadata: { name: "web-1" } }];
    getMock.mockResolvedValue(compressedItems(items));

    await expect(LoadTypeItems("pod")).resolves.toEqual(items);
    expect(getMock).toHaveBeenCalledWith(
      "http://server.test/api/resources/data/pod",
      { headers: {} },
    );
  });

  it("deduplicates concurrent loads of the same type", async () => {
    let resolveRequest: (value: any) => void = () => {};
    getMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const first = LoadTypeItems("pod");
    const second = LoadTypeItems("pod");
    resolveRequest(compressedItems([{ metadata: { name: "web" } }]));

    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after the cache TTL", async () => {
    vi.useFakeTimers();
    getMock.mockResolvedValue(compressedItems([{ metadata: { name: "a" } }]));

    await LoadTypeItems("pod");
    await LoadTypeItems("pod");
    expect(getMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + SEARCH_CACHE_TTL_MS + 1);
    await LoadTypeItems("pod");
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on 429 and otherwise marks the type as busy", async () => {
    vi.useFakeTimers();
    const items = [{ metadata: { name: "web" } }];
    getMock
      .mockRejectedValueOnce(axiosError(429))
      .mockResolvedValueOnce(compressedItems(items));

    const request = LoadTypeItems("pod", { force: true });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(request).resolves.toEqual(items);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("reports a busy SearchLoadError when the retry also returns 429", async () => {
    vi.useFakeTimers();
    getMock
      .mockRejectedValueOnce(axiosError(429))
      .mockRejectedValueOnce(axiosError(429));

    const request = LoadTypeItems("pod", { force: true });
    const assertion = expect(request).rejects.toBeInstanceOf(SearchLoadError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("wraps other failures in a SearchLoadError", async () => {
    getMock.mockRejectedValue(axiosError(500));
    await expect(LoadTypeItems("pod")).rejects.toBeInstanceOf(SearchLoadError);
  });
});

describe("OrderTypesForSearch", () => {
  it("keeps only the selected types and puts store-loaded types first", () => {
    storeState.dataFull.service = [];
    const ordered = OrderTypesForSearch(TYPES, ["pod", "service"]);
    expect(ordered.map((type) => type.id)).toEqual(["service", "pod"]);
  });

  it("orders the remaining types by the built-in priority", () => {
    const ordered = OrderTypesForSearch(TYPES);
    expect(ordered.map((type) => type.id)).toEqual([
      "pod",
      "deployment",
      "service",
    ]);
  });
});

describe("LoadTypesIncrementally", () => {
  it("reports every loaded type and every failure", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/service")) {
        throw axiosError(500);
      }
      return compressedItems([{ metadata: { name: "web" } }]);
    });
    const loaded: string[] = [];
    const failed: string[] = [];

    await LoadTypesIncrementally(
      TYPES,
      (type) => loaded.push(type.id),
      (type) => failed.push(type.id),
      { selectedIds: ["pod", "service"], concurrency: 2 },
    );

    expect(loaded).toEqual(["pod"]);
    expect(failed).toEqual(["service"]);
  });
});
