/**
 * Log line filtering for the log dialog. Plain substring matching stays the
 * default; regex filtering and case sensitivity are opt-in. Highlighting is
 * produced only from HTML-escaped text so a log line (or a filter) can never
 * inject markup into the dialog.
 */

export type LogFilterMode = "text" | "regex";

export interface LogFilterOptions {
  query: string;
  mode: LogFilterMode;
  caseSensitive: boolean;
}

export interface LogFilterResult {
  error: string;
  lines: string[];
  matched: number;
  total: number;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function EscapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function EscapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function BuildMatcher(options: LogFilterOptions): RegExp | null {
  if (!options.query) {
    return null;
  }
  const flags = options.caseSensitive ? "g" : "gi";
  const source =
    options.mode === "regex" ? options.query : EscapeRegExp(options.query);
  return new RegExp(source, flags);
}

export function FilterLogLines(
  text: string,
  options: LogFilterOptions,
): LogFilterResult {
  const lines = text === "" ? [] : text.split("\n");
  const total = lines.length;
  if (!options.query) {
    return { error: "", lines, matched: total, total };
  }
  let matcher: RegExp;
  try {
    matcher = BuildMatcher(options) as RegExp;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `Invalid regular expression: ${error.message}`
          : "Invalid regular expression",
      lines,
      matched: total,
      total,
    };
  }
  const filtered = lines.filter((line) => {
    matcher.lastIndex = 0;
    return matcher.test(line);
  });
  return { error: "", lines: filtered, matched: filtered.length, total };
}

function HighlightWithMatcher(line: string, matcher: RegExp): string {
  let html = "";
  let lastIndex = 0;
  matcher.lastIndex = 0;
  let match = matcher.exec(line);
  while (match && match[0] !== "") {
    html += EscapeHtml(line.slice(lastIndex, match.index));
    html += `<mark>${EscapeHtml(match[0])}</mark>`;
    lastIndex = match.index + match[0].length;
    match = matcher.exec(line);
  }
  if (lastIndex === 0) {
    return EscapeHtml(line);
  }
  html += EscapeHtml(line.slice(lastIndex));
  return html;
}

/**
 * Return the HTML for one log line with matches wrapped in <mark>. The input
 * is escaped before any markup is added, so the result is safe for v-html.
 */
export function HighlightLogLine(
  line: string,
  options: LogFilterOptions,
): string {
  if (!options.query) {
    return EscapeHtml(line);
  }
  let matcher: RegExp;
  try {
    matcher = BuildMatcher(options) as RegExp;
  } catch {
    return EscapeHtml(line);
  }
  return HighlightWithMatcher(line, matcher);
}
