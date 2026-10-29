/**
 * Matching and ranking for the search palette (Ctrl+K). Pure, tested in tests/search.test.ts.
 * Every word of the query has to match the title or one of the extra texts (subject, description, steps, room,
 * dates); hits in the title rank higher, at a word start higher still, and a title that starts with a word highest.
 * Case and accents are ignored, and numbers match without leading zeros ("sheet 3" finds "Sheet 03").
 */

export type SearchKind = 'view' | 'subject' | 'exercise' | 'lecture' | 'exam' | 'break';

export interface SearchEntry<T = unknown> {
  kind: SearchKind;
  /** Unique across all entries (React key). */
  key: string;
  title: string;
  /** Also searched, ranked below the title. */
  extra: string[];
  /** Tie-breaker between equal scores: lower first (e.g. days away from today). */
  order?: number;
  item: T;
}

/** Shown when the query is empty. */
const EMPTY_QUERY_KINDS: SearchKind[] = ['view', 'subject'];
const MAX_RESULTS = 40;

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function words(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const isNumber = (s: string) => /^\d+$/.test(s);
const unpadded = (s: string) => s.replace(/^0+(?=\d)/, '');

/** `word` begins with `token`. A number only matches the same number, also without leading zeros ("3" matches "03", not "13" or "30"). */
function begins(word: string, token: string): boolean {
  if (isNumber(token)) return isNumber(word) && unpadded(word) === unpadded(token);
  return word.startsWith(token);
}

/** How well `entry` matches the (normalized) query words, or null when one of them matches nowhere. */
export function score(entry: Pick<SearchEntry, 'title' | 'extra'>, tokens: string[]): number | null {
  const title = normalize(entry.title);
  const titleWords = words(title);
  const extra = normalize(entry.extra.join(' · '));
  const extraWords = words(extra);
  let total = 0;
  for (const t of tokens) {
    // Numbers only as whole words: "3" is in "Sheet 03" but not in "13:15".
    const inside = (text: string) => !isNumber(t) && text.includes(t);
    if (!isNumber(t) && title.startsWith(t)) total += 30;
    else if (titleWords.some((w) => begins(w, t))) total += 20;
    else if (inside(title)) total += 10;
    else if (extraWords.some((w) => begins(w, t))) total += 4;
    else if (inside(extra)) total += 2;
    else return null;
  }
  if (title === tokens.join(' ')) total += 50;
  return total;
}

/** The entries matching `query`, best first (empty query: the views and subjects, in their order). */
export function search<T>(entries: SearchEntry<T>[], query: string): SearchEntry<T>[] {
  const tokens = words(normalize(query));
  if (tokens.length === 0) return entries.filter((e) => EMPTY_QUERY_KINDS.includes(e.kind));
  return entries
    .map((entry, index) => ({ entry, index, score: score(entry, tokens) }))
    .filter((r): r is typeof r & { score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || (a.entry.order ?? 0) - (b.entry.order ?? 0) || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map((r) => r.entry);
}

/** Results grouped by kind; groups in the order of their best result. */
export function groupResults<T>(results: SearchEntry<T>[]): { kind: SearchKind; entries: SearchEntry<T>[] }[] {
  const groups: { kind: SearchKind; entries: SearchEntry<T>[] }[] = [];
  for (const r of results) {
    const g = groups.find((x) => x.kind === r.kind);
    if (g) g.entries.push(r);
    else groups.push({ kind: r.kind, entries: [r] });
  }
  return groups;
}
