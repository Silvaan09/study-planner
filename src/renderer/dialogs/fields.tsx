import type { ReactNode } from 'react';
import { EXERCISE_STAGE_LABEL, EXERCISE_STAGES, type ExerciseStage } from '../../shared/types';
import { StatusIcon, Trash } from '../components/Icons';

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Footer({
  onCancel,
  onSave,
  saveLabel = 'Save',
  disabled,
  onDelete,
  extra,
}: {
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  disabled?: boolean;
  onDelete?: () => void;
  extra?: ReactNode;
}) {
  return (
    <>
      {onDelete && (
        <button className="btn btn-ghost-danger" onClick={onDelete}>
          <Trash /> Delete
        </button>
      )}
      {extra}
      <span className="spacer" />
      <button className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button className="btn btn-primary" onClick={onSave} disabled={disabled}>
        {saveLabel}
      </button>
    </>
  );
}

/** Text input for 24-hour times. Accepts "9", "915", "9:15", "09.15" and normalizes to "09:15". */
export function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const normalize = (raw: string): string => {
    const s = raw.trim().replace(/[.h]/g, ':');
    let m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
    if (!m && /^\d{3,4}$/.test(s)) m = /^(\d{1,2})(\d{2})$/.exec(s);
    if (!m) return raw;
    const h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (h > 23 || min > 59) return raw;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };
  return (
    <input
      className="input time-input"
      value={value}
      placeholder="HH:MM"
      maxLength={5}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onChange(normalize(e.target.value))}
    />
  );
}

/** Done = the work is finished; handed in = the deadline is dealt with too. */
export function StatusPicker({
  value,
  onChange,
  stages = EXERCISE_STAGES,
}: {
  value: ExerciseStage;
  onChange: (s: ExerciseStage) => void;
  stages?: ExerciseStage[];
}) {
  return (
    <div className="segmented" role="radiogroup">
      {stages.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} className={`seg status-${s} ${value === s ? 'active' : ''}`} onClick={() => onChange(s)}>
          <StatusIcon status={s} size={14} /> {EXERCISE_STAGE_LABEL[s]}
        </button>
      ))}
    </div>
  );
}
