import { useCallback } from 'react';
import { api } from '../api';
import { useUi } from '../ui';
import { Download } from './Icons';

/** Shown for the moment between "Restart & update" and the app closing; the installer's progress window follows. */
function UpdatingOverlay({ version }: { version: string }) {
  return (
    <div className="modal-backdrop updating-backdrop">
      <div className="modal updating" role="alertdialog" aria-live="assertive" aria-label={`Installing version ${version}`}>
        <span className="updating-icon">
          <Download size={22} />
        </span>
        <h2>Installing version {version}</h2>
        <p>Study Planner closes now, installs the update and opens again by itself. Your data is kept.</p>
        <span className="updating-bar" aria-hidden>
          <span />
        </span>
      </div>
    </div>
  );
}

/** "Restart & update": the overlay above, then the main process quits and runs the installer (updater.ts). */
export function useRestartToUpdate(): (version: string) => void {
  const ui = useUi();
  return useCallback(
    (version: string) => {
      // Never closed: the window goes away with the app.
      void ui.dialog(() => <UpdatingOverlay version={version} />);
      void api.installUpdate();
    },
    [ui],
  );
}
