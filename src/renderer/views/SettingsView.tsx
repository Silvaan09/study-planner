import { useState } from 'react';
import { api } from '../api';
import { useLoad, useUi } from '../ui';
import { playDing, setSoundEnabled, soundEnabled } from '../sound';
import { Database, Folder, Volume, VolumeOff } from '../components/Icons';

export function SettingsView() {
  const ui = useUi();
  const { data: info } = useLoad(() => api.appInfo(), []);
  const [sound, setSound] = useState(soundEnabled);

  return (
    <div className="page">
      <header className="view-header">
        <div className="week-title">
          <h1>Settings</h1>
          <div className="week-sub">Sounds, and where your study data is stored</div>
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
