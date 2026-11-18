import { describe, expect, it } from "vitest";
import {
  EscapeHtml,
  FilterLogLines,
  HighlightLogLine,
} from "../services/LogFilter";

const TEXT = "INFO started\nERROR boom\nwarn slow";

describe("FilterLogLines", () => {
  it("returns every line without a query", () => {
    expect(
      FilterLogLines(TEXT, { query: "", mode: "text", caseSensitive: false }),
    ).toEqual({
      error: "",
      lines: ["INFO started", "ERROR boom", "warn slow"],
      matched: 3,
      total: 3,
    });
  });

  it("filters by substring, case-insensitively by default", () => {
    expect(
      FilterLogLines(TEXT, {
        query: "error",
        mode: "text",
        caseSensitive: false,
      }),
    ).toMatchObject({ lines: ["ERROR boom"], matched: 1, total: 3 });
  });

  it("respects case sensitivity", () => {
    expect(
      FilterLogLines(TEXT, {
        query: "error",
        mode: "text",
        caseSensitive: true,
      }).matched,
    ).toBe(0);
  });

  it("treats the query literally in text mode", () => {
    expect(
      FilterLogLines("a.b\naxb", {
        query: "a.b",
        mode: "text",
        caseSensitive: true,
      }).lines,
    ).toEqual(["a.b"]);
  });

  it("filters with a regular expression in regex mode", () => {
    expect(
      FilterLogLines(TEXT, {
        query: "^(INFO|warn)",
        mode: "regex",
        caseSensitive: true,
      }).lines,
    ).toEqual(["INFO started", "warn slow"]);
  });

  it("reports an invalid regular expression without hiding the logs", () => {
    const result = FilterLogLines(TEXT, {
      query: "([",
      mode: "regex",
      caseSensitive: false,
    });
    expect(result.error).toContain("Invalid regular expression");
    expect(result.lines).toHaveLength(3);
  });

  it("returns no lines for empty log text", () => {
    expect(
      FilterLogLines("", { query: "", mode: "text", caseSensitive: false }),
    ).toEqual({ error: "", lines: [], matched: 0, total: 0 });
  });
});

describe("HighlightLogLine", () => {
  it("escapes HTML and marks the matches", () => {
    expect(
      HighlightLogLine("ERROR <b>bad</b>", {
        query: "error",
        mode: "text",
        caseSensitive: false,
      }),
    ).toBe("<mark>ERROR</mark> &lt;b&gt;bad&lt;/b&gt;");
  });

  it("marks every occurrence", () => {
    expect(
      HighlightLogLine("boom boom", {
        query: "boom",
        mode: "text",
        caseSensitive: true,
      }),
    ).toBe("<mark>boom</mark> <mark>boom</mark>");
  });

  it("escapes a query that is itself markup", () => {
    expect(
      HighlightLogLine("a < b", {
        query: "<",
        mode: "text",
        caseSensitive: true,
      }),
    ).toBe("a <mark>&lt;</mark> b");
  });

  it("escapes the line when there is no query or the regex is invalid", () => {
    expect(
      HighlightLogLine("<img src=x>", {
        query: "",
        mode: "text",
        caseSensitive: false,
      }),
    ).toBe("&lt;img src=x&gt;");
    expect(
      HighlightLogLine("<img src=x>", {
        query: "([",
        mode: "regex",
        caseSensitive: false,
      }),
    ).toBe("&lt;img src=x&gt;");
  });

  it("does not wrap zero-length matches", () => {
    expect(
      HighlightLogLine("", { query: ".*", mode: "regex", caseSensitive: false }),
    ).toBe("");
  });
});

describe("EscapeHtml", () => {
  it("escapes all significant HTML characters", () => {
    expect(EscapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
