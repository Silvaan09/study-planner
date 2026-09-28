import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { useLoad } from '../ui';
import { formatDate, weeksBetween, type ISODate } from '../../shared/dates';
import { weekStatus } from '../../shared/progress';
import type { ExerciseStatus, Semester, SemesterWeekProgress } from '../../shared/types';
import { ChevronDown, StatusIcon } from './Icons';

const STATUS_TEXT: Record<ExerciseStatus, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };

function statusTitle(p: SemesterWeekProgress | undefined): string | undefined {
  const status = p && weekStatus(p);
  if (!p || !status) return 'Nothing planned this week';
  return `${STATUS_TEXT[status]} · ${p.lecturesDone}/${p.lectures} lectures, ${p.exercisesDone}/${p.exercises} exercises`;
}

/** "Jump to semester week" dropdown. Each week shows whether it's completed, in progress or not started. */
export function WeekPicker({ semester, weekStart, onChange }: { semester: Semester; weekStart: ISODate; onChange: (w: ISODate) => void }) {
  const weeks = useMemo(() => weeksBetween(semester.startDate, semester.endDate), [semester]);
  const { data: progress } = useLoad(() => api.getSemesterProgress(semester.id), [semester.id]);
  const byWeek = useMemo(() => new Map((progress ?? []).map((p) => [p.weekStart, p])), [progress]);
  const index = weeks.indexOf(weekStart);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const show = () => {
    setActive(Math.max(0, index));
    setOpen(true);
  };
  const choose = (w: ISODate) => {
    setOpen(false);
    onChange(w);
  };

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const close = () => setOpen(false);
    window.addEventListener('mousedown', down);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // Keep the highlighted week in view (also centres the selected week when opening).
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  // While open, the keys drive the list instead of the timetable's week shortcuts.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        show();
      }
      return;
    }
    const handled = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'].includes(e.key);
    if (!handled) return;
    if (e.key !== 'Tab') e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowDown') setActive((a) => Math.min(weeks.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(weeks.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(weeks[active]);
    else setOpen(false);
  };

  return (
    <div className="week-picker" ref={ref}>
      <button
        className="input compact week-picker-btn"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Jump to semester week"
      >
        <span>{index >= 0 ? `Week ${index + 1} · ${formatDate(weekStart)}` : 'Jump to week…'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="week-list" role="listbox" ref={listRef}>
          {weeks.map((w, i) => {
            const p = byWeek.get(w);
            const status = p ? weekStatus(p) : null;
            return (
              <div
                key={w}
                role="option"
                aria-selected={w === weekStart}
                className={`week-option ${w === weekStart ? 'selected' : ''} ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(w)}
                title={statusTitle(p)}
              >
                <span>
                  Week {i + 1} · {formatDate(w)}
                </span>
                <span className={`week-status ${status ? `status-${status}` : ''}`}>{status && <StatusIcon status={status} size={14} />}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
