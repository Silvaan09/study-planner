/**
 * The app's colour themes. The look itself is in styles.css (`:root` = Slate, `:root[data-theme='…']` for the others);
 * this is what the main process (window background, light/dark title bar) and the Settings picker need. Pure, tested
 * in tests/themes.test.ts.
 */

export type ThemeId = 'paper' | 'slate' | 'obsidian';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  /** Shown under the name in Settings. */
  tone: 'Light' | 'Default' | 'Dark';
  description: string;
  /** Light themes get a light title bar, dropdowns and scrollbars. */
  dark: boolean;
  /** Colours of the small preview in Settings (the real ones are in styles.css); `bg` is also the window background. */
  preview: { bg: string; surface: string; border: string; text: string; muted: string; accent: string };
}

export const THEMES: readonly ThemeInfo[] = [
  {
    id: 'paper',
    name: 'Paper',
    tone: 'Light',
    description: 'Warm off-white, like a notebook page.',
    dark: false,
    preview: { bg: '#f3efe7', surface: '#fffdf8', border: '#e3dccd', text: '#25211b', muted: '#8f8574', accent: '#2c5d9c' },
  },
  {
    id: 'slate',
    name: 'Slate',
    tone: 'Default',
    description: 'Blue-grey dark, easy on the eyes day and night.',
    dark: true,
    preview: { bg: '#12141b', surface: '#1a1d27', border: '#2c3040', text: '#e8eaf2', muted: '#6f7690', accent: '#7b91ff' },
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    tone: 'Dark',
    description: 'Near-black and calm: only your subjects bring colour.',
    dark: true,
    preview: { bg: '#0a0a0b', surface: '#121214', border: '#232327', text: '#ededef', muted: '#6b6b74', accent: '#f4f4f5' },
  },
];

export const DEFAULT_THEME: ThemeId = 'slate';

/** A known theme id, else the default (missing or unknown values, e.g. from a newer version's settings). */
export function parseTheme(value: unknown): ThemeId {
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : DEFAULT_THEME;
}

export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}
