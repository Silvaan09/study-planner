import { api } from '../api';
import { Confirm, useLoad, useUi } from '../ui';
import type { TrashEntry, TrashKind } from '../../shared/types';
import { Restore, Trash, X } from '../components/Icons';

const KIND_LABEL: Record<TrashKind, string> = {
  semester: 'Semester',
  subject: 'Subject',
  lecture: 'Lecture',
  lecture_occurrences: 'Lecture weeks',
  exercise: 'Exercise',
  exercise_occurrences: 'Exercises',
  exercise_series: 'Exercise series',
};

function when(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TrashView() {
  const ui = useUi();
  const { data } = useLoad(() => api.listTrash(), []);

  const purge = async (t: TrashEntry) => {
    const ok = await ui.dialog<boolean>((close) => (
      <Confirm
        title="Delete permanently?"
        message={
          <>
            <strong>{t.label}</strong> will be deleted for good, including everything that belongs to it. This cannot be undone.
          </>
        }
        confirmLabel="Delete permanently"
        danger
        close={close}
      />
    ));
    if (ok) await ui.run(() => api.purgeTrash(t.id));
  };

  const emptyAll = async () => {
    const ok = await ui.dialog<boolean>((close) => (
      <Confirm
        title="Empty trash?"
        message={`All ${data?.length ?? 0} items in the trash will be deleted permanently. This cannot be undone.`}
        confirmLabel="Empty trash"
        danger
        close={close}
      />
    ));
    if (ok) await ui.run(() => api.emptyTrash());
  };

  const restore = async (t: TrashEntry) => {
    const ok = await ui.run(async () => {
      await api.restoreTrash(t.id);
      return true;
    });
    if (ok) ui.toast(`${t.label} restored`, { kind: 'success' });
  };

  return (
    <div className="page">
      <header className="view-header">
        <div className="week-title">
          <h1>Trash</h1>
          <div className="week-sub">Deleted items stay here until you delete them permanently</div>
        </div>
        <span className="spacer" />
        <button className="btn btn-ghost-danger" onClick={emptyAll} disabled={!data?.length}>
          <X size={15} /> Empty trash
        </button>
      </header>

      {data && data.length === 0 && (
        <div className="empty-state">
          <Trash size={36} />
          <h2>The trash is empty</h2>
          <p>When you delete something, it lands here first so you can restore it.</p>
        </div>
      )}

      <div className="trash-list">
        {(data ?? []).map((t) => (
          <div key={t.id} className="trash-item">
            <span className="kind-tag">{KIND_LABEL[t.kind]}</span>
            <div className="out-main">
              <div className="out-title">{t.label}</div>
              <div className="out-meta">
                {t.detail} · deleted {when(t.deletedAt)}
              </div>
            </div>
            <button className="btn" onClick={() => restore(t)}>
              <Restore size={14} /> Restore
            </button>
            <button className="btn btn-ghost-danger" onClick={() => purge(t)}>
              Delete permanently
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
