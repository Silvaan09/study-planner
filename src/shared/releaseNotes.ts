/**
 * Release notes for the "What's new" dialog: the GitHub release text of a version (Markdown), or as a fallback its
 * CHANGELOG.md entry. Pure, tested in tests/release-notes.test.ts.
 */

/** Notes of one version as shown by the "What's new" dialog. */
export interface ReleaseNotes {
  version: string;
  /** Markdown. */
  notes: string;
  /** Where the text came from: the GitHub release, or the CHANGELOG.md entry bundled with the app. */
  source: 'github' | 'changelog';
  /** The release's page on GitHub. */
  url: string;
}

/** The body of the CHANGELOG.md entry "## <version> — <date>" (up to the next "## "), or null. */
export function changelogEntry(changelog: string, version: string): string | null {
  const lines = changelog.replace(/\r\n?/g, '\n').split('\n');
  const head = new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  const body = rest.slice(0, end < 0 ? undefined : end).join('\n').trim();
  return body || null;
}

/** Changelog points about the project rather than the app ("Development: …", "Tests: …", "README: …", …). */
const PROJECT_NOTE = /^- (Development|Tests|README|Docs|Claude config)\b[^:]*:/;

/** A changelog entry without its project-only points (and their continuation lines), for the in-app fallback. */
export function userFacingChangelog(entry: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of entry.split('\n')) {
    if (line.startsWith('- ')) skipping = PROJECT_NOTE.test(line);
    else if (!/^\s/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n').trim();
}

// ------------------------------------------------------------------ Markdown

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold' | 'italic'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] };

export interface ListItem {
  content: Inline[];
  /** A nested list (one level). */
  sub?: Block;
}

export type Block =
  | { kind: 'heading'; level: number; content: Inline[]; text: string }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] };

const INLINE_PATTERNS: { kind: Inline['kind']; re: RegExp }[] = [
  { kind: 'code', re: /`([^`]+)`/ },
  { kind: 'link', re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { kind: 'bold', re: /\*\*(.+?)\*\*|__(.+?)__/ },
  { kind: 'italic', re: /\*(?=\S)(.+?)(?<=\S)\*|(?<![\p{L}\p{N}])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}])/u },
];

/**
 * The inline formatting the app shows: **bold**, *italic*, `code`, [links](https://…). Everything else is plain text
 * (no HTML is ever interpreted).
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    let best: { kind: Inline['kind']; m: RegExpExecArray } | null = null;
    for (const p of INLINE_PATTERNS) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { kind: p.kind, m };
    }
    if (!best) {
      out.push({ kind: 'text', text: rest });
      break;
    }
    const { kind, m } = best;
    if (m.index > 0) out.push({ kind: 'text', text: rest.slice(0, m.index) });
    if (kind === 'code') out.push({ kind, text: m[1] });
    else if (kind === 'link') out.push({ kind, href: m[2], children: parseInline(m[1]) });
    else out.push({ kind: kind as 'bold' | 'italic', children: parseInline(m[1] ?? m[2]) });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** Headings (#…######), bullet and numbered lists (one nested level), paragraphs. */
export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Extract<Block, { kind: 'list' }> | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const endList = () => {
    list = null;
  };

  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushParagraph();
      endList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      endList();
      const text = heading[2].replace(/\s+#+$/, '');
      blocks.push({ kind: 'heading', level: heading[1].length, content: parseInline(text), text });
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      const nested = item[1].length >= 2;
      const ordered = /\d/.test(item[2]);
      const content = parseInline(item[3]);
      const current = list as Extract<Block, { kind: 'list' }> | null;
      if (nested && current && current.items.length) {
        const parent = current.items[current.items.length - 1];
        if (!parent.sub || parent.sub.kind !== 'list') parent.sub = { kind: 'list', ordered, items: [] };
        parent.sub.items.push({ content });
      } else {
        if (!current || current.ordered !== ordered) {
          list = { kind: 'list', ordered, items: [] };
          blocks.push(list);
        }
        list!.items.push({ content });
      }
      continue;
    }
    const current = list as Extract<Block, { kind: 'list' }> | null;
    if (current && /^\s+/.test(raw)) {
      // Continuation of the last list item.
      const last = current.items[current.items.length - 1];
      const target = last.sub?.kind === 'list' ? last.sub.items[last.sub.items.length - 1] : last;
      target.content = [...target.content, { kind: 'text', text: ' ' }, ...parseInline(line.trim())];
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

/** Sections only meant for the GitHub page (how to download and install); the app has already been updated. */
const GITHUB_ONLY_SECTION = /^(install|updating|update instructions|download)/i;

/**
 * What the dialog shows: without a leading heading that repeats the version (the dialog's title says it), and without
 * the "Installing" / "Updating" / "Download" sections and everything under them up to the next heading of that level.
 */
export function inAppBlocks(blocks: Block[], version: string): Block[] {
  const result: Block[] = [];
  let skipping: number | null = null;
  blocks.forEach((b, i) => {
    if (b.kind === 'heading') {
      if (skipping !== null && b.level <= skipping) skipping = null;
      if (i === 0 && b.text.includes(version)) return;
      if (GITHUB_ONLY_SECTION.test(b.text)) {
        skipping = b.level;
        return;
      }
    }
    if (skipping === null) result.push(b);
  });
  return result;
}
