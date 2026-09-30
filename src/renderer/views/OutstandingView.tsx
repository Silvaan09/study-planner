import { useMemo, type CSSProperties } from 'react';
import { api } from '../api';
import { useLoad, useUi } from '../ui';
import { addDays, diffDays, formatDate, startOfWeek, todayISO, type ISODate } from '../../shared/dates';
import { EXERCISE_STAGES, EXERCISE_STAGE_LABEL, exerciseStage, type ExerciseStage, type OutstandingItem, type Semester, type Subject } from '../../shared/types';
import { ExerciseDialog } from '../dialogs';
import { useExerciseProgress, useWeekCompletion } from '../actions';
import { Alert, Calendar, Check, Flag, StatusIcon } from '../components/Icons';
import { FocusPill } from '../components/FocusPill';
import { ChecklistProgress } from '../components/Checklist';

function dayHeading(date: ISODate, today: ISODate): string {
  const d = diffDays(today, date);
  const base = formatDate(date, { weekday: true, year: date.slice(0, 4) !== today.slice(0, 4) });
  if (d === 0) return `Today · ${base}`;
  if (d === -1) return `Yesterday · ${base}`;
  if (d === 1) return `Tomorrow · ${base}`;
  return base;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function OutstandingView({
  semester,
  showWeek,
  focus,
  clearFocus,
}: {
  semester: Semester;
  showWeek: (weekStart: ISODate) => void;
  /** Subject picked in the sidebar: only its items are listed. */
  focus: Subject | null;
  clearFocus: () => void;
}) {
  const ui = useUi();
  const completing = useWeekCompletion(semester.id);
  const progress = useExerciseProgress(semester.id);
  const today = todayISO();
  const { data } = useLoad(() => api.getOutstanding(semester.id, today), [semester.id, today]);
  const subjects = data?.subjects ?? [];
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (!focus) return all;
    return all.filter((i) => (i.kind === 'lecture' ? i.occurrence.subjectId : i.exercise.subjectId) === focus.id);
  }, [data, focus]);

  const groups = useMemo(() => {
    const m = new Map<ISODate, OutstandingItem[]>();
    for (const item of items) {
      if (!m.has(item.date)) m.set(item.date, []);
      m.get(item.date)!.push(item);
    }
    return [...m.entries()];
  }, [items]);

  const counts = useMemo(() => {
    // "Open" = relevant now: planned for today or earlier, or due within the next 7 days.
    const dueLimit = addDays(today, 7);
    return {
      overdue: items.filter((i) => i.kind === 'exercise' && i.overdue).length,
      exercises: items.filter((i) => i.kind === 'exercise' && (i.exercise.plannedDate <= today || i.exercise.deadlineDate <= dueLimit)).length,
      lectures: items.filter((i) => i.kind === 'lecture').length,
    };
  }, [items, today]);

  const completeLecture = (item: Extract<OutstandingItem, { kind: 'lecture' }>) => {
    const o = item.occurrence;
    void ui.run(async () => {
      await completing([o.weekStart], () => api.setLectureCompleted(o.lectureId, o.weekStart, true));
      ui.toast(`"${o.title}" (${formatDate(o.date, { weekday: true })}) completed`, {
        kind: 'success',
        action: { label: 'Undo', run: () => void ui.run(() => api.setLectureCompleted(o.lectureId, o.weekStart, false)) },
      });
    });
  };

  return (
    <div className="page">
      <header className="view-header">
        <div className="week-title">
          <h1>Outstanding</h1>
          <div className="week-sub">Lectures not completed and exercises not handed in yet in {semester.name}, oldest first</div>
        </div>
        <span className="spacer" />
        <FocusPill subject={focus} onClear={clearFocus} />
      </header>

      <div className="stat-row">
        <div className={`stat ${counts.overdue ? 'stat-danger' : ''}`}>
          <Alert size={18} />
          <div>
            <strong>{counts.overdue}</strong>
            <span>overdue exercise{counts.overdue === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="stat" title="Exercises not handed in yet that are planned for today or earlier, or due within the next 7 days">
          <StatusIcon status="in_progress" size={18} />
          <div>
            <strong>{counts.exercises}</strong>
            <span>open exercise{counts.exercises === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="stat">
          <Calendar size={18} />
          <div>
            <strong>{counts.lectures}</strong>
            <span>lecture{counts.lectures === 1 ? '' : 's'} to catch up on</span>
          </div>
        </div>
      </div>

      {data && items.length === 0 && (
        <div className="empty-state">
          <Check size={36} />
          <h2>All caught up</h2>
          <p>No uncompleted lectures or open exercises {focus ? `in ${focus.name}` : 'in this semester'}.</p>
        </div>
      )}

      <div className="outstanding-list">
        {groups.map(([date, items]) => (
          <section key={date} className={`day-group ${date < today ? 'past' : date === today ? 'today' : ''}`}>
            <h3>{dayHeading(date, today)}</h3>
            {items.map((item) => {
              if (item.kind === 'lecture') {
                const o = item.occurrence;
                const s = subjectById.get(o.subjectId);
                return (
                  <div key={`l${o.lectureId}-${o.weekStart}`} className="out-item" style={{ '--c': s?.color } as CSSProperties}>
                    <button className="check-btn" onClick={() => completeLecture(item)} title="Mark lecture as completed">
                      <Check size={14} />
                    </button>
                    <div className="out-main">
                      <div className="out-title">
                        <span className="kind-tag">Lecture</span> {o.title}
                      </div>
                      <div className="out-meta">
                        <span className="subject-dot" /> {s?.name} · {o.startTime}–{o.endTime}
                      </div>
                    </div>
                    <button className="icon-btn" onClick={() => showWeek(o.weekStart)} title="Show in timetable">
                      <Calendar size={15} />
                    </button>
                  </div>
                );
              }
              const e = item.exercise;
              const s = subjectById.get(e.subjectId);
              const late = diffDays(e.deadlineDate, today);
              const left = -late;
              return (
                <div key={`e${e.id}`} className={`out-item ${item.overdue ? 'overdue' : ''}`} style={{ '--c': s?.color } as CSSProperties}>
                  <select
                    className={`status-select status-${e.status}`}
                    value={exerciseStage(e)}
                    onChange={(ev) => void progress.setStage(e, ev.target.value as ExerciseStage)}
                    title="Status — choose “Handed in” once it's submitted"
                  >
                    {EXERCISE_STAGES.map((st) => (
                      <option key={st} value={st}>
                        {EXERCISE_STAGE_LABEL[st]}
                      </option>
                    ))}
                  </select>
                  <div
                    className="out-main clickable"
                    onClick={() => ui.dialog((close) => <ExerciseDialog semester={semester} subjects={subjects} exerciseId={e.id} close={close} />)}
                  >
                    <div className="out-title">
                      <span className="kind-tag">Exercise</span> {e.title}
                    </div>
                    <div className="out-meta">
                      <span className="subject-dot" /> {s?.name} · planned{' '}
                      {e.plannedDates
                        .slice(0, 3)
                        .map((d) => formatDate(d, { weekday: true }))
                        .join(', ')}
                      {e.plannedDates.length > 3 && ` +${e.plannedDates.length - 3} more`} ·{' '}
                      <Flag size={11} /> due {formatDate(e.deadlineDate, { weekday: true })}
                      {e.checklist.length > 0 && e.status !== 'completed' && (
                        <>
                          {' · '}
                          <ChecklistProgress exercise={e} compact />
                        </>
                      )}
                    </div>
                  </div>
                  {item.overdue ? (
                    <span className="badge badge-danger">
                      <Alert size={12} /> Overdue · {plural(late, 'day')}
                    </span>
                  ) : left <= 2 ? (
                    <span className="badge badge-warn">{left === 0 ? 'Due today' : left === 1 ? 'Due tomorrow' : 'Due in 2 days'}</span>
                  ) : (
                    <span className="badge">Due in {plural(left, 'day')}</span>
                  )}
                  <button className="icon-btn" onClick={() => showWeek(startOfWeek(e.plannedDate))} title="Show in timetable">
                    <Calendar size={15} />
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      {items.length > 0 && <p className="muted small list-foot">Lectures are listed from the day they take place until you mark them completed.</p>}
    </div>
  );
}
