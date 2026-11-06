import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FilterKubernetesItems,
  GetKeywordIndex,
  ParseKeywords,
} from "~~/services/KeywordFilter";

const items = [
  { metadata: { name: "web-1", namespace: "prod" }, kind: "Pod" },
  { metadata: { name: "api-1", namespace: "prod" }, kind: "Deployment" },
  { metadata: { name: "web-2", namespace: "dev" }, kind: "Pod" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ParseKeywords", () => {
  it("lowercases, trims and splits on whitespace", () => {
    expect(ParseKeywords("  Web   Pod ")).toEqual(["web", "pod"]);
  });

  it("returns no keyword for empty values", () => {
    expect(ParseKeywords("")).toEqual([]);
    expect(ParseKeywords("   ")).toEqual([]);
    expect(ParseKeywords(null)).toEqual([]);
    expect(ParseKeywords(undefined)).toEqual([]);
  });
});

describe("GetKeywordIndex", () => {
  it("builds the index once per array reference", () => {
    const list = [{ metadata: { name: "a" } }, { metadata: { name: "b" } }];
    const stringifySpy = vi.spyOn(JSON, "stringify");

    const first = GetKeywordIndex(list);
    expect(stringifySpy).toHaveBeenCalledTimes(2);
    expect(first).toHaveLength(2);

    stringifySpy.mockClear();
    const second = GetKeywordIndex(list);
    expect(stringifySpy).not.toHaveBeenCalled();
    expect(second).toBe(first);
  });

  it("rebuilds the index after the list is replaced (refresh)", () => {
    const firstList = [{ metadata: { name: "a" } }];
    GetKeywordIndex(firstList);
    const refreshedList = [{ metadata: { name: "a" } }];

    const spy = vi.spyOn(JSON, "stringify");
    GetKeywordIndex(refreshedList);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("FilterKubernetesItems", () => {
  it("returns a new array with every item when nothing is filtered", () => {
    const result = FilterKubernetesItems(items, "", []);
    expect(result).toHaveLength(3);
    expect(result).not.toBe(items);
  });

  it("filters by namespace", () => {
    const result = FilterKubernetesItems(items, "prod", []);
    expect(result.map((item) => item.metadata.name)).toEqual([
      "web-1",
      "api-1",
    ]);
  });

  it("AND-composes keywords over the serialized item", () => {
    expect(
      FilterKubernetesItems(items, "", ["web", "pod"]).map(
        (item) => item.metadata.name,
      ),
    ).toEqual(["web-1", "web-2"]);
    expect(
      FilterKubernetesItems(items, "dev", ["web"]).map(
        (item) => item.metadata.name,
      ),
    ).toEqual(["web-2"]);
  });
});
