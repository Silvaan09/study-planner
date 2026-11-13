import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLoad, useUi } from '../ui';
import { playDing, setSoundEnabled, soundEnabled } from '../sound';
import { useUpdateStatus } from '../updates';
import { WhatsNewDialog } from '../components/WhatsNew';
import { useRestartToUpdate } from '../components/UpdatingOverlay';
import { Check, Database, Download, Folder, Power, Restore, Sparkles, Volume, VolumeOff } from '../components/Icons';
import { Confirm } from '../ui';
import { formatDate } from '../../shared/dates';
import { changeTheme, currentTheme } from '../theme';
import { THEMES, type ThemeInfo } from '../../shared/themes';
import type { CSSProperties } from 'react';
import type { BackupInfo, BackupKind, UpdateStatus } from '../../shared/types';

const BACKUP_KIND: Record<BackupKind, string> = {
  auto: 'Daily',
  manual: 'Made by you',
  'pre-migration': 'Before an upgrade',
  'pre-restore': 'Before a restore',
  other: 'Other',
};
/** Shown after the reload that follows a restore. */
const RESTORED_KEY = 'restoredBackup';
const BACKUPS_SHOWN = 8;

/** "Fri 13 Nov 2026, 14:05" */
function backupTime(b: BackupInfo): string {
  return `${formatDate(b.createdAt.slice(0, 10), { weekday: true, year: true })}, ${b.createdAt.slice(11, 16)}`;
}

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A tiny sketch of the app in a theme's colours: sidebar, header, two lectures and a task. */
function ThemePreview({ t }: { t: ThemeInfo }) {
  const p = t.preview;
  const lecture = (c: string): CSSProperties =>
    t.id === 'obsidian'
      ? { background: `color-mix(in srgb, ${c} 8%, ${p.bg})`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 60%, transparent)`, borderLeftColor: c }
      : { background: `color-mix(in srgb, ${c} ${t.dark ? 28 : 22}%, ${p.surface})`, borderLeftColor: c };
  return (
    <span className="theme-preview" style={{ background: p.bg, borderColor: p.border }} aria-hidden>
      <span className="tp-side" style={{ background: t.id === 'obsidian' ? p.bg : p.surface, borderColor: p.border }}>
        <span style={{ background: p.text, width: '70%' }} />
        <span style={{ background: p.accent, width: '85%' }} />
        <span style={{ background: p.muted, width: '60%' }} />
        <span style={{ background: p.muted, width: '75%' }} />
      </span>
      <span className="tp-main">
        <span className="tp-head">
          <span style={{ background: p.text }} />
          <span className="tp-btn" style={{ background: p.accent }} />
        </span>
        <span className="tp-grid" style={{ background: p.surface, borderColor: p.border }}>
          <span className="tp-card" style={{ ...lecture('#ec4899'), top: '12%', left: '6%' }} />
          <span className="tp-card" style={{ ...lecture('#14b8a6'), top: '40%', left: '38%' }} />
          <span className="tp-card" style={{ ...lecture('#4f6bed'), top: '18%', left: '70%' }} />
        </span>
      </span>
    </span>
  );
}

function updateText(s: UpdateStatus | null, version: string | undefined): string {
  switch (s?.state) {
    case undefined:
    case 'idle':
      return `You have version ${version ?? '…'}.`;
    case 'disabled':
      return 'Updates are only checked in the installed app, not in development builds.';
    case 'checking':
      return 'Looking for a new version…';
    case 'up-to-date': {
      const at = new Date(s.checkedAt);
      const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
      return `Version ${version ?? ''} is the latest (checked at ${time}).`;
    }
    case 'downloading':
      return `Downloading version ${s.version}… ${s.percent}%`;
    case 'ready':
      return `Version ${s.version} is ready. It installs when you close the app, or restart now.`;
    case 'error':
      return `Couldn't check for updates: ${s.message}`;
  }
}

