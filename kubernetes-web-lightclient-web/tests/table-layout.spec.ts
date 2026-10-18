import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// jsdom tests cannot catch CSS layout regressions (cells wrapping and columns
// collapsing below 769px slipped through a fully green suite in release
// 0.43.0). These guards assert the source-level CSS invariants that keep list
// tables rendering as single-line, horizontally scrollable tables at every
// viewport width.

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("table layout guard", () => {
  const indexVue = readSource("../pages/kubernetes/index.vue");

  it("keeps #object-list table cells on a single line at every width", () => {
    expect(indexVue).toMatch(/#object-list td\s*\{\s*white-space:\s*nowrap;\s*\}/);
  });

  it("does not scope the nowrap rule to wide screens only", () => {
    // The 0.42.0 regression wrapped every cell below 769px, collapsing the
    // name column instead of overflowing into the scroll container.
    expect(indexVue).not.toMatch(/min-width:\s*769px/);
  });

  it("does not break names mid-word in list name columns", () => {
    // word-break: break-all collapses the name column min-content width,
    // which squeezes the table instead of letting it scroll horizontally.
    expect(readSource("../components/KubernetesPodList.vue")).not.toMatch(
      /word-break:\s*break-all/,
    );
    expect(readSource("../components/KubernetesObjectList.vue")).not.toMatch(
      /word-break:\s*break-all/,
    );
  });
});
