/** Lower-case, accent-free, single-spaced text for matching (Latin and Cyrillic). */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const isBoundary = (ch: string | undefined) => ch === undefined || /[\s\-_/.(,:—]/.test(ch);

/**
 * Relevance of `text` for an already-normalized `query` (0 = no match).
 * Substring matches score highest (prefix / word start > inside a word, shorter texts first);
 * otherwise a compact subsequence ("bktst" → "backtesting") scores lower.
 */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const t = normalize(text);
  if (!t) return 0;
  const i = t.indexOf(query);
  if (i >= 0) {
    let s = 1000 - Math.min(i, 200) * 2 - Math.min(t.length - query.length, 200);
    if (i === 0) s += 300;
    else if (isBoundary(t[i - 1])) s += 150;
    return s;
  }
  if (query.length < 2) return 0;
  // subsequence: every query char in order, within a compact span
  let from = 0;
  let first = -1;
  let gaps = 0;
  for (const ch of query) {
    if (ch === " ") continue;
    const f = t.indexOf(ch, from);
    if (f < 0) return 0;
    if (first < 0) first = f;
    else gaps += f - from;
    from = f + 1;
  }
  const span = from - first;
  if (span > query.length * 3 + 2) return 0;
  return Math.max(1, 400 - gaps * 12 - first * 2 + (isBoundary(t[first - 1]) ? 60 : 0));
}

/** Best score of `query` over several fields, each with a weight. */
export function bestScore(query: string, fields: [string | undefined | null, number][]): number {
  let best = 0;
  for (const [text, w] of fields) {
    if (!text) continue;
    const s = fuzzyScore(query, text) * w;
    if (s > best) best = s;
  }
  return best;
}
