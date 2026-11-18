import { describe, expect, it } from "vitest";
import {
  BuiltInKindToTypeId,
  DesiredListState,
  DetailsPath,
  DetailsQuery,
  FilteredListPath,
  FilteredListQuery,
  KindToTypeId,
  ParseListFilters,
} from "../services/ObjectLinks";

describe("DetailsQuery / DetailsPath", () => {
  it("builds a namespaced details deep link", () => {
    expect(DetailsQuery("pod", "default", "web-1")).toEqual({
      objectType: "pod",
      namespace: "default",
      dialog: "details",
      name: "web-1",
      dialogNamespace: "default",
    });
    expect(DetailsPath("pod", "default", "web-1")).toBe(
      "/kubernetes?objectType=pod&dialog=details&name=web-1&namespace=default&dialogNamespace=default",
    );
  });

  it("omits the namespace for cluster-scoped objects", () => {
    expect(DetailsQuery("node", "", "node-1")).toEqual({
      objectType: "node",
      dialog: "details",
      name: "node-1",
    });
    expect(DetailsPath("node", "", "node-1")).toBe(
      "/kubernetes?objectType=node&dialog=details&name=node-1",
    );
  });
});

describe("FilteredListQuery / FilteredListPath", () => {
  it("builds a namespaced filtered list link", () => {
    expect(FilteredListQuery("ping", "apps", "web-1")).toEqual({
      objectType: "ping",
      namespace: "apps",
      search: "web-1",
    });
  });

  it("omits empty namespace and search", () => {
    expect(FilteredListQuery("node", "", "")).toEqual({ objectType: "node" });
    expect(FilteredListPath("node", "", "")).toBe(
      "/kubernetes?objectType=node",
    );
  });

  it("encodes search values", () => {
    expect(FilteredListPath("pod", "default", "a b")).toContain(
      "search=a+b",
    );
  });

  it("adds comma-joined quick filters and omits them when empty", () => {
    expect(FilteredListQuery("pod", "", "", ["pending", "crashloop"])).toEqual({
      objectType: "pod",
      filter: "pending,crashloop",
    });
    expect(FilteredListQuery("pod", "", "")).toEqual({ objectType: "pod" });
    expect(FilteredListPath("pod", "", "", ["restarts"])).toBe(
      "/kubernetes?objectType=pod&filter=restarts",
    );
  });
});

describe("ParseListFilters", () => {
  const allowed = ["warnings", "pending", "not-running"];

  it("keeps allowed ids from a comma string and repeated values", () => {
    expect(ParseListFilters("pending,ghost", allowed)).toEqual(["pending"]);
    expect(ParseListFilters(["pending", "warnings"], allowed)).toEqual([
      "pending",
      "warnings",
    ]);
    expect(ParseListFilters("pending,warnings", allowed)).toEqual([
      "pending",
      "warnings",
    ]);
  });

  it("dedupes, trims and ignores junk values", () => {
    expect(ParseListFilters(" pending , pending ,warnings", allowed)).toEqual([
      "pending",
      "warnings",
    ]);
    expect(ParseListFilters(["pending", 42, null], allowed)).toEqual([
      "pending",
    ]);
    expect(ParseListFilters(undefined, allowed)).toEqual([]);
    expect(ParseListFilters("", allowed)).toEqual([]);
  });
});

describe("KindToTypeId", () => {
  const types = [
    { id: "pod", name: "Pod" },
    { id: "pings", name: "Ping (CRD)" },
    { id: "node", name: "Node" },
  ];

  it("maps built-in kinds", () => {
    expect(KindToTypeId("Pod", types)).toBe("pod");
    expect(KindToTypeId("Deployment", types)).toBe("deployment");
    expect(KindToTypeId("PersistentVolumeClaim", types)).toBe("pvc");
    expect(KindToTypeId("Event", types)).toBe("events");
  });

  it("maps a custom resource through the CRD display-name convention", () => {
    expect(KindToTypeId("Ping", types)).toBe("pings");
  });

  it("returns null for unknown or empty kinds", () => {
    expect(KindToTypeId("Unknown", types)).toBeNull();
    expect(KindToTypeId("", types)).toBeNull();
  });

  it("keeps the built-in map exhaustive for the documented kinds", () => {
    expect(Object.keys(BuiltInKindToTypeId)).toContain("Ingress");
    expect(BuiltInKindToTypeId.Service).toBe("service");
  });
});

describe("DesiredListState", () => {
  it("reads valid list parameters", () => {
    expect(
      DesiredListState({
        objectType: "deployment",
        namespace: "apps",
        search: "web",
      }),
    ).toEqual({ objectType: "deployment", namespace: "apps", search: "web" });
  });

  it("normalizes the all-namespace value and defaults", () => {
    expect(DesiredListState({ namespace: "*" })).toEqual({
      namespace: "*",
      search: "",
    });
    expect(DesiredListState({})).toEqual({ namespace: "*", search: "" });
    expect(DesiredListState(null)).toEqual({ namespace: "*", search: "" });
  });

  it("ignores junk values", () => {
    expect(
      DesiredListState({
        objectType: "../../etc",
        namespace: "Bad Namespace",
        search: 42,
      }),
    ).toEqual({ namespace: "*", search: "" });
  });
});
