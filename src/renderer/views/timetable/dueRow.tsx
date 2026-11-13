import type { CSSProperties } from 'react';
import { formatDate } from '../../../shared/dates';
import { deadlineOnly, EXERCISE_STAGE_LABEL, examTitle, exerciseStage } from '../../../shared/types';
import { examTime } from '../../components/ExamRow';
import { Check, Flag, GraduationCap } from '../../components/Icons';
import type { WeekLayout } from './layout';
import type { WeekContext } from './weekContext';

/** A week's "Due" row: exams first, then one card per deadline (flag = handed in; drag to move the deadline). */
export function renderDueRow(L: WeekLayout, ctx: WeekContext) {
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
    examMenu,
    openExercise,
    openExam,
    newDeadline,
    toggleHandedIn,
  } = ctx;
  return (
    <div className="tt-row tt-band tt-due">
      <div className="tt-gutter band-label" title="Exams and hand-in deadlines on this day">
        <span>Due</span>
      </div>
      {L.days.map((d) => {
        const list = (L.week?.exercises ?? []).filter((e) => e.deadlineDate === d);
        const exams = (L.week?.exams ?? []).filter((x) => x.date === d);
        return (
          <div
            key={d}
            className={`tt-cell ${dayClass(d, L.week)}`}
            {...dropProps(d)}
            onDoubleClick={(ev) => {
              // Empty space only (see the "To do" row): a new exercise with only this deadline.
              const target = ev.target as Element;
              if (!ev.currentTarget.contains(target) || target.closest('.ex-chip')) return;
              newDeadline(d);
            }}
          >
            {exams.map((x) => {
              const time = examTime(x);
              return (
                <div
                  key={`exam${x.id}`}
                  role="button"
                  tabIndex={0}
                  className={`ex-chip exam ${d < today ? 'past' : ''} ${dim(x.subjectId)}`}
                  style={{ '--c': colorOf(x.subjectId) } as CSSProperties}
                  onClick={() => openExam(x.id)}
                  onKeyDown={(ev) => ev.key === 'Enter' && openExam(x.id)}
                  onContextMenu={(ev) => examMenu(ev, x)}
                  title={`${examTitle(x)} (${subjectName(x.subjectId)})${time ? `\n${time}` : ''}${x.location ? `\nRoom: ${x.location}` : ''}`}
                >
                  <GraduationCap size={14} className="exam-icon" />
                  <span className="ex-text">
                    <span className="ex-subject">{subjectName(x.subjectId)}</span>
                    <span className="ex-title">{examTitle(x)}</span>
                    {(time || x.location) && <span className="ex-meta">{[time, x.location].filter(Boolean).join(' · ')}</span>}
                  </span>
                </div>
              );
            })}
            {list.map((e) => {
              const overdue = !e.handedIn && d < today;
              const ready = !e.handedIn && e.status === 'completed';
              return (
                <div
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  className={`ex-chip due ${e.handedIn ? 'handed-in' : ready ? 'ready' : ''} ${overdue ? 'overdue' : ''} ${dragging?.kind === 'deadline' && dragging.e.id === e.id ? 'dragging' : ''} ${dim(e.subjectId)}`}
                  style={{ '--c': colorOf(e.subjectId) } as CSSProperties}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('text/plain', String(e.id));
                    ev.dataTransfer.effectAllowed = 'move';
                    setDragging({ e, from: d, kind: 'deadline' });
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropDay(null);
                  }}
                  onClick={() => openExercise(e.id)}
                  onKeyDown={(ev) => ev.key === 'Enter' && openExercise(e.id)}
                  onContextMenu={(ev) => exerciseMenu(ev, e)}
                  title={`Deadline: ${e.title} (${subjectName(e.subjectId)}) — ${EXERCISE_STAGE_LABEL[exerciseStage(e)]}\n${deadlineOnly(e) ? 'Deadline only, no days planned to work on it' : `Planned for ${e.plannedDates.map((p) => formatDate(p, { weekday: true })).join(', ')}`}`}
                >
                  <button
                    className="due-check"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void toggleHandedIn(e);
                    }}
                    title={e.handedIn ? 'Handed in — click to take back' : 'Click to mark as handed in'}
                  >
                    {e.handedIn ? <Check size={13} /> : <Flag size={13} />}
                  </button>
                  <span className="ex-text">
                    <span className="ex-subject">{subjectName(e.subjectId)}</span>
                    <span className="ex-title">{e.title}</span>
                    {ready && <span className="ex-meta">Done · ready to hand in</span>}
                  </span>
                </div>
              );
            })}
            {dragging?.kind === 'deadline' && dropDay === d && !canDrop(d) && <div className="drop-note">Before a planned day</div>}
          </div>
        );
      })}
    </div>
  );
}
