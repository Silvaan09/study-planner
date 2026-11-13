import type { OverridableField, OverrideConflict } from '../../shared/types';
import { Modal } from '../ui';

export const FIELD_LABEL: Record<OverridableField, string> = {
  title: 'title',
  description: 'notes',
  plannedDate: 'planned dates',
  deadlineDate: 'deadline',
  subjectId: 'subject',
  checklist: 'checklist steps',
};

export function ConflictDialog({ conflicts, close }: { conflicts: OverrideConflict[]; close: (p?: 'overwrite' | 'keep') => void }) {
  return (
    <Modal
      title="Some exercises were changed individually"
      onClose={() => close()}
      width={500}
      footer={
        <>
          <button className="btn" onClick={() => close()}>
            Cancel
          </button>
          <span className="spacer" />
          <button className="btn" onClick={() => close('overwrite')}>
            Overwrite them
          </button>
          <button className="btn btn-primary" onClick={() => close('keep')} autoFocus>
            Keep individual changes
          </button>
        </>
      }
    >
      <p>These exercises have their own changes to the fields you edited:</p>
      <ul className="conflict-list">
        {conflicts.map((c) => (
          <li key={c.id}>
            <strong>{c.title}</strong> — {c.fields.map((f) => FIELD_LABEL[f]).join(', ')}
          </li>
        ))}
      </ul>
      <p className="muted small">"Keep" updates everything else and leaves those fields untouched on these exercises.</p>
    </Modal>
  );
}
