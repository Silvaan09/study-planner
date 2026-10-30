import { describe, expect, it } from 'vitest';
import { changelogEntry, inAppBlocks, parseInline, parseMarkdown, userFacingChangelog } from '../src/shared/releaseNotes';

describe('changelogEntry', () => {
  const changelog = '# Changelog\r\n\r\nIntro.\r\n\r\n## 1.10.1 — 2026-10-30\r\n- Fix A.\r\n- Fix B.\r\n\r\n## 1.10.0 — 2026-10-29\r\n- Old.\r\n';
  it('returns the body of a version entry up to the next one', () => {
    expect(changelogEntry(changelog, '1.10.1')).toBe('- Fix A.\n- Fix B.');
    expect(changelogEntry(changelog, '1.10.0')).toBe('- Old.');
  });
  it('does not mix up versions with the same prefix, and returns null for unknown ones', () => {
    expect(changelogEntry(changelog, '1.10')).toBeNull();
    expect(changelogEntry(changelog, '1.1.0')).toBeNull();
  });
});

describe('userFacingChangelog', () => {
  it('drops the points about tests, docs and development', () => {
    const entry = [
      '- **New thing.** Nice.',
      '- Tests: more tests.',
      '  continued',
      '- README: new screenshots.',
      '- Development: the demo data has a break.',
      '- Claude config: rules.',
      '- A fix.',
    ].join('\n');
    expect(userFacingChangelog(entry)).toBe('- **New thing.** Nice.\n- A fix.');
  });
});

describe('parseInline', () => {
  it('reads bold, italic, code and links, everything else as text', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.y) _f_ g')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'c' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', href: 'https://x.y', children: [{ kind: 'text', text: 'e' }] },
      { kind: 'text', text: ' ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'f' }] },
      { kind: 'text', text: ' g' },
    ]);
  });
  it('nests formatting and leaves underscores inside words and HTML alone', () => {
    expect(parseInline('**Edit semester → [Breaks](https://a)**')).toEqual([
      {
        kind: 'bold',
        children: [
          { kind: 'text', text: 'Edit semester → ' },
          { kind: 'link', href: 'https://a', children: [{ kind: 'text', text: 'Breaks' }] },
        ],
      },
    ]);
    expect(parseInline('snake_case_name <b>x</b>')).toEqual([{ kind: 'text', text: 'snake_case_name <b>x</b>' }]);
    // Code is not formatted inside.
    expect(parseInline('`**x**`')).toEqual([{ kind: 'code', text: '**x**' }]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings, paragraphs and lists with one nested level', () => {
    const blocks = parseMarkdown('## Title\n\nSome text\non two lines.\n\n- one\n  continued\n- two\n  - sub\n1. first\n2. second');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(blocks[0]).toMatchObject({ level: 2, text: 'Title' });
    expect(blocks[1]).toMatchObject({ content: [{ kind: 'text', text: 'Some text on two lines.' }] });
    const bullets = blocks[2] as Extract<(typeof blocks)[number], { kind: 'list' }>;
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    expect(bullets.items[0].content.map((i) => (i.kind === 'text' ? i.text : '')).join('')).toBe('one continued');
    expect(bullets.items[1].sub).toMatchObject({ kind: 'list', items: [{ content: [{ kind: 'text', text: 'sub' }] }] });
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true, items: [{}, {}] });
  });
});

describe('inAppBlocks', () => {
  it('drops a leading title with the version and the install sections', () => {
    const md = '## Study Planner 1.11.0\n\n### New\n- A\n\n### Updating\n- Install by hand\n\n#### Detail\n- still skipped\n\n### Changes\n- B';
    const shown = inAppBlocks(parseMarkdown(md), '1.11.0');
    expect(shown.filter((b) => b.kind === 'heading').map((b) => (b.kind === 'heading' ? b.text : ''))).toEqual(['New', 'Changes']);
    expect(shown).toHaveLength(4);
  });
  it('keeps a first heading that is not about the version', () => {
    expect(inAppBlocks(parseMarkdown('### New\n- A'), '1.11.0')).toHaveLength(2);
  });
});
