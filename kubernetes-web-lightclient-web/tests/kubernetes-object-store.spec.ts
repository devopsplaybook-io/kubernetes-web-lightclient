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
