import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Render untrusted markdown (e.g. LLM output derived from cluster object
 * names) to sanitized HTML that is safe for v-html.
 */
export function renderSafeMarkdown(text: string): string {
  if (!text) return "";
  const html = marked.parse(text, { breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html);
}
