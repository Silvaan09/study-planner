import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from './api';
import { useLoad, useUi } from './ui';
import { formatDate, startOfWeek, todayISO, type ISODate } from '../shared/dates';
import type { Semester } from '../shared/types';
import { SemesterDialog } from './dialogs';
import { TimetableView } from './views/TimetableView';
import { OutstandingView } from './views/OutstandingView';
import { SubjectsView } from './views/SubjectsView';
import { TrashView } from './views/TrashView';
import { DataView } from './views/DataView';
import { Book, Calendar, Database, ListTodo, Pencil, Plus, Trash } from './components/Icons';
import logo from './logo.svg';

type View = 'timetable' | 'outstanding' | 'subjects' | 'trash' | 'data';

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
  const [view, setView] = useState<View>(() => remembered<View>('view', 'timetable'));
  const [weekStart, setWeekStart] = useState<ISODate | null>(null);

  const semester = useMemo(() => (semesters ? pickSemester(semesters, semesterId) : null), [semesters, semesterId]);

  useEffect(() => {
    if (semester && semester.id !== semesterId) setSemesterId(semester.id);
  }, [semester, semesterId]);
  useEffect(() => {
    if (semester) {
      remember('semesterId', String(semester.id));
      setWeekStart(initialWeek(semester));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semester?.id]);
  useEffect(() => remember('view', view), [view]);

  const { data: subjects } = useLoad(() => (semester ? api.listSubjects(semester.id) : Promise.resolve([])), [semester?.id]);
  const { data: outstanding } = useLoad(() => (semester ? api.getOutstanding(semester.id, todayISO()) : Promise.resolve(null)), [semester?.id]);
  const overdue = outstanding?.items.filter((i) => i.kind === 'exercise' && i.overdue).length ?? 0;
  const open = outstanding?.items.length ?? 0;

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

  const nav: { id: View; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { id: 'timetable', label: 'Timetable', icon: <Calendar size={18} /> },
    {
      id: 'outstanding',
      label: 'Outstanding',
      icon: <ListTodo size={18} />,
      badge: open > 0 ? <span className={`nav-badge ${overdue ? 'danger' : ''}`} title={overdue ? `${overdue} overdue` : undefined}>{open}</span> : null,
    },
    { id: 'subjects', label: 'Subjects', icon: <Book size={18} /> },
    { id: 'trash', label: 'Trash', icon: <Trash size={18} /> },
    { id: 'data', label: 'Data & backups', icon: <Database size={18} /> },
  ];

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

        <nav className="nav">
          {nav.map((n) => (
            <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}>
              {n.icon}
              <span>{n.label}</span>
              {n.badge}
            </button>
          ))}
        </nav>

        {subjects && subjects.length > 0 && (
          <div className="legend">
            <div className="sidebar-label">Subjects</div>
            {subjects.map((s) => (
              <div key={s.id} className="legend-item" style={{ '--c': s.color } as CSSProperties}>
                <span className="dot" />
                {s.name}
              </div>
            ))}
          </div>
        )}

        <div className="sidebar-foot">
          <div className="legend-key">
            <span className="key key-lecture" /> Lecture <span className="key key-done" /> Completed
          </div>
          <div className="legend-key">
            <span className="key key-plan" /> To do <span className="key key-due" /> Deadline
          </div>
        </div>
      </aside>

      <main className="main">
        {view === 'timetable' && weekStart && <TimetableView semester={semester} weekStart={weekStart} setWeekStart={setWeekStart} />}
        {view === 'outstanding' && (
          <OutstandingView
            semester={semester}
            showWeek={(w) => {
              setWeekStart(w);
              setView('timetable');
            }}
          />
        )}
        {view === 'subjects' && <SubjectsView semester={semester} />}
        {view === 'trash' && <TrashView />}
        {view === 'data' && <DataView />}
      </main>
    </div>
  );
}
