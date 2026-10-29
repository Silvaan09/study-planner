import { app, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/types';

/**
 * Auto-update from GitHub releases (electron-updater; repository from `build.publish` in package.json).
 * Installed builds check on start and every few hours, download a newer release in the background and install it
 * when the app quits, or right away via installUpdate(). A release needs latest.yml next to the installer.
 * Development runs never check.
 */
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

let status: UpdateStatus = { state: 'idle' };
let getWindow: () => BrowserWindow | null = () => null;

function set(next: UpdateStatus): void {
  status = next;
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('update-status', status);
}

function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/net::|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/.test(text)) return 'No connection to GitHub. Check your internet connection.';
  if (/latest\.yml|404/.test(text)) return 'The latest release on GitHub has no update information (latest.yml).';
  return text.split('\n')[0];
}

export function initUpdater(window: () => BrowserWindow | null): void {
  getWindow = window;
  if (!app.isPackaged) {
    status = { state: 'disabled' };
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Testing only: a folder served over HTTP with latest.yml + installer instead of GitHub.
  if (process.env.STUDY_PLANNER_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.STUDY_PLANNER_UPDATE_URL });
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => set({ state: 'up-to-date', checkedAt: new Date().toISOString() }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => {
    if (status.state === 'downloading') set({ ...status, percent: Math.floor(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    // A failed check or download is retried on the next check; only Settings shows it.
    if (status.state !== 'ready') set({ state: 'error', message: message(err) });
  });
  checkForUpdates();
  setInterval(checkForUpdates, CHECK_EVERY_MS).unref();
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function checkForUpdates(): void {
  if (['disabled', 'checking', 'downloading', 'ready'].includes(status.state)) return;
  autoUpdater.checkForUpdates().catch(() => {
    // Reported through the 'error' event.
  });
}

export function installUpdate(): void {
  if (status.state !== 'ready') return;
  // Silent install (the user already chose the install folder once), then start the new version.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}
