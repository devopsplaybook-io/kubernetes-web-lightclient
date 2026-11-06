/**
 * Client-side keyword / namespace filtering with a per-list search index.
 *
 * The index is derived once per items array (i.e. once per refresh) and cached
 * by array reference, so filtering on every keystroke does not re-serialize
 * every item.
 */

const keywordIndexCache = new WeakMap<readonly object[], string[]>();

export function ParseKeywords(keyword: string | null | undefined): string[] {
  if (!keyword) {
    return [];
  }
  return keyword
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((part) => part.length > 0);
}

export function GetKeywordIndex(items: readonly any[]): string[] {
  const cached = keywordIndexCache.get(items);
  if (cached) {
    return cached;
  }
  const index = items.map((item) => JSON.stringify(item).trim().toLowerCase());
  keywordIndexCache.set(items, index);
  return index;
}

/**
 * Namespace and keyword filtering (keywords are AND-composed). Always returns
 * a new array; the items themselves are not modified.
 */
export function FilterKubernetesItems<T extends { metadata?: any }>(
  items: readonly T[],
  namespace: string,
  keywords: string[],
): T[] {
  const source = items || [];
  if (keywords.length === 0) {
    return source.filter(
      (item) => !namespace || item.metadata?.namespace === namespace,
    );
  }
  const index = GetKeywordIndex(source);
  const result: T[] = [];
  for (let i = 0; i < source.length; i++) {
    const item = source[i];
    if (namespace && item.metadata?.namespace !== namespace) {
      continue;
    }
    if (keywords.every((keyword) => index[i].includes(keyword))) {
      result.push(item);
    }
  }
  return result;
}
