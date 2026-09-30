import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { api } from '../api';
import { useLoad, useNow, useUi } from '../ui';
import { useActions, useChecklistToggle, useExerciseProgress, useWeekCompletion } from '../actions';
import {
  addDays,
  diffDays,
  formatDate,
  formatWeekRange,
  isoWeekNumber,
  minutesToTime,
  startOfWeek,
  timeToMinutes,
  todayISO,
  weeksBetween,
  weekday,
  WEEKDAY_SHORT,
  type ISODate,
} from '../../shared/dates';
import { weekProgress } from '../../shared/progress';
import {
  EXERCISE_STAGES,
  EXERCISE_STAGE_LABEL,
  EXERCISE_STATUS_LABEL,
  examTitle,
  exerciseStage,
  type Exam,
  type Exercise,
  type ExerciseStatus,
  type LectureOccurrence,
  type Semester,
  type Subject,
} from '../../shared/types';
import { ExamDialog, ExerciseDialog, LectureDialog } from '../dialogs';
import { ContextMenu, type MenuState } from '../components/ContextMenu';
import { WeekPicker } from '../components/WeekPicker';
import { FocusPill } from '../components/FocusPill';
import { DatePopover } from '../components/DatePicker';
import { ChecklistPopover, ChecklistProgress } from '../components/Checklist';
import { examTime } from '../components/ExamRow';
import { bestTopMinute } from '../timetableScroll';
import { Calendar, Check, ChevronLeft, ChevronRight, Flag, GraduationCap, Info, Pencil, Plus, Repeat, StatusIcon, Trash } from '../components/Icons';

const HOUR_PX = 64;
/** Width of the right-hand edge zone that switches to the next week while dragging. */
const EDGE_PX = 32;
/** How long a dragged card has to stay at an edge before the week switches (and again for each further week). */
const EDGE_DWELL_MS = 700;
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

