import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, parseTheme, THEMES, themeInfo } from '../src/shared/themes';

describe('themes', () => {
  it('offers Paper (light), Slate (default) and Obsidian (dark), in that order', () => {
    expect(THEMES.map((t) => [t.id, t.tone, t.dark])).toEqual([
      ['paper', 'Light', false],
      ['slate', 'Default', true],
      ['obsidian', 'Dark', true],
    ]);
    expect(DEFAULT_THEME).toBe('slate');
  });
  it('falls back to the default for missing or unknown values', () => {
    expect(parseTheme('obsidian')).toBe('obsidian');
    expect(parseTheme(undefined)).toBe('slate');
    expect(parseTheme('neon')).toBe('slate');
    expect(parseTheme(3)).toBe('slate');
  });
  it('gives the window background of each theme', () => {
    expect(themeInfo('paper').preview.bg).toBe('#f3efe7');
    expect(themeInfo('slate').preview.bg).toBe('#12141b');
  });
});
