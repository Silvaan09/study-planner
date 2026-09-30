import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad, useNow, useUi } from '../ui';
import { useChecklistToggle, useExerciseProgress, useWeekCompletion } from '../actions';
import { diffDays, formatDate, startOfWeek, timeToMinutes, todayISO, weeksBetween, WEEKDAY_NAMES, weekday, MONTH_NAMES, type ISODate } from '../../shared/dates';
import { EXAM_KIND_LABEL, EXERCISE_STAGE_LABEL, EXERCISE_STATUS_LABEL, examTitle, exerciseStage, type Exam, type Exercise, type ExerciseStage, type ExerciseStatus, type Id, type LectureOccurrence, type Semester, type Subject } from '../../shared/types';
import { ExamDialog, ExerciseDialog } from '../dialogs';
import { FocusPill } from '../components/FocusPill';
import { ChecklistList, ChecklistProgress } from '../components/Checklist';
import { ExamCountdown, examTime, showsKind } from '../components/ExamRow';
import { Alert, Calendar, Check, Clock, Flag, Flame, GraduationCap, ListTodo, MapPin, StatusIcon, Sun } from '../components/Icons';

const NEXT_STATUS: Record<ExerciseStatus, ExerciseStatus> = { not_started: 'in_progress', in_progress: 'completed', completed: 'not_started' };
/** Rows about deadlines go one step further: done → handed in (which takes them off the list). */
const NEXT_STAGE: Record<ExerciseStage, ExerciseStage> = { not_started: 'in_progress', in_progress: 'completed', completed: 'handed_in', handed_in: 'not_started' };

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "25 min", "1 h 20 min", "3 h". */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "Tuesday, 29 September 2026" */
function longDate(d: ISODate): string {
  return `${WEEKDAY_NAMES[weekday(d) - 1]}, ${+d.slice(8)} ${MONTH_NAMES[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
}

function Card({ title, icon, action, children, className = '' }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        {icon}
        <h2>{title}</h2>
        <span className="spacer" />
        {action}
      </header>
      {children}
    </section>
  );
}

export function TodayView({
  semester,
  focus,
  clearFocus,
  showWeek,
  showOutstanding,
}: {
  semester: Semester;
  /** Subject picked in the sidebar: only its items are listed (the streak always covers everything). */
  focus: Subject | null;
  clearFocus: () => void;
  showWeek: (weekStart: ISODate) => void;
  showOutstanding: () => void;
}) {
  const ui = useUi();
  const completing = useWeekCompletion(semester.id);
  const toggleStep = useChecklistToggle(semester.id);
  const progress = useExerciseProgress(semester.id);
  const now = useNow();
  const today = todayISO(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const { data } = useLoad(() => api.getToday(semester.id, today), [semester.id, today]);
  const subjects = data?.subjects ?? [];
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const colorOf = (id: Id) => subjectById.get(id)?.color ?? '#888';
  const nameOf = (id: Id) => subjectById.get(id)?.name ?? '';

  const v = useMemo(() => {
    const mine = <T extends { subjectId: Id }>(list: T[] | undefined): T[] => (list ?? []).filter((x) => !focus || x.subjectId === focus.id);
    return {
      lectures: mine(data?.lectures),
      upcoming: mine(data?.upcomingLectures),
      planned: mine(data?.planned),
      dueSoon: mine(data?.dueSoon),
      overdue: mine(data?.overdue),
      missed: mine(data?.missedLectures),
      exams: mine(data?.exams),
    };
  }, [data, focus]);

  const semWeeks = weeksBetween(semester.startDate, semester.endDate);
  const weekIndex = semWeeks.indexOf(startOfWeek(today));
  const doneToday = v.lectures.filter((l) => l.completed).length + v.planned.filter((e) => e.status === 'completed').length;
  const totalToday = v.lectures.length + v.planned.length;
  const examsToday = v.exams.filter((x) => x.date === today);

  // Up next: the lecture running now, else the next one today, else the first one in the coming days.
  const upNext = useMemo(() => {
    const running = v.lectures.find((l) => timeToMinutes(l.startTime) <= nowMin && nowMin < timeToMinutes(l.endTime));
    if (running) return { occ: running, label: `Now · ends in ${duration(timeToMinutes(running.endTime) - nowMin)}`, live: true };
    const later = v.lectures.find((l) => timeToMinutes(l.startTime) > nowMin);
    if (later) return { occ: later, label: `Starts in ${duration(timeToMinutes(later.startTime) - nowMin)}`, live: false };
    const next = v.upcoming[0];
    if (!next) return null;
    const days = diffDays(today, next.date);
    const day = days === 1 ? 'Tomorrow' : formatDate(next.date, { weekday: true });
    return { occ: next, label: `${day} at ${next.startTime}`, live: false };
  }, [v, nowMin, today]);

  // ---- actions (same flows as the timetable and Outstanding)
  const toggleLecture = (o: LectureOccurrence) =>
    ui.run(() => completing(o.completed ? [] : [o.weekStart], () => api.setLectureCompleted(o.lectureId, o.weekStart, !o.completed)));
  /** To do today: the work only (handing in belongs to the deadline). */
  const setStatus = (e: Exercise, status: ExerciseStatus) => progress.setStatus(e, status, { toast: true });
  const openExercise = (id: Id) => ui.dialog((close) => <ExerciseDialog semester={semester} subjects={subjects} exerciseId={id} close={close} />);
  const openExam = (id: Id) => ui.dialog((close) => <ExamDialog semester={semester} subjects={subjects} examId={id} close={close} />);

  const lectureRow = (o: LectureOccurrence) => {
    const start = timeToMinutes(o.startTime);
    const end = timeToMinutes(o.endTime);
    const state = o.completed ? 'done' : nowMin >= end ? 'missed' : nowMin >= start ? 'live' : '';
    return (
      <div key={`l${o.lectureId}`} className={`today-row lecture-row ${state}`} style={{ '--c': colorOf(o.subjectId) } as CSSProperties}>
        <span className="today-time">
          {o.startTime}
          <small>{o.endTime}</small>
        </span>
        <span className="today-main">
          <span className="today-title">{o.title}</span>
          <span className="today-meta">
            <span className="subject-dot" /> {nameOf(o.subjectId)}
            {state === 'live' && <span className="live-tag">Now</span>}
            {state === 'missed' && ' · not checked off yet'}
          </span>
        </span>
        <button
          className={`check-btn ${o.completed ? 'checked' : ''}`}
          onClick={() => void toggleLecture(o)}
          title={o.completed ? 'Completed — click to undo' : 'Mark lecture as completed'}
          aria-pressed={o.completed}
        >
          <Check size={14} />
        </button>
      </div>
    );
  };

  const examRowToday = (x: Exam) => (
    <button key={`x${x.id}`} className="today-row exam-row" style={{ '--c': colorOf(x.subjectId) } as CSSProperties} onClick={() => openExam(x.id)}>
      <span className="today-time">{x.startTime ?? '—'}{x.endTime && <small>{x.endTime}</small>}</span>
      <span className="today-main">
        <span className="today-title">
          <GraduationCap size={14} /> {examTitle(x)}
        </span>
        <span className="today-meta">
          <span className="subject-dot" /> {nameOf(x.subjectId)}
          {x.location && ` · ${x.location}`}
        </span>
      </span>
      <span className="exam-countdown today">Exam today</span>
    </button>
  );

  const dueLabel = (e: Exercise) => {
    const n = diffDays(today, e.deadlineDate);
    if (n < 0) return <span className="badge badge-danger"><Alert size={12} /> Overdue · {plural(-n, 'day')}</span>;
    if (n === 0) return <span className="badge badge-warn">Due today</span>;
    if (n === 1) return <span className="badge badge-warn">Due tomorrow</span>;
    return <span className="badge">Due {n < 7 ? formatDate(e.deadlineDate, { weekday: true }) : `in ${plural(n, 'day')}`}</span>;
  };

  const taskRow = (e: Exercise) => (
    <div key={`t${e.id}`} className={`today-task status-${e.status}`} style={{ '--c': colorOf(e.subjectId) } as CSSProperties}>
      <div className="today-row">
        <button className="status-btn" onClick={() => void setStatus(e, NEXT_STATUS[e.status])} title={`${EXERCISE_STATUS_LABEL[e.status]} — click to change`}>
          <StatusIcon status={e.status} size={18} />
        </button>
        <span className="today-main clickable" onClick={() => openExercise(e.id)}>
          <span className="today-title">{e.title}</span>
          <span className="today-meta">
            <span className="subject-dot" /> {nameOf(e.subjectId)}
            {e.plannedDates.length > 1 && ` · session ${e.plannedDates.indexOf(today) + 1} of ${e.plannedDates.length}`}
            {e.checklist.length > 0 && e.status !== 'completed' && (
              <>
                {' · '}
                <ChecklistProgress exercise={e} compact />
              </>
            )}
          </span>
        </span>
        {!e.handedIn && dueLabel(e)}
      </div>
      {e.checklist.length > 0 && e.status !== 'completed' && (
        <div className="today-checklist">
          <ChecklistList exercise={e} onToggle={(id, done) => void toggleStep(id, done)} />
        </div>
      )}
    </div>
  );

  const nextExam = v.exams[0];
  const streak = data?.streak;

  return (
    <div className="page today-view">
      <header className="view-header">
        <div className="week-title">
          <h1>Today</h1>
          <div className="week-sub">
            {longDate(today)} · {weekIndex >= 0 ? `Semester week ${weekIndex + 1} of ${semWeeks.length}` : 'Outside the semester'}
          </div>
        </div>
        <span className="spacer" />
        <FocusPill subject={focus} onClear={clearFocus} />
        <button className="btn" onClick={() => showWeek(startOfWeek(today))}>
          <Calendar size={15} /> This week
        </button>
      </header>

      {data && (
        <>
          <div className="stat-row">
            <div className={`stat stat-streak ${streak!.current > 0 ? 'on' : ''}`} title="Days in a row on which every lecture and every exercise planned that day was completed. Days with nothing scheduled don't count or break it.">
              <Flame size={20} />
              <div>
                <strong>{plural(streak!.current, 'day')}</strong>
                <span>
                  {streak!.today === 'done'
                    ? 'streak · today is done'
                    : streak!.today === 'open'
                      ? `streak · finish today for ${streak!.current + 1}`
                      : 'streak'}
                  {streak!.best > streak!.current && ` · best ${streak!.best}`}
                </span>
              </div>
            </div>
            <div className="stat stat-progress">
              <Sun size={18} />
              <div>
                <strong>
                  {doneToday}/{totalToday}
                </strong>
                <span>done today</span>
                <span className="stat-bar">
                  <span style={{ width: `${totalToday ? (doneToday / totalToday) * 100 : 0}%` }} />
                </span>
              </div>
            </div>
            <button className={`stat clickable ${v.overdue.length ? 'stat-danger' : ''}`} onClick={showOutstanding} title="Show everything outstanding">
              <Alert size={18} />
              <div>
                <strong>{v.overdue.length}</strong>
                <span>
                  overdue exercise{v.overdue.length === 1 ? '' : 's'}
                  {v.missed.length > 0 && ` · ${plural(v.missed.length, 'missed lecture')}`}
                </span>
              </div>
            </button>
            <div className="stat" title={nextExam ? `${examTitle(nextExam)} (${nameOf(nextExam.subjectId)}) on ${formatDate(nextExam.date, { weekday: true, year: true })}` : undefined}>
              <GraduationCap size={18} />
              <div>
                <strong>{nextExam ? (nextExam.date === today ? 'Today' : plural(diffDays(today, nextExam.date), 'day')) : '—'}</strong>
                <span>{nextExam ? `until ${examTitle(nextExam)} · ${nameOf(nextExam.subjectId)}` : 'no exams yet'}</span>
              </div>
            </div>
          </div>

          <div className="today-grid">
            <div className="today-col">
              {upNext && (
                <section className={`up-next ${upNext.live ? 'live' : ''}`} style={{ '--c': colorOf(upNext.occ.subjectId) } as CSSProperties}>
                  <div className="up-next-label">
                    <Clock size={13} /> {upNext.live ? 'Happening now' : 'Up next'}
                  </div>
                  <div className="up-next-title">{upNext.occ.title}</div>
                  <div className="up-next-meta">
                    <span className="subject-dot" /> {nameOf(upNext.occ.subjectId)} · {upNext.occ.startTime}–{upNext.occ.endTime}
                  </div>
                  <div className="up-next-when">{upNext.label}</div>
                  {upNext.live && (
                    <span className="up-next-bar">
                      <span
                        style={{
                          width: `${((nowMin - timeToMinutes(upNext.occ.startTime)) / (timeToMinutes(upNext.occ.endTime) - timeToMinutes(upNext.occ.startTime))) * 100}%`,
                        }}
                      />
                    </span>
                  )}
                </section>
              )}

              <Card title="Today's schedule" icon={<Calendar size={16} />}>
                {examsToday.map(examRowToday)}
                {v.lectures.map(lectureRow)}
                {v.lectures.length === 0 && examsToday.length === 0 && <p className="card-empty">No lectures today.</p>}
              </Card>

              <Card title="To do today" icon={<ListTodo size={16} />}>
                {v.planned.map(taskRow)}
                {v.planned.length === 0 && <p className="card-empty">Nothing planned for today. Drag exercises onto today in the timetable, or plan them in the exercise editor.</p>}
              </Card>
            </div>

            <div className="today-col">
              {(v.overdue.length > 0 || v.missed.length > 0) && (
                <Card
                  title={v.overdue.length > 0 ? 'Overdue' : 'Catch up'}
                  icon={<Alert size={16} />}
                  className="card-danger"
                  action={
                    <button className="btn btn-ghost small" onClick={showOutstanding}>
                      Outstanding
                    </button>
                  }
                >
                  {v.overdue.map((e) => (
                    <div key={e.id} className="today-row compact-row" style={{ '--c': colorOf(e.subjectId) } as CSSProperties}>
                      <button className="check-btn" onClick={() => void progress.setHandedIn(e, true)} title="Mark as handed in">
                        <Check size={14} />
                      </button>
                      <span className="today-main clickable" onClick={() => openExercise(e.id)}>
                        <span className="today-title">{e.title}</span>
                        <span className="today-meta">
                          <span className="subject-dot" /> {nameOf(e.subjectId)} · <Flag size={11} /> was due {formatDate(e.deadlineDate, { weekday: true })}
                        </span>
                      </span>
                      {dueLabel(e)}
                    </div>
                  ))}
                  {v.missed.length > 0 && (
                    <button className="missed-link" onClick={showOutstanding}>
                      <Calendar size={14} /> {plural(v.missed.length, 'lecture')} to catch up on
                      <span className="muted"> · oldest {formatDate(v.missed[0].date, { weekday: true })}</span>
                    </button>
                  )}
                </Card>
              )}

              <Card title="Due in the next 7 days" icon={<Flag size={16} />}>
                {v.dueSoon.map((e) => (
                  <div key={e.id} className={`today-row compact-row status-${e.status}`} style={{ '--c': colorOf(e.subjectId) } as CSSProperties}>
                    <button
                      className="status-btn"
                      onClick={() => void progress.setStage(e, NEXT_STAGE[exerciseStage(e)])}
                      title={`${EXERCISE_STAGE_LABEL[exerciseStage(e)]} — click to change${e.status === 'completed' ? ' to handed in' : ''}`}
                    >
                      <StatusIcon status={e.status} size={16} />
                    </button>
                    <span className="today-main clickable" onClick={() => openExercise(e.id)}>
                      <span className="today-title">{e.title}</span>
                      <span className="today-meta">
                        <span className="subject-dot" /> {nameOf(e.subjectId)}
                        {e.status === 'completed' && ' · ready to hand in'}
                        {e.checklist.length > 0 && e.status !== 'completed' && (
                          <>
                            {' · '}
                            <ChecklistProgress exercise={e} compact />
                          </>
                        )}
                      </span>
                    </span>
                    {dueLabel(e)}
                  </div>
                ))}
                {v.dueSoon.length === 0 && <p className="card-empty">Nothing due this coming week.</p>}
              </Card>

              <Card title="Exams" icon={<GraduationCap size={16} />}>
                {v.exams.map((x) => {
                  const days = diffDays(today, x.date);
                  return (
                    <button key={x.id} className="exam-tile" style={{ '--c': colorOf(x.subjectId) } as CSSProperties} onClick={() => openExam(x.id)}>
                      <span className={`exam-days ${days === 0 ? 'today' : days <= 7 ? 'soon' : ''}`}>
                        <strong>{days === 0 ? '!' : days}</strong>
                        <small>{days === 0 ? 'today' : days === 1 ? 'day' : 'days'}</small>
                      </span>
                      <span className="today-main">
                        <span className="today-title">
                          {examTitle(x)}
                          {showsKind(x) && <span className="muted"> · {EXAM_KIND_LABEL[x.kind]}</span>}
                        </span>
                        <span className="today-meta">
                          <span className="subject-dot" /> {nameOf(x.subjectId)} · {formatDate(x.date, { weekday: true, year: x.date.slice(0, 4) !== today.slice(0, 4) })}
                          {examTime(x) && ` · ${examTime(x)}`}
                          {x.location && (
                            <>
                              {' · '}
                              <MapPin size={11} /> {x.location}
                            </>
                          )}
                        </span>
                      </span>
                      <ExamCountdown exam={x} today={today} />
                    </button>
                  );
                })}
                {v.exams.length === 0 && <p className="card-empty">No upcoming exams. Add midterms, endterms and finals on each subject in Manage subjects.</p>}
              </Card>
            </div>
          </div>
          {today > semester.endDate && <p className="muted small list-foot">This semester is over.</p>}
        </>
      )}
    </div>
  );
}
