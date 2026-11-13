import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { useNow, useUi } from '../../ui';
import { useActions, useChecklistToggle, useExerciseProgress, useWeekCompletion } from '../../actions';
import {
  addDays,
  formatWeekRange,
  isoWeekNumber,
  minutesToTime,
  startOfWeek,
  timeToMinutes,
  todayISO,
  weeksBetween,
  weekday,
  type ISODate,
} from '../../../shared/dates';
import { weekProgress } from '../../../shared/progress';
import { breakOn, breakTitle, inStudyPeriod, type Exercise, type LectureOccurrence, type Semester, type Subject, type WeekData } from '../../../shared/types';
import { ExamDialog, ExerciseDialog, LectureDialog } from '../../dialogs';
import { ContextMenu, type MenuState } from '../../components/ContextMenu';
import { WeekPicker } from '../../components/WeekPicker';
import { FocusPill } from '../../components/FocusPill';
import { DatePopover } from '../../components/DatePicker';
import { ChecklistPopover } from '../../components/Checklist';
import { bestTopMinute } from '../../timetableScroll';
import { Calendar, ChevronLeft, ChevronRight, Plus } from '../../components/Icons';
import { HOUR_PX, defaultPlannedDate, scrollToMinute, weekLayout } from './layout';
import { useWeekData } from './useWeekData';
import { useStatusClicks } from './useStatusClicks';
import { useDragDrop } from './useDragDrop';
import { useSwipe } from './useSwipe';
import { timetableMenus } from './menus';
import { renderWeek } from './weekGrid';
import type { WeekContext } from './weekContext';

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
  // The exam study period (after the last lecture until the last exam) and its weeks.
  const period = data?.studyPeriod ?? null;
  const studyWeeks = useMemo(() => (period ? weeksBetween(period.startDate, period.endDate) : []), [period?.startDate, period?.endDate]);
  const studyIndex = studyWeeks.indexOf(shownWeek);

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
  /** Double click in the "Due" row: an exercise with only that deadline (nothing to work on, e.g. a registration). */
  const newDeadline = (deadlineDate: ISODate) =>
    ui.dialog((close) => <ExerciseDialog semester={semester} subjects={subjects} defaults={{ deadlineDate }} close={close} />);
  const newLecture = (weekday?: number, startMin?: number) =>
    ui.dialog((close) => (
      <LectureDialog
        semester={semester}
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
  const { cardStatus, cycleStatus } = useStatusClicks(progress, byWeek);
  /** Flag on a deadline card: hand the exercise in (which also marks the work done), or take that back. */
  const toggleHandedIn = (e: Exercise) => progress.setHandedIn(e, !e.handedIn);

  const { lectureMenu, exerciseMenu, examMenu, dayMenu } = timetableMenus({
    setMenu,
    ui,
    actions,
    progress,
    semester,
    subjects,
    isTask,
    toggleLecture,
    openExercise,
    openExam,
  });

  // ---- drag & drop of planned days and deadlines between days (and across weeks at the edges)
  const { dragging, setDragging, dropDay, setDropDay, canDrop, dropProps, timetableRef, edge, flips } = useDragDrop({
    ui,
    weekStart,
    setWeekStart,
    scrollRef,
  });

  // Swiping between weeks, aligning the panes beside the current one, and sliding in a week picked otherwise.
  const { carouselRef, trackRef, prevScrollRef, nextScrollRef, alignPanes } = useSwipe({
    shownWeek,
    setWeekStart,
    scrollRef,
    swipedTo,
    swipedMinute,
  });

  const dayClass = (day: ISODate, week: WeekData | undefined) => {
    const study = inStudyPeriod(week?.studyPeriod ?? null, day);
    return [
      day === today && 'today',
      weekday(day) >= 6 && 'weekend',
      // Days of the exam study period aren't crossed out, even after the semester's end.
      (day < semester.startDate || day > semester.endDate) && !study && 'outside',
      study && 'study',
      breakOn(week?.breaks ?? [], day) && 'break',
      dragging && (canDrop(day) ? 'drop-ok' : 'drop-no'),
      dragging && dropDay === day && 'drop-hover',
    ]
      .filter(Boolean)
      .join(' ');
  };

  const nowMin = now.getHours() * 60 + now.getMinutes();

  const colorOf = (subjectId: number) => subjectById.get(subjectId)?.color ?? '#888';
  const subjectName = (subjectId: number) => subjectById.get(subjectId)?.name ?? '';
  const dim = (subjectId: number) => (focus && subjectId !== focus.id ? 'dimmed' : '');

  const weekCtx: WeekContext = {
    today,
    nowMin,
    scrollRef,
    prevScrollRef,
    nextScrollRef,
    stickyRef,
    alignPanes,
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
    dayMenu,
    lectureMenu,
    exerciseMenu,
    examMenu,
    cardStatus,
    cycleStatus,
    toggleHandedIn,
    toggleLecture,
    openExercise,
    openExam,
    newExercise,
    newDeadline,
    newLecture,
    checklistFor,
    setChecklistFor,
  };

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
            {weekIndex >= 0 ? `Semester week ${weekIndex + 1} of ${semWeeks.length}` : studyIndex < 0 && 'Outside the semester'}
            {studyIndex >= 0 && (
              <span className="week-study">
                {weekIndex >= 0 && ' · '}Exam study week {studyIndex + 1} of {studyWeeks.length}
              </span>
            )}{' '}
            · Calendar week {isoWeekNumber(shownWeek)}
            {data && data.breaks.length > 0 && <span className="week-break"> · {data.breaks.map(breakTitle).join(', ')}</span>}
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
              range={{ start: semester.startDate, end: period && period.endDate > semester.endDate ? period.endDate : semester.endDate }}
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
        {/* The previous, this and the next week side by side; swiping moves the track between them (see useSwipe). */}
        <div className="tt-carousel" ref={carouselRef}>
          <div className="tt-viewport">
            <div className="tt-track" ref={trackRef}>
              {/* Keyed by week: after a swipe the two weeks still on screen keep their DOM, only the new neighbour is built. */}
              {[renderWeek(prevLayout, 'prev', weekCtx), renderWeek(layout, 'current', weekCtx), renderWeek(nextLayout, 'next', weekCtx)]}
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
