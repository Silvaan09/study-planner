import { app, nativeTheme, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { parseTheme, themeInfo, type ThemeId } from '../shared/themes';

/**
 * The chosen colour theme, kept by the main process so the window opens in it straight away: its background colour,
 * the light/dark title bar, and `?theme=` on the page URL (read by the renderer before its first render).
 * Stored in <dataDir>/app-state/preferences.json as { theme }.
 */
const file = () => path.join(app.getPath('userData'), 'preferences.json');

let current: ThemeId | null = null;

export function getTheme(): ThemeId {
  if (current) return current;
  try {
    current = parseTheme(JSON.parse(fs.readFileSync(file(), 'utf8'))?.theme);
  } catch {
    current = parseTheme(undefined); // no preferences yet (or unreadable): the default theme
  }
  return current;
}

/** Title bar, native dropdowns and scrollbars follow the theme. */
export function applyNativeTheme(): void {
  nativeTheme.themeSource = themeInfo(getTheme()).dark ? 'dark' : 'light';
}

export function windowBackground(): string {
  return themeInfo(getTheme()).preview.bg;
}

export function setTheme(value: unknown, win: BrowserWindow | null): void {
  current = parseTheme(value);
  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(fs.readFileSync(file(), 'utf8')) ?? {};
  } catch {
    // start a new file
  }
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ ...prefs, theme: current }));
  } catch (err) {
    console.error('[theme] could not save the theme:', err);
  }
  applyNativeTheme();
  if (win && !win.isDestroyed()) win.setBackgroundColor(windowBackground());
}
