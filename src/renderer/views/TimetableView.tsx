import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../api';
import { useNow, useUi } from '../ui';
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
  exerciseDueBy,
  EXERCISE_STAGE_LABEL,
  EXERCISE_STATUS_LABEL,
  EXERCISE_STATUSES,
  examTitle,
  exerciseStage,
  exerciseStages,
  sessionStatus,
  type Exam,
  type Exercise,
  type ExerciseStatus,
  type LectureOccurrence,
  type Semester,
  type Subject,
  type WeekData,
} from '../../shared/types';
import { ExamDialog, ExerciseDialog, LectureDialog } from '../dialogs';
import { ContextMenu, type MenuEntry, type MenuState } from '../components/ContextMenu';
import { WeekPicker } from '../components/WeekPicker';
import { FocusPill } from '../components/FocusPill';
import { DatePopover } from '../components/DatePicker';
import { ChecklistPopover, ChecklistProgress } from '../components/Checklist';
import { examTime } from '../components/ExamRow';
import { bestTopMinute } from '../timetableScroll';
import { FLICK_SPEED, SWITCH_FRACTION, glideMs, landingWeek, swipeSpeed, swipeWindow, velocityAtRelease, withPending } from '../swipe';
import { Calendar, Check, ChevronLeft, ChevronRight, Flag, GraduationCap, Info, Pencil, Plus, Repeat, StatusIcon, Trash } from '../components/Icons';

const HOUR_PX = 64;
/** Width of the right-hand edge zone that switches to the next week while dragging. */
const EDGE_PX = 32;
/** How long a dragged card has to stay at an edge before the week switches (and again for each further week). */
const EDGE_DWELL_MS = 700;
/** Loaded weeks kept for swiping back and forth. */
const WEEK_CACHE = 12;
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

/**
 * The week `weekStart` and its neighbours, loaded together and kept per week (reloaded whenever data changes), so the
 * weeks beside the current one can be shown while swiping and a week swiped to is there at once.
 */
