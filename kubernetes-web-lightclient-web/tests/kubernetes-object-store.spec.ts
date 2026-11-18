import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: { getAuthHeader: vi.fn(async () => ({})) },
}));

vi.mock("~~/services/Config", () => ({
  default: { get: vi.fn(async () => ({ SERVER_URL: "/api" })) },
}));

vi.mock("~~/services/ResourceService", () => ({
  ResourceService: {
    getDataUrl: vi.fn(),
    getUserSelections: vi.fn(async () => []),
  },
}));

vi.mock("~~/services/KubernetesUtils", () => ({
  handleStaleObjectError: vi.fn(async () => false),
}));

vi.mock("~/services/Utils", () => ({
  UtilsDecompressData: vi.fn(async (value: string) => value),
}));

import { KubernetesObjectStore } from "~~/stores/KubernetesObjectStore";
import { ResourceService } from "~~/services/ResourceService";
import axios from "axios";

function makePods() {
  return [
    {
      metadata: { name: "web-1", namespace: "prod" },
      status: { phase: "Running" },
    },
    {
      metadata: { name: "api-1", namespace: "prod" },
      status: { phase: "Running" },
    },
    {
      metadata: { name: "web-2", namespace: "dev" },
      status: { phase: "Running" },
    },
  ];
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("KubernetesObjectStore.applyFilter", () => {
  it("filters by keyword and namespace and mirrors the legacy key", async () => {
    const store = KubernetesObjectStore();
    store.dataFull.pod = makePods();
    store.filter.namespace = "prod";
    store.filter.keyword = "web";

    await store.applyFilter("pod");

    expect(store.data.pod.map((pod: any) => pod.metadata.name)).toEqual([
      "web-1",
    ]);
    expect(store.data.pods.map((pod: any) => pod.metadata.name)).toEqual([
      "web-1",
    ]);
  });

  it("returns every item when no filter is active", async () => {
    const store = KubernetesObjectStore();
    store.dataFull.pod = makePods();

    await store.applyFilter("pod");

    expect(store.data.pod).toHaveLength(3);
  });

  it("serializes each item only once across keyword changes on the same refresh", async () => {
    const store = KubernetesObjectStore();
    store.dataFull.pod = makePods();
    const stringifySpy = vi.spyOn(JSON, "stringify");

    store.filter.keyword = "web";
    await store.applyFilter("pod");
    expect(stringifySpy).toHaveBeenCalledTimes(3);

    store.filter.keyword = "api";
    await store.applyFilter("pod");
    expect(stringifySpy).toHaveBeenCalledTimes(3);

    expect(store.data.pod.map((pod: any) => pod.metadata.name)).toEqual([
      "api-1",
    ]);
    stringifySpy.mockRestore();
  });

  it("rebuilds the index after a refresh replaces the items array", async () => {
    const store = KubernetesObjectStore();
    store.dataFull.pod = makePods();
    store.filter.keyword = "web";
    await store.applyFilter("pod");

    store.dataFull.pod = makePods();
    const stringifySpy = vi.spyOn(JSON, "stringify");
    await store.applyFilter("pod");
    expect(stringifySpy).toHaveBeenCalledTimes(3);
    stringifySpy.mockRestore();
  });
});

describe("KubernetesObjectStore permission errors", () => {
  function forbidden(url: string): unknown {
    return {
      isAxiosError: true,
      message: "Request failed with status code 403",
      config: { url, data: {} },
      response: { status: 403, data: { error: "Forbidden" } },
    };
  }

  it("records the scope needed for the failed request only on a 403", () => {
    const store = KubernetesObjectStore();

    expect(store.recordPermissionError(forbidden("/api/kubectl/logs"))).toBe(
      true,
    );
    expect(store.permissionError).toBe("k8s:read");

    store.clearPermissionError();
    expect(store.permissionError).toBeNull();

    expect(store.recordPermissionError(new Error("network down"))).toBe(false);
    expect(store.permissionError).toBeNull();
  });

  it("maps list refresh 403s to the admin scope", () => {
    const store = KubernetesObjectStore();

    store.recordPermissionError(forbidden("/api/resources/refresh"));

    expect(store.permissionError).toBe("admin");
  });
});

describe("KubernetesObjectStore per-type loading state", () => {
  function forbidden(url: string): unknown {
    return {
      isAxiosError: true,
      message: "Request failed with status code 403",
      config: { url, data: {} },
      response: { status: 403, data: { error: "Forbidden" } },
    };
  }

  const axiosGet = axios.get as unknown as ReturnType<typeof vi.fn>;
  const getDataUrl = ResourceService.getDataUrl as unknown as ReturnType<
    typeof vi.fn
  >;

  function cachedResponse(items: any[]) {
    return { data: { data: JSON.stringify({ items }), status: "fresh" } };
  }

  beforeEach(() => {
    getDataUrl.mockResolvedValue("http://api/resources/data/pod");
  });

  it("sets and clears loadingTypes around a cached fetch", async () => {
    axiosGet.mockResolvedValue(cachedResponse([{ metadata: { name: "pod-a" } }]));
    const store = KubernetesObjectStore();

    const request = store.getObjectCached("pod");
    expect(store.loadingTypes.pod).toBe(true);

    await request;
    expect(store.loadingTypes.pod).toBe(false);
    expect(store.loadErrors.pod).toBeUndefined();
    expect(store.dataFull.pod).toHaveLength(1);
  });

  it("records a per-type load error and clears it after a successful fetch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    axiosGet.mockRejectedValueOnce(new Error("network down"));
    const store = KubernetesObjectStore();

    await store.getObjectCached("pod");

    expect(store.loadingTypes.pod).toBe(false);
    expect(store.loadErrors.pod).toBe("Could not load pod data.");

    axiosGet.mockResolvedValue(cachedResponse([]));
    await store.getObjectCached("pod");

    expect(store.loadErrors.pod).toBeUndefined();
  });

  it("records only the permission error on a 403", async () => {
    axiosGet.mockRejectedValueOnce(forbidden("/api/resources/data/pod"));
    const store = KubernetesObjectStore();

    await store.getObjectCached("pod");

    expect(store.permissionError).toBe("k8s:read");
    expect(store.loadErrors.pod).toBeUndefined();
    expect(store.loadingTypes.pod).toBe(false);
  });

  it("tracks loadingTypes for non-cached commands too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = KubernetesObjectStore();
    store.dataFull.pod = [];

    store.getObjectFull = vi.fn().mockRejectedValueOnce(new Error("boom"));
    store.getObject("pod", { command: "describe", argument: "pod-a" });
    expect(store.loadingTypes.pod).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.loadingTypes.pod).toBe(false);
    expect(store.loadErrors.pod).toBe("Could not load pod data.");
  });
});
