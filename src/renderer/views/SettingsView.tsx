import { useState } from 'react';
import { api } from '../api';
import { useLoad, useUi } from '../ui';
import { playDing, setSoundEnabled, soundEnabled } from '../sound';
import { useUpdateStatus } from '../updates';
import { WhatsNewDialog } from '../components/WhatsNew';
import { Database, Download, Folder, Sparkles, Volume, VolumeOff } from '../components/Icons';
import type { UpdateStatus } from '../../shared/types';

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
  const update = useUpdateStatus();

  return (
    <div className="page">
      <header className="view-header">
        <div className="week-title">
          <h1>Settings</h1>
          <div className="week-sub">Sounds, updates, and where your study data is stored</div>
        </div>
      </header>

      <div className="settings">
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
              <button className="btn btn-primary" onClick={() => api.installUpdate()}>
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
          </section>
        )}
      </div>
    </div>
  );
}
