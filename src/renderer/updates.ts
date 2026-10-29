import { useEffect, useState } from 'react';
import { api } from './api';
import type { UpdateStatus } from '../shared/types';

/** The auto-updater's current state (src/main/updater.ts), kept up to date by its pushes. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    let live = true;
    const off = window.studyApi.onUpdateStatus((s) => setStatus(s));
    api.getUpdateStatus().then((s) => live && setStatus((cur) => cur ?? s), () => {});
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}