function useWeekData(semesterId: number, weekStart: ISODate): ReadonlyMap<ISODate, WeekData> {
  const { dataVersion } = useUi();
  const [store, setStore] = useState<{ semesterId: number; weeks: Map<ISODate, WeekData> }>({ semesterId, weeks: new Map() });
  useEffect(() => {
    let cancelled = false;
    const wanted = [addDays(weekStart, -7), weekStart, addDays(weekStart, 7)];
    // All three at once, and only weeks whose data changed are replaced: every update re-renders the timetable, and a
    // replaced week is rebuilt, which would make the next swipe stutter.
    Promise.all(wanted.map((w) => api.getWeek(semesterId, w))).then(
      (loaded) => {
        if (cancelled) return;
        setStore((st) => {
          const old = st.semesterId === semesterId ? st.weeks : new Map<ISODate, WeekData>();
          const changed = loaded.filter((week) => JSON.stringify(old.get(week.weekStart)) !== JSON.stringify(week));
          if (changed.length === 0 && st.semesterId === semesterId) return st;
          const weeks = new Map(old);
          for (const week of changed) {
            weeks.delete(week.weekStart);
            weeks.set(week.weekStart, week);
          }
          while (weeks.size > WEEK_CACHE) weeks.delete(weeks.keys().next().value!);
          return { semesterId, weeks };
        });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [semesterId, weekStart, dataVersion]);
  return store.semesterId === semesterId ? store.weeks : new Map();
}

/** What one week's grid needs from its data: the days, visible hours, lecture placement and column widths. */
function weekLayout(week: WeekData | undefined, weekStart: ISODate) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  // Visible hours: 07:00–21:00 by default (last row starts at 20:00), widened to fit this week's lectures.
  let lo = 7 * 60;
  let hi = 21 * 60;
  for (const l of week?.lectures ?? []) {
    lo = Math.min(lo, timeToMinutes(l.startTime));
    hi = Math.max(hi, timeToMinutes(l.endTime));
  }
  const firstHour = Math.floor(lo / 60);
  const lastHour = Math.min(24, Math.ceil(hi / 60));
  const lecturesByDay = new Map(days.map((d) => [d, layoutDay((week?.lectures ?? []).filter((l) => l.date === d))]));
  // Days with lectures side by side get wider so each lecture stays readable; empty days give up some width.
  const dayColumns = days
    .map((d) => {
      const cols = Math.max(0, ...lecturesByDay.get(d)!.map((p) => p.cols));
      const hasExercises =
        (week?.exercises ?? []).some((e) => e.plannedDates.includes(d) || e.deadlineDate === d) || (week?.exams ?? []).some((x) => x.date === d);
      const weight = cols === 0 && !hasExercises ? 0.7 : cols <= 1 ? 1 : cols === 2 ? 1.6 : 2.2;
      return `minmax(0, ${weight}fr)`;
    })
    .join(' ');
  return {
    week,
    days,
    firstHour,
    lastHour,
    lecturesByDay,
    hours: Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i),
    style: { '--hour': `${HOUR_PX}px`, '--days': dayColumns } as CSSProperties,
  };
}

type WeekLayout = ReturnType<typeof weekLayout>;

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
  const byWeek = useWeekData(semester.id, weekStart);
  const lastData = useRef<WeekData | undefined>(undefined);
  const data = byWeek.get(weekStart) ?? lastData.current;
  lastData.current = data;
  const [menu, setMenu] = useState<MenuState | null>(null);
  // The exercise being dragged: one of its planned dates (a "To do" card) or its deadline (a "Due" card).
  const [dragging, setDragging] = useState<{ e: Exercise; from: ISODate; kind: 'planned' | 'deadline' } | null>(null);
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
  const toggleStep = useChecklistToggle();
  const progress = useExerciseProgress(semester.id);

  // The week on screen: the loaded one. Until a newly picked week has loaded, the previous week stays up
  // as a whole — rendering its data against the new week's days would show an empty grid for a frame.
  // Navigation (buttons, keys) still steps from `weekStart`, so quick repeated clicks add up.
  const shownWeek = data?.weekStart ?? weekStart;
  const subjects = data?.subjects ?? [];
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const personal = subjects.find((s) => s.personal);
  const isTask = (e: Exercise) => e.subjectId === personal?.id;
  const semWeeks = useMemo(() => weeksBetween(semester.startDate, semester.endDate), [semester]);
  const weekIndex = semWeeks.indexOf(shownWeek);

  // The shown week and the weeks beside it (seen only while swiping).
  const layout = useMemo(() => weekLayout(data, shownWeek), [data, shownWeek]);
  const { firstHour, lastHour } = layout;
  const prevWeek = byWeek.get(addDays(shownWeek, -7));
  const nextWeek = byWeek.get(addDays(shownWeek, 7));
  const prevLayout = useMemo(() => weekLayout(prevWeek, addDays(shownWeek, -7)), [prevWeek, shownWeek]);
  const nextLayout = useMemo(() => weekLayout(nextWeek, addDays(shownWeek, 7)), [nextWeek, shownWeek]);
  /** Set when a swipe lands on a neighbouring week: it keeps showing the same hours and doesn't slide in again. */
  const swipedTo = useRef<ISODate | null>(null);
  const swipedMinute = useRef<number | null>(null);

  // Once the new week's lectures are loaded, scroll so that as many of them as possible are fully visible
  // (starting at 08:00 whenever that shows them all). Only on week change, not on every data refresh.
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const key = `${semester.id}:${weekStart}`;
    if (!el || !data || data.weekStart !== weekStart || scrolledFor.current === key) return;
    scrolledFor.current = key;
    // A swiped-to week keeps showing the hours it showed beside the old one.
    if (swipedTo.current === weekStart) {
      if (swipedMinute.current !== null) scrollToMinute(el, swipedMinute.current);
      return;
    }
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
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); // not also a native horizontal scroll (of the swipe layer)
        setWeekStart(addDays(weekStart, e.key === 'ArrowLeft' ? -7 : 7));
      } else if (e.key.toLowerCase() === 't') setWeekStart(startOfWeek(todayISO()));
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
  /** Status circle on a planned card: the work of that session only; handing in is the deadline card's flag. */
  const cycleStatus = (e: Exercise, day: ISODate) => progress.setSession(e, day, NEXT_STATUS[sessionStatus(e, day)]);
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

  /** On a planned card of an exercise with several sessions (`day`), the menu sets that session or the whole exercise. */
  const exerciseMenu = (ev: React.MouseEvent, e: Exercise, day?: ISODate) => {
    ev.preventDefault();
    ev.stopPropagation();
    const session: MenuEntry[] =
      day && e.plannedDates.length > 1
        ? [
            { heading: `This session · ${formatDate(day, { weekday: true })}` },
            ...EXERCISE_STATUSES.map((s) => ({
              label: EXERCISE_STATUS_LABEL[s],
              icon: <StatusIcon status={s} size={14} />,
              disabled: sessionStatus(e, day) === s,
              onSelect: () => void progress.setSession(e, day, s),
            })),
            'separator',
            { heading: isTask(e) ? 'Whole task' : 'Whole exercise' },
          ]
        : [];
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        ...session,
        ...exerciseStages(e).map((s) => ({
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

  // ---- drag & drop of planned days and deadlines between days
  /** Planned days can't go after the deadline, and the deadline can't go before the last planned day. */
  const canDrop = (day: ISODate) => {
    if (!dragging) return false;
    const { e, kind } = dragging;
    if (kind === 'planned') return e.deadlineDate === null || day <= e.deadlineDate;
    return day >= e.plannedDates[e.plannedDates.length - 1];
  };
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
      if (drag.kind === 'deadline') {
        const last = ex.plannedDates[ex.plannedDates.length - 1];
        if (day < last) {
          ui.toast(`"${ex.title}" is planned for ${formatDate(last, { weekday: true })} — the deadline can't be before that.`, { kind: 'error' });
          return;
        }
        const setDeadline = (d: ISODate) => api.updateExercise({ id: ex.id, scope: 'this', changes: { deadlineDate: d } });
        void ui.run(async () => {
          await setDeadline(day);
          ui.toast(`Moved the deadline of "${ex.title}" to ${formatDate(day, { weekday: true })}`, {
            kind: 'success',
            action: { label: 'Undo', run: () => void ui.run(() => setDeadline(drag.from)) },
          });
        });
        return;
      }
      if (ex.deadlineDate !== null && day > ex.deadlineDate) {
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
      const firstDay = scrollRef.current?.querySelector('.tt-day-head')?.getBoundingClientRect();
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

  // Swiping. The previous, this and the next week sit side by side on a track (`.tt-track`), moved only with a GPU
  // transform (scrolling it would repaint every frame). The track sits in a sticky viewport inside `.tt-carousel`,
  // which itself scrolls natively over a wide invisible area: two-finger swipes scroll that, and its scroll positions
  // are the input. That way the browser tells when the fingers are lifted (`scrollend`: resting them on the trackpad
  // doesn't end the swipe), while vertical scrolling stays native in each week.
  // The strip follows 1:1 for as long as the fingers are on the trackpad; only when they are let go (scrollend) it
  // glides quickly to the week it lands on (see landingWeek). The trackpad's momentum after the lift belongs to the
  // gesture (scrollend comes after it); a swipe moves at most one week boundary on (see swipeWindow), so a fast
  // flick's momentum carries the strip to the next week and stops there. Reaching a neighbour
  // makes it the current week: rendered synchronously (flushSync) with the strip re-centred and moved by the same
  // amount, so nothing jumps. A swipe that starts during a glide goes on from the week it was heading for (see
  // withPending), so quick swipes add up, and a glide over several weeks lands on each in turn.
  const carouselRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  /** The strip's position relative to the current week (px, positive = towards the next one). */
  const stripPos = useRef(0);
  const placeStrip = useCallback((at: number) => {
    stripPos.current = at;
    const width = carouselRef.current?.clientWidth ?? 0;
    if (trackRef.current) trackRef.current.style.transform = `translate3d(${-(width + at)}px, 0, 0)`;
  }, []);
  const prevScrollRef = useRef<HTMLDivElement>(null);
  const nextScrollRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(shownWeek);
  shownRef.current = shownWeek;
  useLayoutEffect(() => placeStrip(0), [shownWeek, placeStrip]);
  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    /** 'swipe' = following the fingers (and their momentum) until the gesture ends. */
    let mode: 'idle' | 'swipe' = 'idle';
    let samples = 0; // movements of this swipe
    let velocity = 0; // px per ms, positive = towards the next week (smoothed)
    let travel = 0; // px this swipe has moved the strip
    // Weeks below are relative to the current week and shift whenever a week is landed on.
    let bounds: [number, number] = [-1, 1]; // the weeks the swipe may move between (see swipeWindow)
    let pendingAtStart: number | null = null; // the week a glide was heading for when this swipe started
    let last = 0; // the scroll position last seen
    let lastAt = 0; // when it last changed
    let frame = 0;
    let pending = 0; // the week the running glide heads for

    /** Puts the native scroll position back in the middle of its room (only while nothing is swiping). */
    const recentre = () => {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
      last = el.scrollLeft;
    };
    const width = () => el.clientWidth;
    /** The strip's position in weeks (0 = the current week, 0.3 = 30% of the way to the next). */
    const weeks = () => stripPos.current / width();
    /** Makes the neighbour `dir` the current week; true once it is shown (it may still be loading). */
    const land = (dir: -1 | 1) => {
      const target = addDays(shownRef.current, 7 * dir);
      swipedTo.current = target;
      swipedMinute.current = topMinute(scrollRef.current);
      flushSync(() => setWeekStart(target));
      return shownRef.current === target;
    };
    /** Places the strip at `at` px, landing on every neighbour it reaches (so it can move on to the week after). */
    const place = (at: number) => {
      const w = width();
      while (at >= w - 0.5 || at <= 0.5 - w) {
        const dir = at > 0 ? 1 : -1;
        if (!land(dir)) {
          // That week isn't loaded yet: rest on it; it becomes current (and centred) once it is.
          placeStrip(dir * w);
          pending = 0;
          pendingAtStart = null;
          return;
        }
        at -= dir * w;
        // Everything counted in weeks moves along with the current week.
        bounds = [bounds[0] - dir, bounds[1] - dir];
        if (pendingAtStart !== null) pendingAtStart -= dir;
        pending -= dir;
      }
      placeStrip(at);
    };
    const stopGlide = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    /** Glides to week `target` (0 = back to the current one), landing on each week it passes. */
    const glide = (target: number, speed: number) => {
      stopGlide();
      const from = stripPos.current;
      const distance = target * width() - from;
      const ms = reducedMotion() ? 0 : glideMs(distance, speed) * Math.max(1, Math.abs(target) * 0.75);
      const t0 = performance.now();
      let done = 0; // px of `distance` covered so far
      pending = target;
      const step = (now: number) => {
        const t = ms === 0 ? 1 : Math.min(1, (now - t0) / ms);
        const covered = distance * (1 - (1 - t) ** 3);
        place(stripPos.current + covered - done);
        done = covered;
        if (t < 1) frame = requestAnimationFrame(step);
        else frame = 0;
      };
      frame = requestAnimationFrame(step);
    };
    /** The gesture ended (fingers lifted, momentum done): glide to the week it lands on. */
    const release = () => {
      const v = velocityAtRelease(velocity, performance.now() - lastAt);
      const direction = Math.sign(travel);
      const own = landingWeek(weeks(), direction, v);
      const moving = Math.abs(v) >= FLICK_SPEED || Math.abs(travel) > width() * SWITCH_FRACTION;
      const target = withPending(own, pendingAtStart, direction, moving);
      glide(Math.min(bounds[1], Math.max(bounds[0], target)), v);
    };
    /** A new gesture: from here the swipe may move one week boundary on in either direction. */
    const startSwipe = () => {
      pendingAtStart = frame ? pending : null;
      stopGlide();
      mode = 'swipe';
      samples = 0;
      velocity = 0;
      travel = 0;
      bounds = swipeWindow(weeks(), pendingAtStart);
    };

    const onScroll = () => {
      const x = el.scrollLeft;
      const dx = x - last;
      last = x;
      if (dx === 0) return;
      const now = performance.now();
      const dt = now - lastAt;
      lastAt = now;
      if (mode === 'idle') startSwipe(); // a new gesture
      const speed = swipeSpeed(dx, dt);
      // The first movement has no meaningful time to measure its speed against. (A new touch ends the momentum's
      // gesture first, so every movement until scrollend belongs to this swipe; its momentum can even be faster than
      // the fingers were, so speed says nothing about whether new fingers came in.)
      if (samples++ > 0) velocity = samples === 2 ? speed : velocity * 0.5 + speed * 0.5;
      const w = width();
      const at = Math.min(bounds[1] * w, Math.max(bounds[0] * w, stripPos.current + dx));
      travel += at - stripPos.current;
      if (at !== stripPos.current) place(at);
    };
    // The gesture is over (fingers lifted, plus any momentum): settle, and make room for the next swipe.
    const onScrollEnd = () => {
      if (mode === 'swipe') release();
      mode = 'idle';
      recentre();
    };
    // A resized window keeps the current week in place.
    const resized = new ResizeObserver(() => {
      placeStrip(stripPos.current);
      if (mode === 'idle') recentre();
    });
    recentre();
    el.addEventListener('scroll', onScroll);
    el.addEventListener('scrollend', onScrollEnd);
    resized.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onScrollEnd);
      stopGlide();
      resized.disconnect();
    };
  }, [setWeekStart, placeStrip]);

  // The weeks beside the current one show the same hours, so swiping doesn't jump up or down. Aligned by the time at
  // the top of the grid, not by pixels: the weeks' first hours and the heights of their "To do"/"Due" rows differ.
  const alignPanes = useCallback(() => {
    const minute = topMinute(scrollRef.current);
    if (minute === null) return;
    for (const r of [prevScrollRef, nextScrollRef]) if (r.current) scrollToMinute(r.current, minute);
  }, []);
  useLayoutEffect(alignPanes);

  // A week picked with the buttons, keys or week picker slides in from the side it comes from (a swiped-to week is
  // already in place).
  const prevShown = useRef(shownWeek);
  useLayoutEffect(() => {
    const prev = prevShown.current;
    prevShown.current = shownWeek;
    const el = scrollRef.current;
    const swiped = swipedTo.current === shownWeek;
    if (swiped) swipedTo.current = null;
    if (!el || prev === shownWeek || swiped || reducedMotion()) return;
    const from = shownWeek > prev ? 40 : -40;
    el.animate([{ transform: `translateX(${from}px)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], {
      duration: 220,
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    });
  }, [shownWeek]);

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

  const nowMin = now.getHours() * 60 + now.getMinutes();

  const colorOf = (subjectId: number) => subjectById.get(subjectId)?.color ?? '#888';
  const subjectName = (subjectId: number) => subjectById.get(subjectId)?.name ?? '';
  const dim = (subjectId: number) => (focus && subjectId !== focus.id ? 'dimmed' : '');

  /**
   * One week's grid. Only the current pane is interactive; the panes beside it are `inert` and only seen while
   * swiping. One scroll container per week for all its rows, so every row has the same width and the day lines align.
   */
  const renderWeek = (L: WeekLayout, pane: 'prev' | 'current' | 'next') => (
    <div key={L.days[0]} className="tt-pane" inert={pane !== 'current'}>
      <div
        className="tt-scroll"
        ref={pane === 'current' ? scrollRef : pane === 'prev' ? prevScrollRef : nextScrollRef}
        style={L.style}
        data-first-hour={L.firstHour}
        onScroll={pane === 'current' ? alignPanes : undefined}
      >
      <div className="tt-sticky" ref={pane === 'current' ? stickyRef : undefined}>
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
        {L.days.map((d, i) => (
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
        {L.days.map((d) => {
          const list = (L.week?.exercises ?? []).filter((e) => e.plannedDates.includes(d));
          return (
            <div key={d} className={`tt-cell ${dayClass(d)}`} {...dropProps(d)} onDoubleClick={() => newExercise(d)}>
              {list.map((e) => {
                // This card is one session: its own progress, not the exercise's.
                const status = sessionStatus(e, d);
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
                    title={`${e.title} (${subjectName(e.subjectId)}) — ${sessions > 1 ? `session ${session} of ${sessions}: ${EXERCISE_STATUS_LABEL[status]} (${sessionsDone} of ${sessions} done)` : EXERCISE_STATUS_LABEL[status]}\nDeadline: ${e.deadlineDate ? formatDate(e.deadlineDate, { weekday: true, year: true }) : 'none'}${sessions > 1 ? `\nPlanned on ${sessions} days: ${e.plannedDates.map((p) => formatDate(p, { weekday: true })).join(', ')}` : ''}\nDrag to another day to move this session (hold it at the left or right edge to change weeks).`}
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

      {/* Exams and deadlines */}
      <div className="tt-row tt-band tt-due">
        <div className="tt-gutter band-label" title="Exams and hand-in deadlines on this day">
          <span>Due</span>
        </div>
        {L.days.map((d) => {
          const list = (L.week?.exercises ?? []).filter((e) => e.deadlineDate === d);
          const exams = (L.week?.exams ?? []).filter((x) => x.date === d);
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
                    title={`Deadline: ${e.title} (${subjectName(e.subjectId)}) — ${EXERCISE_STAGE_LABEL[exerciseStage(e)]}\nPlanned for ${e.plannedDates.map((p) => formatDate(p, { weekday: true })).join(', ')}\nDrag to another day to move the deadline (hold it at the left or right edge to change weeks).`}
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

      </div>

      {/* Time grid */}
        <div className="tt-row tt-grid" style={{ height: L.hours.length * HOUR_PX }}>
          <div className="tt-gutter tt-hours">
            {L.hours.map((h) => (
              <div key={h} className="hour-label" style={{ top: (h - L.firstHour) * HOUR_PX }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {L.days.map((d, i) => (
            <div
              key={d}
              className={`tt-col ${dayClass(d)}`}
              {...dropProps(d)}
              onDoubleClick={(ev) => {
                const y = ev.clientY - (ev.currentTarget as HTMLElement).getBoundingClientRect().top;
                newLecture(i + 1, Math.min(22 * 60, L.firstHour * 60 + Math.floor(y / HOUR_PX) * 60));
              }}
            >
              {L.hours.map((h) => (
                <div key={h} className="hour-line" style={{ top: (h - L.firstHour) * HOUR_PX }} />
              ))}
              {L.lecturesByDay.get(d)!.map((p) => {
                const o = p.occ;
                const past = o.date < today || (o.date === today && timeToMinutes(o.endTime) <= nowMin);
                const top = ((p.start - L.firstHour * 60) / 60) * HOUR_PX;
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
              {d === today && nowMin >= L.firstHour * 60 && nowMin <= L.lastHour * 60 && (
                <div className="now-line" style={{ top: ((nowMin - L.firstHour * 60) / 60) * HOUR_PX }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

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
          <span title="Exercises and tasks planned this week, per planned day (one planned on two days counts twice)">
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

      {subjects.every((s) => s.personal) && data && (
        <div className="empty-hint">
          This semester has no subjects yet. Add subjects in <strong>Manage subjects</strong>, then create lectures and exercises. Personal tasks (subject "No subject" in the exercise editor) work right away.
        </div>
      )}

      <div className={`timetable ${dragging ? 'is-dragging' : ''}`} ref={timetableRef}>
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
        {/* The previous, this and the next week side by side; swiping moves the track between them (see carouselRef). */}
        <div className="tt-carousel" ref={carouselRef}>
          <div className="tt-viewport">
            <div className="tt-track" ref={trackRef}>
              {/* Keyed by week: after a swipe the two weeks still on screen keep their DOM, only the new neighbour is built. */}
              {[renderWeek(prevLayout, 'prev'), renderWeek(layout, 'current'), renderWeek(nextLayout, 'next')]}
            </div>
          </div>
          {/* Invisible room for the native horizontal scrolling that swipes are read from. */}
          <div className="tt-swipe-room" aria-hidden />
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

/** The time (minutes since midnight) at the top of a week's time grid, just below its sticky rows. */
function topMinute(scroll: HTMLElement | null): number | null {
  if (!scroll) return null;
  return Number(scroll.dataset.firstHour) * 60 + (scroll.scrollTop / HOUR_PX) * 60;
}

/** Scrolls a week's time grid so that `minute` is at its top. */
function scrollToMinute(scroll: HTMLElement, minute: number): void {
  scroll.scrollTop = ((minute - Number(scroll.dataset.firstHour) * 60) / 60) * HOUR_PX;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function defaultPlannedDate(weekStart: ISODate, today: ISODate): ISODate {
  // New exercises default to today when viewing the current week, otherwise the week's Monday.
  return today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart;
}

