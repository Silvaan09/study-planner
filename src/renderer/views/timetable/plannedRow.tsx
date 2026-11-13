import type { CSSProperties } from 'react';
import { diffDays, formatDate } from '../../../shared/dates';
import { EXERCISE_STATUS_LABEL, exerciseDueBy } from '../../../shared/types';
import { ChecklistProgress } from '../../components/Checklist';
import { Repeat, StatusIcon } from '../../components/Icons';
import type { WeekLayout } from './layout';
import type { WeekContext } from './weekContext';

/** A week's "To do" row: one card per planned session (status circle, checklist button; drag to move the session). */
export function renderPlannedRow(L: WeekLayout, ctx: WeekContext) {
  const {
    today,
    dayClass,
    dropProps,
    canDrop,
    dragging,
    setDragging,
    dropDay,
    setDropDay,
    colorOf,
    subjectName,
    dim,
    exerciseMenu,
    cardStatus,
    cycleStatus,
    openExercise,
    newExercise,
    checklistFor,
    setChecklistFor,
  } = ctx;
  return (
    <div className="tt-row tt-band tt-planned">
      <div className="tt-gutter band-label" title="Exercises planned for this day">
        <span>To do</span>
      </div>
      {L.days.map((d) => {
        const list = (L.week?.exercises ?? []).filter((e) => e.plannedDates.includes(d));
        return (
          <div
            key={d}
            className={`tt-cell ${dayClass(d, L.week)}`}
            {...dropProps(d)}
            onDoubleClick={(ev) => {
              // Only empty space creates an exercise: double clicks on a card (e.g. quickly cycling its
              // status circle twice) or inside something portaled from the cell don't.
              const target = ev.target as Element;
              if (!ev.currentTarget.contains(target) || target.closest('.ex-chip')) return;
              newExercise(d);
            }}
          >
            {list.map((e) => {
              // This card is one session: its own progress, not the exercise's.
              const status = cardStatus(e, d);
              const overdue = status !== 'completed' && e.status !== 'completed' && exerciseDueBy(e) < today;
              const dueIn = e.deadlineDate === null ? null : diffDays(d, e.deadlineDate);
              const sessions = e.plannedDates.length;
              const session = e.plannedDates.indexOf(d) + 1;
              const sessionsDone = e.sessions.filter((x) => x.status === 'completed').length;
              return (
                <div
                  key={e.id}
                  className={`ex-chip planned status-${status} ${overdue ? 'overdue' : ''} ${dragging?.kind === 'planned' && dragging.e.id === e.id && dragging.from === d ? 'dragging' : ''} ${dim(e.subjectId)}`}
                  style={{ '--c': colorOf(e.subjectId) } as CSSProperties}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('text/plain', String(e.id));
                    ev.dataTransfer.effectAllowed = 'move';
                    setDragging({ e, from: d, kind: 'planned' });
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropDay(null);
                  }}
                  onClick={() => openExercise(e.id)}
                  onContextMenu={(ev) => exerciseMenu(ev, e, d)}
                  title={`${e.title} (${subjectName(e.subjectId)}) — ${sessions > 1 ? `session ${session} of ${sessions}: ${EXERCISE_STATUS_LABEL[status]} (${sessionsDone} of ${sessions} done)` : EXERCISE_STATUS_LABEL[status]}\nDeadline: ${e.deadlineDate ? formatDate(e.deadlineDate, { weekday: true, year: true }) : 'none'}${sessions > 1 ? `\nPlanned on ${sessions} days: ${e.plannedDates.map((p) => formatDate(p, { weekday: true })).join(', ')}` : ''}`}
                >
                  <button
                    className="status-btn"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void cycleStatus(e, d);
                    }}
                    title={`${EXERCISE_STATUS_LABEL[status]} — click to change${sessions > 1 ? ' (this session only)' : ''}`}
                  >
                    <StatusIcon status={status} size={15} />
                  </button>
                  <div className="ex-text">
                    <span className="ex-subject">{subjectName(e.subjectId)}</span>
                    <span className="ex-title">
                      {e.seriesId !== null && <Repeat size={11} className="series-icon" />}
                      {e.title}
                    </span>
                    <span className={`ex-meta ${overdue ? 'danger' : ''}`}>
                      {sessions > 1 && `Session ${session} of ${sessions} · `}
                      {e.deadlineDate === null
                        ? overdue
                          ? `Overdue · was planned ${formatDate(exerciseDueBy(e), { weekday: true })}`
                          : 'No deadline'
                        : overdue
                          ? `Overdue since ${formatDate(e.deadlineDate, { weekday: true })}`
                          : dueIn === 0
                            ? 'Due the same day'
                            : `Due ${formatDate(e.deadlineDate, { weekday: dueIn! < 7 })}`}
                    </span>
                    {e.checklist.length > 0 && e.status !== 'completed' && (
                      <button
                        className="cl-btn"
                        title="Show checklist"
                        aria-haspopup="dialog"
                        aria-expanded={checklistFor?.id === e.id}
                        draggable={false}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          const anchor = ev.currentTarget;
                          setChecklistFor((c) => (c?.anchor === anchor ? null : { id: e.id, anchor }));
                        }}
                      >
                        <ChecklistProgress exercise={e} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {dragging?.kind === 'planned' && dropDay === d && !canDrop(d) && <div className="drop-note">After the deadline</div>}
          </div>
        );
      })}
    </div>
  );
}
