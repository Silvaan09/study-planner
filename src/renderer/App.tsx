import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from './api';
import { useLoad, useUi } from './ui';
import { formatDate, startOfWeek, todayISO, type ISODate } from '../shared/dates';
import type { Id, Semester } from '../shared/types';
import { SemesterDialog } from './dialogs';
import { TodayView } from './views/TodayView';
import { TimetableView } from './views/TimetableView';
import { OutstandingView } from './views/OutstandingView';
import { SubjectsView } from './views/SubjectsView';
import { TrashView } from './views/TrashView';
import { SettingsView } from './views/SettingsView';
import { Calendar, ListTodo, Pencil, Plus, Settings, Sliders, Sun, Trash, X } from './components/Icons';
import logo from './logo.svg';

const VIEWS = ['today', 'timetable', 'outstanding', 'subjects', 'trash', 'settings'] as const;
type View = (typeof VIEWS)[number];

/** The remembered view; "data" (the Data & backups view before 1.4.0) is now part of Settings. */
function rememberedView(): View {
  const v = remembered<string>('view', 'timetable');
  if (v === 'data') return 'settings';
  return (VIEWS as readonly string[]).includes(v) ? (v as View) : 'timetable';
}

// Only UI conveniences are remembered in the browser storage; all real data is in the database.
function remembered<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** The semester to show by default: the one containing today, else the latest. */
function pickSemester(list: Semester[], preferredId: number | null): Semester | null {
  const today = todayISO();
  return (
    list.find((s) => s.id === preferredId) ??
    list.find((s) => s.startDate <= today && today <= s.endDate) ??
    list[0] ??
    null
  );
}

function initialWeek(s: Semester): ISODate {
  const today = todayISO();
  if (today < s.startDate) return startOfWeek(s.startDate);
  if (today > s.endDate) return startOfWeek(s.endDate);
  return startOfWeek(today);
}