export function SettingsView() {
  const ui = useUi();
  const { data: info } = useLoad(() => api.appInfo(), []);
  const [sound, setSound] = useState(soundEnabled);
  const [theme, setTheme] = useState(currentTheme);
  const update = useUpdateStatus();
  const restartToUpdate = useRestartToUpdate();
  const { data: backups } = useLoad(() => api.listBackups(), []);
  const [allBackups, setAllBackups] = useState(false);
  const { data: loadedAutostart } = useLoad(() => api.getAutostart(), []);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const autostartOn = autostart ?? loadedAutostart?.enabled ?? false;

  // After a restore the page reloads; say so once.
  useEffect(() => {
    try {
      const restored = sessionStorage.getItem(RESTORED_KEY);
      if (restored) {
        sessionStorage.removeItem(RESTORED_KEY);
        ui.toast(`Restored: ${restored}`, { kind: 'success' });
      }
    } catch {
      /* ignore */
    }
  }, [ui]);

  /** Asks, restores (the main process backs up the current data first), then reloads everything. */
  const restore = async (what: string, doRestore: () => Promise<boolean>, confirmLabel = 'Restore') => {
    const ok = await ui.dialog<boolean>((close) => (
      <Confirm
        title="Restore this backup?"
        message={
          <>
            <p>
              All your data (every semester) is replaced by <strong>{what}</strong>.
            </p>
            <p className="muted small">Your current data is saved as a backup first ("Before a restore"), so you can go back to it.</p>
          </>
        }
        confirmLabel={confirmLabel}
        danger
        close={close}
      />
    ));
    if (!ok) return;
    const done = await ui.run(doRestore);
    if (!done) return;
    try {
      sessionStorage.setItem(RESTORED_KEY, what.replace(' you choose next', ''));
    } catch {
      /* ignore */
    }
    location.reload();
  };

  return (
    <div className="page">
      <header className="view-header">
        <div className="week-title">
          <h1>Settings</h1>
          <div className="week-sub">Appearance, sounds, startup, updates, and where your study data is stored</div>
        </div>
      </header>

      <div className="settings">
        <section className="info-card">
          <h2 className="card-title">Appearance</h2>
          <div className="theme-picker" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                className={`theme-option ${theme === t.id ? 'selected' : ''}`}
                onClick={() => {
                  setTheme(t.id);
                  void ui.run(() => changeTheme(t.id));
                }}
              >
                <ThemePreview t={t} />
                <span className="theme-name">
                  {t.name}
                  <small>{t.tone}</small>
                  {theme === t.id && (
                    <span className="theme-check">
                      <Check size={13} />
                    </span>
                  )}
                </span>
                <span className="theme-desc">{t.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="info-card">
          <h2 className="card-title">Sound</h2>
          <label className="setting-row">
            <span className="setting-icon">{sound ? <Volume size={18} /> : <VolumeOff size={18} />}</span>
            <span className="setting-text">
              <strong>Check-off sound</strong>
              <small>A soft ding when you check off a lecture or exercise, and a short chime when a week's lectures or exercises are all done.</small>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={sound}
              onChange={(e) => {
                setSoundEnabled(e.target.checked);
                setSound(e.target.checked);
                if (e.target.checked) playDing(true);
              }}
            />
          </label>
        </section>

        <section className="info-card">
          <h2 className="card-title">Startup</h2>
          <label className="setting-row">
            <span className="setting-icon">
              <Power size={18} />
            </span>
            <span className="setting-text">
              <strong>Start with Windows</strong>
              <small>
                {loadedAutostart && !loadedAutostart.available
                  ? 'Only available in the installed app, not in development builds.'
                  : 'Opens Study Planner minimized in the taskbar when you sign in to Windows.'}
              </small>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={autostartOn}
              disabled={!loadedAutostart?.available}
              onChange={async (e) => {
                const on = e.target.checked;
                setAutostart(on);
                const state = await ui.run(() => api.setAutostart(on));
                setAutostart(state ? state.enabled : !on);
              }}
            />
          </label>
        </section>

        <section className="info-card">
          <h2 className="card-title">Updates</h2>
          <div className="setting-row">
            <span className="setting-icon">
              <Download size={18} />
            </span>
            <span className="setting-text">
              <strong>Automatic updates</strong>
              <small>{updateText(update, info?.version)}</small>
              {update?.state === 'downloading' && (
                <span className="update-bar" aria-hidden>
                  <span style={{ width: `${update.percent}%` }} />
                </span>
              )}
            </span>
            {update?.state === 'ready' ? (
              <button className="btn btn-primary" onClick={() => restartToUpdate(update.version)}>
                Restart &amp; update
              </button>
            ) : (
              <button
                className="btn"
                disabled={!update || ['disabled', 'checking', 'downloading'].includes(update.state)}
                onClick={() => api.checkForUpdates()}
              >
                Check for updates
              </button>
            )}
          </div>
          <p className="muted small">
            New versions are downloaded from GitHub in the background and installed when you close the app. Your data is kept.
          </p>
          <div className="button-row">
            <button
              className="btn btn-ghost small"
              onClick={async () => {
                const notes = await ui.run(() => api.getReleaseNotes());
                if (notes) ui.dialog((close) => <WhatsNewDialog notes={notes} close={() => close()} />);
              }}
            >
              <Sparkles size={14} /> What's new in {info?.version ?? 'this version'}
            </button>
          </div>
        </section>

        {info && (
          <section className="info-card">
            <h2 className="card-title">Data &amp; backups</h2>
            <dl>
              <dt>Database</dt>
              <dd>
                <code>{info.dbPath}</code>
              </dd>
              <dt>Backups</dt>
              <dd>
                <code>{info.backupDir}</code>
              </dd>
              <dt>Schema version</dt>
              <dd>v{info.schemaVersion}</dd>
              <dt>App version</dt>
              <dd>
                {info.version}
                {info.isDev && ' (development build — uses a separate data folder)'}
              </dd>
            </dl>
            <p className="muted small">
              Your data lives outside the app's install and build folders, so reinstalling or rebuilding the app keeps it. When a new version needs
              to change the database structure, it first saves a backup and then migrates your existing data. A daily backup is also kept (last 14
              days).
            </p>
            <div className="button-row">
              <button className="btn" onClick={() => api.openDataFolder()}>
                <Folder size={15} /> Open data folder
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const file = await ui.run(() => api.createBackup());
                  if (file) ui.toast('Backup created', { kind: 'success' });
                }}
              >
                <Database size={15} /> Create backup now
              </button>
            </div>

            <h3 className="card-subtitle">Restore a backup</h3>
            <p className="muted small">
              Puts all your data back to the state of a backup. Your current data is saved as a backup first, so a restore can be undone.
            </p>
            {backups && backups.length > 0 ? (
              <ul className="backup-list">
                {(allBackups ? backups : backups.slice(0, BACKUPS_SHOWN)).map((b) => (
                  <li key={b.file} className="backup-row" title={b.file}>
                    <span className="backup-time">{backupTime(b)}</span>
                    <span className={`backup-kind kind-${b.kind}`}>{BACKUP_KIND[b.kind]}</span>
                    <span className="backup-size">{fileSize(b.size)}</span>
                    <button
                      className="btn small"
                      onClick={() => restore(`the backup from ${backupTime(b)}`, () => api.restoreBackup(b.file).then(() => true))}
                    >
                      <Restore size={14} /> Restore
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              backups && <p className="muted small">No backups yet.</p>
            )}
            <div className="button-row">
              {backups && backups.length > BACKUPS_SHOWN && (
                <button className="btn btn-ghost small" onClick={() => setAllBackups((v) => !v)}>
                  {allBackups ? 'Show fewer' : `Show all ${backups.length}`}
                </button>
              )}
              <span className="spacer" />
              <button className="btn" onClick={() => restore('the backup file you choose next', () => api.restoreBackupFromFile(), 'Choose file…')}>
                <Folder size={15} /> Restore from file…
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
