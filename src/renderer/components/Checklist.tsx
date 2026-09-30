import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Exercise, Id } from '../../shared/types';
import { Check, ListChecks, Pencil } from './Icons';

/** "2/5" with a small bar; nothing for an exercise without steps, or once it's completed (its steps may be left unticked). */
export function ChecklistProgress({ exercise, compact }: { exercise: Exercise; compact?: boolean }) {
  const total = exercise.checklist.length;
  if (total === 0 || exercise.status === 'completed') return null;
  const done = exercise.checklist.filter((c) => c.done).length;
  return (
    <span className={`cl-progress ${done === total ? 'complete' : ''} ${compact ? 'compact' : ''}`} title={`${done} of ${total} steps done`}>
      <ListChecks size={12} />
      <span className="cl-count">
        {done}/{total}
      </span>
      {!compact && (
        <span className="cl-bar">
          <span style={{ width: `${(done / total) * 100}%` }} />
        </span>
      )}
    </span>
  );
}

/** The steps as tickable rows; changes are saved immediately through `onToggle`. */
export function ChecklistList({ exercise, onToggle }: { exercise: Exercise; onToggle: (itemId: Id, done: boolean) => void }) {
  return (
    <ul className="cl-list">
      {exercise.checklist.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            role="checkbox"
            aria-checked={c.done}
            className={`cl-item ${c.done ? 'done' : ''}`}
            onClick={() => onToggle(c.id, !c.done)}
          >
            <span className="cl-box">{c.done && <Check size={11} />}</span>
            <span className="cl-text">{c.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Popup next to a timetable card for ticking steps without opening the editor. Portaled into <body>. */
export function ChecklistPopover({
  exercise,
  anchor,
  onToggle,
  onEdit,
  onClose,
}: {
  exercise: Exercise;
  anchor: HTMLElement;
  onToggle: (itemId: Id, done: boolean) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const below = a.bottom + 6;
    const top = below + r.height > window.innerHeight - 8 ? Math.max(8, a.top - r.height - 6) : below;
    setPos({ left: Math.max(8, Math.min(a.left, window.innerWidth - r.width - 8)), top });
  }, [anchor, exercise.checklist.length]);

  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // The card scrolls with the timetable; a fixed popup would be left behind.
    const scroll = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="cl-popover"
      role="dialog"
      aria-label={`Checklist of ${exercise.title}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, opacity: 0 }}
    >
      <div className="cl-pop-head">
        <strong>{exercise.title}</strong>
        <ChecklistProgress exercise={exercise} compact />
      </div>
      <ChecklistList exercise={exercise} onToggle={onToggle} />
      <button type="button" className="btn btn-ghost small" onClick={onEdit}>
        <Pencil size={12} /> Edit steps…
      </button>
    </div>,
    document.body,
  );
}