export function App() {
  const ui = useUi();
  const { data: semesters } = useLoad(() => api.listSemesters(), []);
  const [semesterId, setSemesterId] = useState<number | null>(() => Number(remembered('semesterId', '')) || null);
  const [view, setView] = useState<View>(rememberedView);
  const [weekStart, setWeekStart] = useState<ISODate | null>(null);
  // Subject picked in the sidebar: the timetable greys out the others, Outstanding shows only it. Not remembered.
  const [focusId, setFocusId] = useState<Id | null>(null);

  const semester = useMemo(() => (semesters ? pickSemester(semesters, semesterId) : null), [semesters, semesterId]);

  useEffect(() => {
    if (semester && semester.id !== semesterId) setSemesterId(semester.id);
  }, [semester, semesterId]);
  useEffect(() => {
    if (semester) {
      remember('semesterId', String(semester.id));
      setWeekStart(initialWeek(semester));
      setFocusId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semester?.id]);
  useEffect(() => remember('view', view), [view]);

  const { data: subjects } = useLoad(() => (semester ? api.listSubjects(semester.id) : Promise.resolve([])), [semester?.id]);
  const { data: outstanding } = useLoad(() => (semester ? api.getOutstanding(semester.id, todayISO()) : Promise.resolve(null)), [semester?.id]);
  const overdue = outstanding?.items.filter((i) => i.kind === 'exercise' && i.overdue).length ?? 0;
  const open = outstanding?.items.length ?? 0;
  const { data: trash } = useLoad(() => api.listTrash(), []);
  const trashCount = trash?.length ?? 0;
  // Drop the focus if that subject disappears (deleted, or moved to the trash).
  const focus = subjects?.find((s) => s.id === focusId) ?? null;

  const newSemester = async () => {
    const s = await ui.dialog<Semester>((close) => <SemesterDialog close={close} />);
    if (s) {
      setSemesterId(s.id);
      setView('subjects');
    }
  };

  if (semesters === undefined) return <div className="boot" />;

  if (!semester) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <img src={logo} alt="" width={72} height={72} />
          <h1>Welcome to Study Planner</h1>
          <p>
            Start by creating a semester. Then add your subjects, weekly lectures and exercises — and plan your week on the timetable.
          </p>
          <button className="btn btn-primary btn-lg" onClick={newSemester}>
            <Plus size={16} /> Create a semester
          </button>
          <button className="btn btn-ghost small" onClick={() => setView(view === 'trash' ? 'timetable' : 'trash')}>
            <Trash size={14} /> {view === 'trash' ? 'Hide trash' : 'Restore something from the trash'}
          </button>
        </div>
        {view === 'trash' && <TrashView />}
      </div>
    );
  }

  const navItem = (id: View, label: string, icon: ReactNode, badge?: ReactNode) => (
    <button className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
      {badge}
    </button>
  );

  /** Sidebar subject click: focus it (or unfocus when clicked again). Focus only affects the planning and subject views. */
  const toggleFocus = (id: Id) => {
    setFocusId((f) => (f === id ? null : id));
    if (view === 'trash' || view === 'settings') setView('timetable');
  };
  const clearFocus = () => setFocusId(null);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="" width={28} height={28} />
          <span>Study Planner</span>
        </div>

        <div className="semester-picker">
          <div className="semester-head">
            <label className="sidebar-label" htmlFor="semester-select">
              Semester
            </label>
            <span>
              <button
                className="icon-btn"
                title="Edit semester"
                onClick={() => ui.dialog((close) => <SemesterDialog semester={semester} close={close} />)}
              >
                <Pencil size={14} />
              </button>
              <button className="icon-btn" title="New semester" onClick={newSemester}>
                <Plus size={15} />
              </button>
            </span>
          </div>
          <select id="semester-select" className="input" value={semester.id} onChange={(e) => setSemesterId(Number(e.target.value))}>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="semester-dates">
            {formatDate(semester.startDate, { year: true })} – {formatDate(semester.endDate, { year: true })}
          </div>
        </div>

        <nav className="nav-section" aria-label="Planning">
          <div className="sidebar-label">Planning</div>
          {navItem('today', 'Today', <Sun size={18} />)}
          {navItem('timetable', 'Timetable', <Calendar size={18} />)}
          {navItem(
            'outstanding',
            'Outstanding',
            <ListTodo size={18} />,
            open > 0 ? (
              <span className={`nav-badge ${overdue ? 'danger' : ''}`} title={overdue ? `${overdue} overdue` : `${open} open`}>
                {open}
              </span>
            ) : null,
          )}
        </nav>

        <nav className="nav-section" aria-label="Subjects">
          <div className="sidebar-label">Subjects</div>
          {subjects?.map((s) => {
            const active = focus?.id === s.id;
            return (
              <button
                key={s.id}
                className={`subject-item ${active ? 'active' : ''} ${focus && !active ? 'faded' : ''}`}
                style={{ '--c': s.color } as CSSProperties}
                aria-pressed={active}
                title={active ? `Showing only ${s.name} — click to show all subjects` : `Show only ${s.name}`}
                onClick={() => toggleFocus(s.id)}
              >
                <span className="dot" />
                <span className="subject-name">{s.name}</span>
                {active && <X size={13} />}
              </button>
            );
          })}
          {subjects?.length === 0 && <p className="sidebar-empty">No subjects yet.</p>}
          {navItem('subjects', 'Manage subjects', <Sliders size={18} />)}
        </nav>

        <nav className="nav-section sidebar-foot" aria-label="More">
          {navItem('trash', 'Trash', <Trash size={18} />, trashCount ? <span className="nav-badge muted">{trashCount}</span> : null)}
          {navItem('settings', 'Settings', <Settings size={18} />)}
        </nav>
      </aside>

      <main className="main">
        {view === 'today' && (
          <TodayView
            semester={semester}
            focus={focus}
            clearFocus={clearFocus}
            showWeek={(w) => {
              setWeekStart(w);
              setView('timetable');
            }}
            showOutstanding={() => setView('outstanding')}
          />
        )}
        {view === 'timetable' && weekStart && (
          <TimetableView semester={semester} weekStart={weekStart} setWeekStart={setWeekStart} focus={focus} clearFocus={clearFocus} />
        )}
        {view === 'outstanding' && (
          <OutstandingView
            semester={semester}
            focus={focus}
            clearFocus={clearFocus}
            showWeek={(w) => {
              setWeekStart(w);
              setView('timetable');
            }}
          />
        )}
        {view === 'subjects' && <SubjectsView semester={semester} focus={focus} clearFocus={clearFocus} />}
        {view === 'trash' && <TrashView />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