export function TimetableView({
  semester,
  weekStart,
  setWeekStart,
  focus,
  clearFocus,
}: {
  semester: Semester;
  weekStart: ISODate;
  setWeekStart: (w: ISODate) => void;
  /** Subject picked in the sidebar; everything else is greyed out. */
  focus: Subject | null;
  clearFocus: () => void;
}) {
  const ui = useUi();
  const actions = useActions();
  const completing = useWeekCompletion(semester.id);
  const now = useNow();
  const today = todayISO(now);
  const { data } = useLoad(() => api.getWeek(semester.id, weekStart), [semester.id, weekStart]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // The exercise being dragged and which of its planned dates is being moved.
  const [dragging, setDragging] = useState<{ e: Exercise; from: ISODate } | null>(null);
  const [dropDay, setDropDay] = useState<ISODate | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dateBtnRef = useRef<HTMLButtonElement>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  const closeJump = useCallback((refocus: boolean) => {
    setJumpOpen(false);
    if (refocus) dateBtnRef.current?.focus();
  }, []);
  const stickyRef = useRef<HTMLDivElement>(null);
  // Checklist popup of a planned card: which exercise, and the card's progress button it hangs from.
  const [checklistFor, setChecklistFor] = useState<{ id: number; anchor: HTMLElement } | null>(null);
  const closeChecklist = useCallback(() => setChecklistFor(null), []);
  const toggleStep = useChecklistToggle(semester.id);
  const progress = useExerciseProgress(semester.id);

  // The week on screen: the loaded one. Until a newly picked week has loaded, the previous week stays up
  // as a whole — rendering its data against the new week's days would show an empty grid for a frame.
  // Navigation (buttons, keys) still steps from `weekStart`, so quick repeated clicks add up.
  const shownWeek = data?.weekStart ?? weekStart;
  const subjects = data?.subjects ?? [];
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(shownWeek, i)), [shownWeek]);
  const semWeeks = useMemo(() => weeksBetween(semester.startDate, semester.endDate), [semester]);
  const weekIndex = semWeeks.indexOf(shownWeek);

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

  // Once the new week's lectures are loaded, scroll so that as many of them as possible are fully visible
  // (starting at 08:00 whenever that shows them all). Only on week change, not on every data refresh.
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const key = `${semester.id}:${weekStart}`;
    if (!el || !data || data.weekStart !== weekStart || scrolledFor.current === key) return;
    scrolledFor.current = key;
    const stickyPx = stickyRef.current?.offsetHeight ?? 0;
    const top = bestTopMinute(
      data.lectures.map((l) => ({ start: timeToMinutes(l.startTime), end: timeToMinutes(l.endTime) })),
      {
        gridStart: firstHour * 60,
        gridEnd: lastHour * 60,
        visible: ((el.clientHeight - stickyPx) / HOUR_PX) * 60,
        preferred: 8 * 60 - 15,
        pad: 15,
      },
    );
    el.scrollTop = ((top - firstHour * 60) / 60) * HOUR_PX;
  }, [data, weekStart, semester.id, firstHour, lastHour]);

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
  const openExam = (id: number) => ui.dialog((close) => <ExamDialog semester={semester} subjects={subjects} examId={id} close={close} />);
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

  const toggleLecture = (o: LectureOccurrence) =>
    ui.run(() => completing(o.completed ? [] : [o.weekStart], () => api.setLectureCompleted(o.lectureId, o.weekStart, !o.completed)));
  /** Status circle on a planned card: the work only; handing in is the deadline card's flag. */
  const cycleStatus = (e: Exercise) => progress.setStatus(e, NEXT_STATUS[e.status]);
  /** Flag on a deadline card: hand the exercise in (which also marks the work done), or take that back. */
  const toggleHandedIn = (e: Exercise) => progress.setHandedIn(e, !e.handedIn);

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
        ...EXERCISE_STAGES.map((s) => ({
          label: EXERCISE_STAGE_LABEL[s],
          icon: <StatusIcon status={s} size={14} />,
          disabled: exerciseStage(e) === s,
          onSelect: () => void progress.setStage(e, s),
        })),
        'separator' as const,
        { label: 'Edit…', icon: <Pencil size={14} />, onSelect: () => openExercise(e.id) },
        { label: 'Delete…', icon: <Trash size={14} />, danger: true, onSelect: () => actions.deleteExercise(e) },
      ],
    });
  };

  const examMenu = (ev: React.MouseEvent, x: Exam) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { label: 'Edit exam…', icon: <Pencil size={14} />, onSelect: () => openExam(x.id) },
        { label: 'Delete…', icon: <Trash size={14} />, danger: true, onSelect: () => actions.deleteExam(x) },
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

  // Holding a dragged card at the left or right edge (left of the day columns / the last EDGE_PX of the
  // timetable) switches to the previous / next week every EDGE_DWELL_MS, so a session can move across weeks.
  const timetableRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<-1 | 0 | 1>(0);
  const [flips, setFlips] = useState(0);
  const weekRef = useRef(weekStart);
  weekRef.current = weekStart;
  const lastOver = useRef(0);
  useEffect(() => {
    if (!dragging) {
      setEdge(0);
      return;
    }
    const onOver = (ev: globalThis.DragEvent) => {
      const box = timetableRef.current?.getBoundingClientRect();
      const firstDay = timetableRef.current?.querySelector('.tt-day-head')?.getBoundingClientRect();
      if (!box || !firstDay) return;
      lastOver.current = performance.now();
      setEdge(ev.clientX < firstDay.left ? -1 : ev.clientX > box.right - EDGE_PX ? 1 : 0);
    };
    // Leaving the window: dragover stops, so don't keep flipping.
    const onLeave = (ev: globalThis.DragEvent) => {
      if (!ev.relatedTarget) setEdge(0);
    };
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    return () => {
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
    };
  }, [dragging]);
  useEffect(() => {
    if (edge === 0) return;
    const timer = window.setInterval(() => {
      if (performance.now() - lastOver.current > 500) return setEdge(0);
      setWeekStart(addDays(weekRef.current, 7 * edge));
      setDropDay(null);
      setFlips((n) => n + 1);
    }, EDGE_DWELL_MS);
    return () => window.clearInterval(timer);
  }, [edge, setWeekStart]);
  // Once the week has changed, the dragged card is no longer in the page, so its dragend never arrives.
  // No mouse events fire during a drag, so the first mouse move afterwards means the drag is over.
  useEffect(() => {
    if (!dragging || flips === 0) return;
    const end = () => {
      setDragging(null);
      setDropDay(null);
    };
    window.addEventListener('mousemove', end, { once: true });
    window.addEventListener('mousedown', end, { once: true });
    return () => {
      window.removeEventListener('mousemove', end);
      window.removeEventListener('mousedown', end);
    };
  }, [dragging, flips]);
  useEffect(() => {
    if (!dragging) setFlips(0);
  }, [dragging]);

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
      const hasExercises =
        (data?.exercises ?? []).some((e) => e.plannedDates.includes(d) || e.deadlineDate === d) || (data?.exams ?? []).some((x) => x.date === d);
      const weight = cols === 0 && !hasExercises ? 0.7 : cols <= 1 ? 1 : cols === 2 ? 1.6 : 2.2;
      return `minmax(0, ${weight}fr)`;
    })
    .join(' ');
  const gridStyle = { '--hour': `${HOUR_PX}px`, '--days': dayColumns } as CSSProperties;

  const colorOf = (subjectId: number) => subjectById.get(subjectId)?.color ?? '#888';
  const subjectName = (subjectId: number) => subjectById.get(subjectId)?.name ?? '';
  const dim = (subjectId: number) => (focus && subjectId !== focus.id ? 'dimmed' : '');

  const weekStats = useMemo(
    () => (data ? weekProgress(data) : { lectures: 0, lecturesDone: 0, exercises: 0, exercisesDone: 0, exercisesInProgress: 0 }),
    [data],
  );

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
          <h1>{formatWeekRange(shownWeek)}</h1>
          <div className="week-sub">
            {weekIndex >= 0 ? `Semester week ${weekIndex + 1} of ${semWeeks.length}` : 'Outside the semester'} · Calendar week {isoWeekNumber(shownWeek)}
          </div>
        </div>
        <div className="week-jump">
          <WeekPicker semester={semester} weekStart={weekStart} onChange={setWeekStart} />
          <button
            ref={dateBtnRef}
            className={`icon-btn bordered ${jumpOpen ? 'active' : ''}`}
            title="Go to date"
            aria-haspopup="dialog"
            aria-expanded={jumpOpen}
            onClick={() => setJumpOpen((o) => !o)}
          >
            <Calendar size={16} />
          </button>
          {jumpOpen && dateBtnRef.current && (
            <DatePopover
              anchor={dateBtnRef.current}
              value={weekStart}
              weeks
              range={{ start: semester.startDate, end: semester.endDate }}
              onSelect={(d) => setWeekStart(startOfWeek(d))}
              onClose={closeJump}
            />
          )}
        </div>
        <span className="spacer" />
        <FocusPill subject={focus} onClear={clearFocus} />
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
          This semester has no subjects yet. Add subjects in <strong>Manage subjects</strong>, then create lectures and exercises.
        </div>
      )}

      <div className={`timetable ${dragging ? 'is-dragging' : ''}`} style={gridStyle} ref={timetableRef}>
        {dragging && (
          <>
            <div className={`tt-edge prev ${edge === -1 ? 'active' : ''}`} aria-hidden>
              {edge === -1 && <span key={flips} className="tt-edge-fill" />}
              <ChevronLeft size={18} />
            </div>
            <div className={`tt-edge next ${edge === 1 ? 'active' : ''}`} aria-hidden>
              {edge === 1 && <span key={flips} className="tt-edge-fill" />}
              <ChevronRight size={18} />
            </div>
          </>
        )}
        {/* One scroll container for all rows, so every row has the same width and the day lines align. */}
        <div className="tt-scroll" ref={scrollRef}>
        <div className="tt-sticky" ref={stickyRef}>
        {/* Day headers */}
        <div className="tt-row tt-head">
          <div className="tt-gutter tt-corner">
            {/* Legend for the card styles, on hover or keyboard focus. */}
            <button className="icon-btn small legend-btn" aria-label="Legend">
              <Info size={15} />
            </button>
            <div className="legend-pop" role="tooltip">
              <div className="legend-key">
                <span className="key key-lecture" /> Lecture
              </div>
              <div className="legend-key">
                <span className="key key-done" /> Completed
              </div>
              <div className="legend-key">
                <span className="key key-missed" /> Missed (past, not completed)
              </div>
              <div className="legend-key">
                <span className="key key-plan" /> To do (exercise planned that day)
              </div>
              <div className="legend-key">
                <span className="key key-due" /> Deadline
              </div>
              <div className="legend-key">
                <span className="key key-exam" /> Exam
              </div>
            </div>
          </div>
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
                      className={`ex-chip planned status-${e.status} ${overdue ? 'overdue' : ''} ${dragging?.e.id === e.id && dragging.from === d ? 'dragging' : ''} ${dim(e.subjectId)}`}
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
                      title={`${e.title} (${subjectName(e.subjectId)}) — ${EXERCISE_STATUS_LABEL[e.status]}\nDeadline: ${formatDate(e.deadlineDate, { weekday: true, year: true })}${sessions > 1 ? `\nPlanned on ${sessions} days: ${e.plannedDates.map((p) => formatDate(p, { weekday: true })).join(', ')}` : ''}\nDrag to another day to move this session (hold it at the left or right edge to change weeks).`}
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
                {dragging && dropDay === d && !canDrop(d) && <div className="drop-note">After the deadline</div>}
              </div>
            );
          })}
        </div>

        {/* Exams and deadlines */}
        <div className="tt-row tt-band tt-due">
          <div className="tt-gutter band-label" title="Exams and hand-in deadlines on this day">
            <span>Due</span>
          </div>
          {days.map((d) => {
            const list = (data?.exercises ?? []).filter((e) => e.deadlineDate === d);
            const exams = (data?.exams ?? []).filter((x) => x.date === d);
            return (
              <div key={d} className={`tt-cell ${dayClass(d)}`} {...dropProps(d)}>
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
                      className={`ex-chip due ${e.handedIn ? 'handed-in' : ready ? 'ready' : ''} ${overdue ? 'overdue' : ''} ${dim(e.subjectId)}`}
                      style={{ '--c': colorOf(e.subjectId) } as CSSProperties}
                      onClick={() => openExercise(e.id)}
                      onKeyDown={(ev) => ev.key === 'Enter' && openExercise(e.id)}
                      onContextMenu={(ev) => exerciseMenu(ev, e)}
                      title={`Deadline: ${e.title} (${subjectName(e.subjectId)}) — ${EXERCISE_STAGE_LABEL[exerciseStage(e)]}\nPlanned for ${e.plannedDates.map((p) => formatDate(p, { weekday: true })).join(', ')}`}
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
                      className={`lecture ${o.completed ? 'completed' : past ? 'missed' : ''} ${height < 40 ? 'short' : ''} ${p.cols > 1 ? 'narrow' : ''} ${dim(o.subjectId)}`}
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
      {(() => {
        const e = checklistFor && data?.exercises.find((x) => x.id === checklistFor.id);
        if (!checklistFor || !e || e.checklist.length === 0 || !checklistFor.anchor.isConnected) return null;
        return (
          <ChecklistPopover
            exercise={e}
            anchor={checklistFor.anchor}
            onToggle={(itemId, done) => void toggleStep(itemId, done)}
            onEdit={() => {
              closeChecklist();
              openExercise(e.id);
            }}
            onClose={closeChecklist}
          />
        );
      })()}
    </div>
  );
}

function defaultPlannedDate(weekStart: ISODate, today: ISODate): ISODate {
  // New exercises default to today when viewing the current week, otherwise the week's Monday.
  return today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart;
}

