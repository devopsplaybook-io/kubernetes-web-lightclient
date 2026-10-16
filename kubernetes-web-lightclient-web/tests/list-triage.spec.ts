import { describe, expect, it, vi } from "vitest";
import {
  applyListFilters,
  createEventFilters,
  createPodFilters,
  sortListItems,
  type ListFilterDef,
  type ListSortState,
} from "~~/services/ListTriage";

vi.mock("~~/stores/KubernetesObjectStore", () => ({
  KubernetesObjectStore: () => ({}),
}));

function makePod(overrides: Record<string, any> = {}): any {
  return {
    metadata: { name: "pod-1", namespace: "default", creationTimestamp: "2026-10-15T00:00:00Z" },
    status: {
      phase: "Running",
      containerStatuses: [{ ready: true, restartCount: 0 }],
    },
    ...overrides,
  };
}

describe("sortListItems", () => {
  const accessors = {
    name: (item: any) => item.name,
    age: (item: any) => item.creationTimestamp,
    count: (item: any) => item.count,
  };

  it("sorts strings ascending and descending", () => {
    const items = [{ name: "c" }, { name: "a" }, { name: "b" }];
    const asc: ListSortState = { sortBy: "name", sortDir: "asc" };
    const desc: ListSortState = { sortBy: "name", sortDir: "desc" };

    expect(sortListItems(items, asc, accessors).map((i) => i.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortListItems(items, desc, accessors).map((i) => i.name)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("sorts numbers numerically", () => {
    const items = [{ count: 10 }, { count: 2 }, { count: 33 }];
    const asc: ListSortState = { sortBy: "count", sortDir: "asc" };

    expect(sortListItems(items, asc, accessors).map((i) => i.count)).toEqual([
      2, 10, 33,
    ]);
  });

  it("compares ISO date strings chronologically", () => {
    const items = [
      { creationTimestamp: "2026-10-16T00:00:00Z" },
      { creationTimestamp: "2026-09-01T00:00:00Z" },
      { creationTimestamp: "2026-10-15T00:00:00Z" },
    ];
    const asc: ListSortState = { sortBy: "age", sortDir: "asc" };

    expect(sortListItems(items, asc, accessors).map((i) => i.creationTimestamp)).toEqual([
      "2026-09-01T00:00:00Z",
      "2026-10-15T00:00:00Z",
      "2026-10-16T00:00:00Z",
    ]);
  });

  it("is stable for equal keys", () => {
    const items = [
      { name: "a", count: 1 },
      { name: "b", count: 1 },
      { name: "c", count: 0 },
    ];
    const asc: ListSortState = { sortBy: "count", sortDir: "asc" };

    expect(sortListItems(items, asc, accessors).map((i) => i.name)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("returns the items unchanged without a sort state or an unknown key", () => {
    const items = [{ name: "b" }, { name: "a" }];

    expect(sortListItems(items, null, accessors)).toEqual(items);
    expect(
      sortListItems(items, { sortBy: "unknown", sortDir: "asc" }, accessors),
    ).toEqual(items);
  });

  it("does not mutate the input array", () => {
    const items = [{ name: "b" }, { name: "a" }];
    sortListItems(items, { sortBy: "name", sortDir: "asc" }, accessors);

    expect(items.map((i) => i.name)).toEqual(["b", "a"]);
  });
});

describe("applyListFilters", () => {
  const filterDefs: ListFilterDef[] = [
    { id: "even", label: "Even", predicate: (n: any) => n.value % 2 === 0 },
    { id: "big", label: "Big", predicate: (n: any) => n.value > 10 },
  ];

  it("returns the items unchanged when no filter is active", () => {
    const items = [{ value: 2 }, { value: 3 }];

    expect(applyListFilters(items, [], filterDefs)).toEqual(items);
  });

  it("applies a single filter", () => {
    const items = [{ value: 2 }, { value: 3 }, { value: 4 }];

    expect(
      applyListFilters(items, ["even"], filterDefs).map((i) => i.value),
    ).toEqual([2, 4]);
  });

  it("composes active filters with AND", () => {
    const items = [{ value: 2 }, { value: 12 }, { value: 15 }];

    expect(
      applyListFilters(items, ["even", "big"], filterDefs).map((i) => i.value),
    ).toEqual([12]);
  });

  it("ignores active ids without a matching filter def", () => {
    const items = [{ value: 2 }, { value: 3 }];

    expect(
      applyListFilters(items, ["even", "ghost"], filterDefs).map((i) => i.value),
    ).toEqual([2]);
  });
});

describe("createPodFilters", () => {
  const notReady = createPodFilters().find((f) => f.id === "not-ready")!;
  const restarts = createPodFilters().find((f) => f.id === "restarts")!;

  it("matches pods with fewer ready containers than total", () => {
    expect(
      notReady.predicate(
        makePod({
          status: {
            phase: "Running",
            containerStatuses: [
              { ready: true, restartCount: 0 },
              { ready: false, restartCount: 4 },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not match fully ready pods", () => {
    expect(notReady.predicate(makePod())).toBe(false);
  });

  it("matches pods without container statuses that are not Running or Succeeded", () => {
    expect(
      notReady.predicate(makePod({ status: { phase: "Pending" } })),
    ).toBe(true);
    expect(
      notReady.predicate(makePod({ status: { phase: "Running" } })),
    ).toBe(false);
    expect(
      notReady.predicate(makePod({ status: { phase: "Succeeded" } })),
    ).toBe(false);
  });

  it("matches pods with restarts greater than zero", () => {
    expect(
      restarts.predicate(
        makePod({
          status: {
            phase: "Running",
            containerStatuses: [
              { ready: true, restartCount: 2 },
              { ready: true, restartCount: 0 },
            ],
          },
        }),
      ),
    ).toBe(true);
    expect(restarts.predicate(makePod())).toBe(false);
  });
});

describe("createEventFilters", () => {
  const warnings = createEventFilters().find((f) => f.id === "warnings")!;

  it("matches only Warning events", () => {
    expect(warnings.predicate({ type: "Warning" })).toBe(true);
    expect(warnings.predicate({ type: "Normal" })).toBe(false);
  });
});
