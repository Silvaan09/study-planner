import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { api } from '../api';
import { useLoad, useUi } from '../ui';
import { useActions } from '../actions';
import {
  addDays,
  diffDays,
  formatDate,
  formatWeekRange,
  isoWeekNumber,
  isValidISODate,
  minutesToTime,
  startOfWeek,
  timeToMinutes,
  todayISO,
  weeksBetween,
  weekday,
  WEEKDAY_SHORT,
  type ISODate,
} from '../../shared/dates';
import { EXERCISE_STATUS_LABEL, type Exercise, type ExerciseStatus, type LectureOccurrence, type Semester } from '../../shared/types';
import { ExerciseDialog, LectureDialog } from '../dialogs';
import { ContextMenu, type MenuState } from '../components/ContextMenu';
import { Check, ChevronLeft, ChevronRight, Flag, Pencil, Plus, Repeat, StatusIcon, Trash } from '../components/Icons';

const HOUR_PX = 64;
const NEXT_STATUS: Record<ExerciseStatus, ExerciseStatus> = { not_started: 'in_progress', in_progress: 'completed', completed: 'not_started' };

interface Positioned {
  occ: LectureOccurrence;
  start: number;
  end: number;
  col: number;
  cols: number;
}

/** Places overlapping lectures side by side. */
function layoutDay(lectures: LectureOccurrence[]): Positioned[] {
  const items = lectures
    .map((occ) => ({ occ, start: timeToMinutes(occ.startTime), end: timeToMinutes(occ.endTime), col: 0, cols: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: Positioned[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const p of items) {
    if (p.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= p.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(p.end);
    } else colEnds[col] = p.end;
    p.col = col;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.end);
  }
  flush();
  return items;
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function TimetableView({
  semester,
  weekStart,
  setWeekStart,
}: {
  semester: Semester;
  weekStart: ISODate;
  setWeekStart: (w: ISODate) => void;
}) {
  const ui = useUi();
  const actions = useActions();
  const now = useNow();
  const today = todayISO(now);
  const { data } = useLoad(() => api.getWeek(semester.id, weekStart), [semester.id, weekStart]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // The exercise being dragged and which of its planned dates is being moved.
  const [dragging, setDragging] = useState<{ e: Exercise; from: ISODate } | null>(null);
  const [dropDay, setDropDay] = useState<ISODate | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const subjects = data?.subjects ?? [];
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const semWeeks = useMemo(() => weeksBetween(semester.startDate, semester.endDate), [semester]);
  const weekIndex = semWeeks.indexOf(weekStart);

  // Visible hours: 07:00–21:00 by default (last row starts at 20:00), widened to fit this week's lectures.
  const [firstHour, lastHour] = useMemo(() => {
    let lo = 7 * 60;
    let hi = 21 * 60;
    for (const l of data?.lectures ?? []) {
      lo = Math.min(lo, timeToMinutes(l.startTime));
      hi = Math.max(hi, timeToMinutes(l.endTime));
    }
    return [Math.floor(lo / 60), Math.min(24, Math.ceil(hi / 60))];
  }, [data]);

  // Scroll so the first lecture (or 08:00) is in view when the week changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !data) return;
    const earliest = Math.min(...data.lectures.map((l) => timeToMinutes(l.startTime)), 8 * 60);
    el.scrollTop = Math.max(0, ((earliest - firstHour * 60) / 60) * HOUR_PX - 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, data !== undefined]);

  // Keyboard: ← → switch weeks, T = today.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (t instanceof Element && t.closest('input, textarea, select, .modal')) return;
      if (document.querySelector('.modal')) return;
      if (e.key === 'ArrowLeft') setWeekStart(addDays(weekStart, -7));
      else if (e.key === 'ArrowRight') setWeekStart(addDays(weekStart, 7));
      else if (e.key.toLowerCase() === 't') setWeekStart(startOfWeek(todayISO()));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [weekStart, setWeekStart]);

  const openExercise = useCallback(
    (id: number) => ui.dialog((close) => <ExerciseDialog semester={semester} subjects={subjects} exerciseId={id} close={close} />),
    [ui, semester, subjects],
  );
  const newExercise = (plannedDate?: ISODate) =>
    ui.dialog((close) => <ExerciseDialog semester={semester} subjects={subjects} defaults={{ plannedDate: plannedDate ?? defaultPlannedDate(weekStart, today) }} close={close} />);
  const newLecture = (weekday?: number, startMin?: number) =>
    ui.dialog((close) => (
      <LectureDialog
        subjects={subjects}
        defaults={
          weekday
            ? { weekday, startTime: minutesToTime(startMin!), endTime: minutesToTime(Math.min(startMin! + 120, 23 * 60 + 59)) }
            : undefined
        }
        close={close}
      />
    ));

  const toggleLecture = (o: LectureOccurrence) => ui.run(() => api.setLectureCompleted(o.lectureId, o.weekStart, !o.completed));
  const cycleStatus = (e: Exercise) => ui.run(() => api.setExerciseStatus(e.id, NEXT_STATUS[e.status]));

  const lectureMenu = (ev: React.MouseEvent, o: LectureOccurrence) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { label: o.completed ? 'Mark as not completed' : 'Mark as completed', icon: <Check size={14} />, onSelect: () => toggleLecture(o) },
        {
          label: 'Edit lecture…',
          icon: <Pencil size={14} />,
          onSelect: () => ui.dialog((close) => <LectureDialog subjects={subjects} lectureId={o.lectureId} weekStart={o.weekStart} close={close} />),
        },
        'separator',
        {
          label: 'Delete…',
          icon: <Trash size={14} />,
          danger: true,
          onSelect: async () => actions.deleteLecture(await api.getLecture(o.lectureId), o.weekStart),
        },
      ],
    });
  };

  const exerciseMenu = (ev: React.MouseEvent, e: Exercise) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        ...(['not_started', 'in_progress', 'completed'] as ExerciseStatus[]).map((s) => ({
          label: EXERCISE_STATUS_LABEL[s],
          icon: <StatusIcon status={s} size={14} />,
          disabled: e.status === s,
          onSelect: () => ui.run(() => api.setExerciseStatus(e.id, s)),
        })),
        'separator' as const,
        { label: 'Edit…', icon: <Pencil size={14} />, onSelect: () => openExercise(e.id) },
        { label: 'Delete…', icon: <Trash size={14} />, danger: true, onSelect: () => actions.deleteExercise(e) },
      ],
    });
  };

  // ---- drag & drop of planned exercises between days
  const canDrop = (day: ISODate) => dragging !== null && day <= dragging.e.deadlineDate;
  const dropProps = (day: ISODate) => ({
    onDragOver: (ev: DragEvent) => {
      if (!dragging) return;
      if (canDrop(day)) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
      }
      if (dropDay !== day) setDropDay(day);
    },
    onDragLeave: (ev: DragEvent) => {
      if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) setDropDay((d) => (d === day ? null : d));
    },
    onDrop: (ev: DragEvent) => {
      ev.preventDefault();
      const drag = dragging;
      setDragging(null);
      setDropDay(null);
      if (!drag || drag.from === day) return;
      const ex = drag.e;
      if (day > ex.deadlineDate) {
        ui.toast(`"${ex.title}" is due ${formatDate(ex.deadlineDate, { weekday: true })} — it can't be planned after its deadline.`, { kind: 'error' });
        return;
      }
      const merged = ex.plannedDates.includes(day);
      void ui.run(async () => {
        await api.moveExercise(ex.id, drag.from, day);
        if (merged) {
          ui.toast(`"${ex.title}" was already planned for ${formatDate(day, { weekday: true })} — the two sessions were combined`, { kind: 'success' });
        } else {
          ui.toast(`Planned "${ex.title}" for ${formatDate(day, { weekday: true })}`, {
            kind: 'success',
            action: { label: 'Undo', run: () => void ui.run(() => api.moveExercise(ex.id, day, drag.from)) },
          });
        }
      });
    },
  });
  const dayClass = (day: ISODate) =>
    [
      day === today && 'today',
      weekday(day) >= 6 && 'weekend',
      (day < semester.startDate || day > semester.endDate) && 'outside',
      dragging && (canDrop(day) ? 'drop-ok' : 'drop-no'),
      dragging && dropDay === day && 'drop-hover',
    ]
      .filter(Boolean)
      .join(' ');

  const lecturesByDay = useMemo(() => {
    const m = new Map<ISODate, Positioned[]>();
    for (const d of days) m.set(d, layoutDay((data?.lectures ?? []).filter((l) => l.date === d)));
    return m;
  }, [data, days]);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  // Days with lectures side by side get wider so each lecture stays readable; empty days give up some width.
  const dayColumns = days
    .map((d) => {
      const cols = Math.max(0, ...lecturesByDay.get(d)!.map((p) => p.cols));
      const hasExercises = (data?.exercises ?? []).some((e) => e.plannedDates.includes(d) || e.deadlineDate === d);
      const weight = cols === 0 && !hasExercises ? 0.7 : cols <= 1 ? 1 : cols === 2 ? 1.6 : 2.2;
      return `minmax(0, ${weight}fr)`;
    })
    .join(' ');
  const gridStyle = { '--hour': `${HOUR_PX}px`, '--days': dayColumns } as CSSProperties;

  const colorOf = (subjectId: number) => subjectById.get(subjectId)?.color ?? '#888';
  const subjectName = (subjectId: number) => subjectById.get(subjectId)?.name ?? '';

  const weekStats = useMemo(() => {
    const lectures = data?.lectures ?? [];
    const weekEnd = addDays(weekStart, 6);
    const planned = (data?.exercises ?? []).filter((e) => e.plannedDates.some((p) => p >= weekStart && p <= weekEnd));
    return {
      lecturesDone: lectures.filter((l) => l.completed).length,
      lectures: lectures.length,
      exercisesDone: planned.filter((e) => e.status === 'completed').length,
      exercises: planned.length,
    };
  }, [data, weekStart]);

  return (
    <div className="timetable-view">
      <header className="view-header">
        <div className="week-nav">
          <button className="icon-btn bordered" onClick={() => setWeekStart(addDays(weekStart, -7))} title="Previous week (←)">
            <ChevronLeft />
          </button>
          <button className="btn" onClick={() => setWeekStart(startOfWeek(today))} title="Current week (T)" disabled={weekStart === startOfWeek(today)}>
            Today
          </button>
          <button className="icon-btn bordered" onClick={() => setWeekStart(addDays(weekStart, 7))} title="Next week (→)">
            <ChevronRight />
          </button>
        </div>
        <div className="week-title">
          <h1>{formatWeekRange(weekStart)}</h1>
          <div className="week-sub">
            {weekIndex >= 0 ? `Semester week ${weekIndex + 1} of ${semWeeks.length}` : 'Outside the semester'} · Calendar week {isoWeekNumber(weekStart)}
          </div>
        </div>
        <div className="week-jump">
          <select
            className="input compact"
            value={weekIndex >= 0 ? weekStart : ''}
            onChange={(e) => e.target.value && setWeekStart(e.target.value)}
            title="Jump to semester week"
          >
            {weekIndex < 0 && <option value="">Jump to week…</option>}
            {semWeeks.map((w, i) => (
              <option key={w} value={w}>
                Week {i + 1} · {formatDate(w)}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="input compact"
            title="Go to date"
            value=""
            onChange={(e) => isValidISODate(e.target.value) && setWeekStart(startOfWeek(e.target.value))}
          />
        </div>
        <span className="spacer" />
        <div className="week-stats" title="Completed this week">
          <span>
            <strong>{weekStats.lecturesDone}</strong>/{weekStats.lectures} lectures
          </span>
          <span>
            <strong>{weekStats.exercisesDone}</strong>/{weekStats.exercises} exercises
          </span>
        </div>
        <button className="btn" onClick={() => newLecture()}>
          <Plus size={15} /> Lecture
        </button>
        <button className="btn btn-primary" onClick={() => newExercise()}>
          <Plus size={15} /> Exercise
        </button>
      </header>

      {subjects.length === 0 && data && (
        <div className="empty-hint">
          This semester has no subjects yet. Add subjects in <strong>Subjects</strong>, then create lectures and exercises.
        </div>
      )}

      <div className={`timetable ${dragging ? 'is-dragging' : ''}`} style={gridStyle}>
        {/* One scroll container for all rows, so every row has the same width and the day lines align. */}
        <div className="tt-scroll" ref={scrollRef}>
        <div className="tt-sticky">
        {/* Day headers */}
        <div className="tt-row tt-head">
          <div className="tt-gutter" />
          {days.map((d, i) => (
            <div key={d} className={`tt-day-head ${dayClass(d)}`} {...dropProps(d)}>
              <span className="dow">{WEEKDAY_SHORT[i]}</span>
              <span className="dom">{+d.slice(8)}</span>
              {d.slice(8) === '01' || i === 0 ? <span className="mon">{formatDate(d).split(' ')[1]}</span> : null}
            </div>
          ))}
        </div>

        {/* Planned exercises */}
        <div className="tt-row tt-band tt-planned">
          <div className="tt-gutter band-label" title="Exercises planned for this day">
            <span>To do</span>
          </div>
          {days.map((d) => {
            const list = (data?.exercises ?? []).filter((e) => e.plannedDates.includes(d));
            return (
              <div key={d} className={`tt-cell ${dayClass(d)}`} {...dropProps(d)} onDoubleClick={() => newExercise(d)}>
                {list.map((e) => {
                  const overdue = e.status !== 'completed' && e.deadlineDate < today;
                  const dueIn = diffDays(d, e.deadlineDate);
                  const sessions = e.plannedDates.length;
                  const session = e.plannedDates.indexOf(d) + 1;
                  return (
                    <div
                      key={e.id}
                      className={`ex-chip planned status-${e.status} ${overdue ? 'overdue' : ''} ${dragging?.e.id === e.id && dragging.from === d ? 'dragging' : ''}`}
                      style={{ '--c': colorOf(e.subjectId) } as CSSProperties}
                      draggable
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData('text/plain', String(e.id));
                        ev.dataTransfer.effectAllowed = 'move';
                        setDragging({ e, from: d });
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropDay(null);
                      }}
                      onClick={() => openExercise(e.id)}
                      onContextMenu={(ev) => exerciseMenu(ev, e)}
                      title={`${e.title} (${subjectName(e.subjectId)}) — ${EXERCISE_STATUS_LABEL[e.status]}\nDeadline: ${formatDate(e.deadlineDate, { weekday: true, year: true })}${sessions > 1 ? `\nPlanned on ${sessions} days: ${e.plannedDates.map((p) => formatDate(p, { weekday: true })).join(', ')}` : ''}\nDrag to another day to move this session.`}
                    >
                      <button
                        className="status-btn"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void cycleStatus(e);
                        }}
                        title={`${EXERCISE_STATUS_LABEL[e.status]} — click to change`}
                      >
                        <StatusIcon status={e.status} size={15} />
                      </button>
                      <div className="ex-text">
                        <span className="ex-subject">{subjectName(e.subjectId)}</span>
                        <span className="ex-title">
                          {e.seriesId !== null && <Repeat size={11} className="series-icon" />}
                          {e.title}
                        </span>
                        <span className={`ex-meta ${overdue ? 'danger' : ''}`}>
                          {sessions > 1 && `Session ${session} of ${sessions} · `}
                          {overdue
                            ? `Overdue since ${formatDate(e.deadlineDate, { weekday: true })}`
                            : dueIn === 0
                              ? 'Due the same day'
                              : `Due ${formatDate(e.deadlineDate, { weekday: dueIn < 7 })}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {dragging && dropDay === d && !canDrop(d) && <div className="drop-note">After the deadline</div>}
              </div>
            );
          })}
        </div>

        {/* Deadlines */}
        <div className="tt-row tt-band tt-due">
          <div className="tt-gutter band-label" title="Hand-in deadlines on this day">
            <span>Due</span>
          </div>
          {days.map((d) => {
            const list = (data?.exercises ?? []).filter((e) => e.deadlineDate === d);
            return (
              <div key={d} className={`tt-cell ${dayClass(d)}`} {...dropProps(d)}>
                {list.map((e) => {
                  const overdue = e.status !== 'completed' && d < today;
                  return (
                    <button
                      key={e.id}
                      className={`ex-chip due status-${e.status} ${overdue ? 'overdue' : ''}`}
                      style={{ '--c': colorOf(e.subjectId) } as CSSProperties}
                      onClick={() => openExercise(e.id)}
                      onContextMenu={(ev) => exerciseMenu(ev, e)}
                      title={`Deadline: ${e.title} (${subjectName(e.subjectId)}) — ${EXERCISE_STATUS_LABEL[e.status]}\nPlanned for ${e.plannedDates.map((p) => formatDate(p, { weekday: true })).join(', ')}`}
                    >
                      {e.status === 'completed' ? <Check size={13} /> : <Flag size={13} />}
                      <span className="ex-text">
                        <span className="ex-subject">{subjectName(e.subjectId)}</span>
                        <span className="ex-title">{e.title}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        </div>

        {/* Time grid */}
          <div className="tt-row tt-grid" style={{ height: hours.length * HOUR_PX }}>
            <div className="tt-gutter tt-hours">
              {hours.map((h) => (
                <div key={h} className="hour-label" style={{ top: (h - firstHour) * HOUR_PX }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            {days.map((d, i) => (
              <div
                key={d}
                className={`tt-col ${dayClass(d)}`}
                {...dropProps(d)}
                onDoubleClick={(ev) => {
                  const y = ev.clientY - (ev.currentTarget as HTMLElement).getBoundingClientRect().top;
                  newLecture(i + 1, Math.min(22 * 60, firstHour * 60 + Math.floor(y / HOUR_PX) * 60));
                }}
              >
                {hours.map((h) => (
                  <div key={h} className="hour-line" style={{ top: (h - firstHour) * HOUR_PX }} />
                ))}
                {lecturesByDay.get(d)!.map((p) => {
                  const o = p.occ;
                  const past = o.date < today || (o.date === today && timeToMinutes(o.endTime) <= nowMin);
                  const top = ((p.start - firstHour * 60) / 60) * HOUR_PX;
                  const height = Math.max(22, ((p.end - p.start) / 60) * HOUR_PX - 2);
                  return (
                    <button
                      key={o.lectureId}
                      className={`lecture ${o.completed ? 'completed' : past ? 'missed' : ''} ${height < 40 ? 'short' : ''} ${p.cols > 1 ? 'narrow' : ''}`}
                      style={
                        {
                          '--c': colorOf(o.subjectId),
                          '--h': `${height}px`,
                          top,
                          left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                          width: `calc(${100 / p.cols}% - 4px)`,
                        } as CSSProperties
                      }
                      onClick={() => toggleLecture(o)}
                      onDoubleClick={(ev) => ev.stopPropagation()}
                      onContextMenu={(ev) => lectureMenu(ev, o)}
                      title={`${o.title} (${subjectName(o.subjectId)})\n${o.startTime}–${o.endTime}\n${o.completed ? 'Completed' : 'Not completed'} — click to toggle, right-click for more`}
                    >
                      <span className="lec-body">
                        <span className="lec-check">{o.completed ? <Check size={12} /> : null}</span>
                        <span className="lec-title">{o.title}</span>
                        <span className="lec-meta">
                          {o.startTime}–{o.endTime}
                        </span>
                        <span className="lec-meta">{subjectName(o.subjectId)}</span>
                      </span>
                      <span
                        className="lec-more"
                        role="button"
                        title="More"
                        onClick={(ev) => lectureMenu(ev, o)}
                      >
                        ⋯
                      </span>
                    </button>
                  );
                })}
                {d === today && nowMin >= firstHour * 60 && nowMin <= lastHour * 60 && (
                  <div className="now-line" style={{ top: ((nowMin - firstHour * 60) / 60) * HOUR_PX }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function defaultPlannedDate(weekStart: ISODate, today: ISODate): ISODate {
  // New exercises default to today when viewing the current week, otherwise the week's Monday.
  return today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart;
}

