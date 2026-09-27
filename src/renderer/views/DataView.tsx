import { api } from '../api';
import { useLoad, useUi } from '../ui';
import { Database, Folder } from '../components/Icons';

export function DataView() {
  const ui = useUi();
  const { data: info } = useLoad(() => api.appInfo(), []);

  return (
    <div className="page">
      <header className="view-header">
        <div className="week-title">
          <h1>Data &amp; backups</h1>
          <div className="week-sub">Where your study data is stored</div>
        </div>
      </header>
      {info && (
        <div className="info-card">
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
        </div>
      )}
    </div>
  );
}
