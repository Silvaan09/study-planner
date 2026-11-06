import { api } from './api';
import { parseTheme, type ThemeId } from '../shared/themes';

/**
 * The colour theme on the page: `data-theme` on <html> (styles.css). The main process passes the saved theme as
 * `?theme=` in the page URL so it's applied before the first render; changing it saves it there too (window
 * background, title bar) and updates the URL, so a reload keeps it.
 */
export function currentTheme(): ThemeId {
  return parseTheme(document.documentElement.dataset.theme ?? new URLSearchParams(location.search).get('theme'));
}

function showTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  const url = new URL(location.href);
  url.searchParams.set('theme', theme);
  history.replaceState(history.state, '', url);
}

/** Before the first render (main.tsx). */
export function applyInitialTheme(): void {
  showTheme(currentTheme());
}

export function changeTheme(theme: ThemeId): Promise<void> {
  showTheme(theme);
  return api.setTheme(theme);
}
