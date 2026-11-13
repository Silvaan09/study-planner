import { useEffect, useRef, useState } from 'react';
import type { ChecklistItemInput } from '../../shared/types';
import { Check, Plus, X } from '../components/Icons';

export interface DraftStep extends ChecklistItemInput {
  key: number;
}

let nextStepKey = 1;
export const draftSteps = (items: ChecklistItemInput[]): DraftStep[] => items.map(({ text, done }) => ({ key: nextStepKey++, text, done }));
/** The steps as saved: trimmed, without empty rows. */
export const cleanSteps = (steps: DraftStep[]): ChecklistItemInput[] =>
  steps.map(({ text, done }) => ({ text: text.trim(), done })).filter((s) => s.text !== '');

/**
 * Editable list of an exercise's steps. Enter adds a step below, Backspace in an empty step removes it,
 * Up/Down move between steps.
 */
export function ChecklistEditor({ steps, onChange }: { steps: DraftStep[]; onChange: (s: DraftStep[]) => void }) {
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<number | null>(null);
  useEffect(() => {
    if (focusKey === null) return;
    inputs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey, steps]);

  const update = (key: number, patch: Partial<DraftStep>) => onChange(steps.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const insertAfter = (index: number) => {
    const step = { key: nextStepKey++, text: '', done: false };
    onChange([...steps.slice(0, index + 1), step, ...steps.slice(index + 1)]);
    setFocusKey(step.key);
  };
  const remove = (index: number, refocus: boolean) => {
    onChange(steps.filter((_, i) => i !== index));
    if (refocus && steps.length > 1) setFocusKey(steps[index === 0 ? 1 : index - 1].key);
  };
  const done = steps.filter((s) => s.done && s.text.trim()).length;
  const total = steps.filter((s) => s.text.trim()).length;

  return (
    <div className="cl-editor">
      {steps.map((s, i) => (
        <div key={s.key} className={`cl-edit-row ${s.done ? 'done' : ''}`}>
          <button
            type="button"
            role="checkbox"
            aria-checked={s.done}
            className="cl-box"
            title={s.done ? 'Done, click to undo' : 'Mark as done'}
            onClick={() => update(s.key, { done: !s.done })}
          >
            {s.done && <Check size={11} />}
          </button>
          <input
            ref={(el) => {
              if (el) inputs.current.set(s.key, el);
              else inputs.current.delete(s.key);
            }}
            className="input compact"
            value={s.text}
            placeholder={`Step ${i + 1}`}
            maxLength={200}
            onChange={(e) => update(s.key, { text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                insertAfter(i);
              } else if (e.key === 'Backspace' && s.text === '') {
                e.preventDefault();
                remove(i, true);
              } else if (e.key === 'ArrowUp' && i > 0) {
                e.preventDefault();
                setFocusKey(steps[i - 1].key);
              } else if (e.key === 'ArrowDown' && i < steps.length - 1) {
                e.preventDefault();
                setFocusKey(steps[i + 1].key);
              }
            }}
          />
          <button type="button" className="icon-btn small" title="Remove this step" onClick={() => remove(i, false)}>
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="planned-actions">
        <button type="button" className="btn btn-ghost small" onClick={() => insertAfter(steps.length - 1)}>
          <Plus size={13} /> Add step
        </button>
        {total > 0 && (
          <span className="muted small">
            {done} of {total} done
          </span>
        )}
      </div>
    </div>
  );
}
