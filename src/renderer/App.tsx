import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from './api';
import { useLoad, useUi } from './ui';
import { formatDate, todayISO, type ISODate } from '../shared/dates';
import type { Id, Semester, SemesterOverview } from '../shared/types';
import { currentSemesterId, initialWeek } from '../shared/currentSemester';
import { BreaksDialog, ExamDialog, ExerciseDialog, LectureDialog, SemesterDialog } from './dialogs';
import { TodayView } from './views/TodayView';
import { TimetableView } from './views/timetable/TimetableView';
import { OutstandingView } from './views/OutstandingView';
import { SubjectsView } from './views/SubjectsView';
import { TrashView } from './views/TrashView';
import { SettingsView } from './views/SettingsView';
import { SemestersPage } from './views/SemestersPage';
import { SearchPalette, targetWeek, type SearchPick, type SearchView } from './components/SearchPalette';
import { useUpdateStatus } from './updates';
import { WhatsNewDialog } from './components/WhatsNew';
import { useRestartToUpdate } from './components/UpdatingOverlay';
import { Calendar, ChevronRight, Download, Layers, ListTodo, Palm, Plus, Search, Settings, Sliders, Sun, Trash, X } from './components/Icons';
import logo from './logo.svg';

const VIEWS = ['today', 'timetable', 'outstanding', 'subjects', 'trash', 'settings'] as const;
type View = (typeof VIEWS)[number];

/** The views (and the breaks dialog) as search results. */
const SEARCH_VIEWS: SearchView[] = [
  { id: 'today', label: 'Today', icon: <Sun size={15} />, keywords: ['streak', 'schedule'] },
  { id: 'timetable', label: 'Timetable', icon: <Calendar size={15} />, keywords: ['week', 'calendar'] },
  { id: 'outstanding', label: 'Outstanding', icon: <ListTodo size={15} />, keywords: ['overdue', 'missed', 'open'] },
  { id: 'subjects', label: 'Manage subjects', icon: <Sliders size={15} />, keywords: ['lectures', 'exams', 'series'] },
  { id: 'breaks', label: 'Breaks & holidays', icon: <Palm size={15} />, keywords: ['vacation', 'semester'] },
  { id: 'semesters', label: 'Semesters', icon: <Layers size={15} />, keywords: ['grades', 'credits', 'average', 'results', 'activity'] },
  { id: 'trash', label: 'Trash', icon: <Trash size={15} />, keywords: ['deleted', 'restore'] },
  { id: 'settings', label: 'Settings', icon: <Settings size={15} />, keywords: ['sound', 'updates', 'backup', 'data'] },
];

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

/** The semester picked in this session, else today's (see currentSemesterId: its exam study period counts too). */
function pickSemester(list: SemesterOverview[], pickedId: number | null): SemesterOverview | null {
  const id = list.some((o) => o.semester.id === pickedId) ? pickedId : currentSemesterId(list, todayISO());
  return list.find((o) => o.semester.id === id) ?? null;
}

export function App() {
  const ui = useUi();
  // Every start opens today's semester; switching (on the Semesters page) lasts for the session.
  const { data: overviews } = useLoad(() => api.listSemesterOverview(), []);
  const semesters = useMemo(() => overviews?.map((o) => o.semester), [overviews]);
  const [semesterId, setSemesterId] = useState<number | null>(null);
  // The Semesters page covers the whole window; the planner's state stays as it was underneath.
  const [semestersOpen, setSemestersOpen] = useState(false);
  const [view, setView] = useState<View>(rememberedView);
  const [weekStart, setWeekStart] = useState<ISODate | null>(null);
  // Subject picked in the sidebar: the timetable greys out the others, Outstanding shows only it. Not remembered.
  const [focusId, setFocusId] = useState<Id | null>(null);

  const current = useMemo(() => (overviews ? pickSemester(overviews, semesterId) : null), [overviews, semesterId]);
  const semester = current?.semester ?? null;

  useEffect(() => {
    if (semester && semester.id !== semesterId) setSemesterId(semester.id);
  }, [semester, semesterId]);
  useEffect(() => {
    if (current) {
      setWeekStart(initialWeek(current, todayISO()));
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

  const update = useUpdateStatus();
  const restartToUpdate = useRestartToUpdate();

  // "What's new" once after an update. Without any semester (a fresh start) there is nothing new to tell.
  const whatsNewChecked = useRef(false);
  useEffect(() => {
    if (!semesters || whatsNewChecked.current) return;
    whatsNewChecked.current = true;
    if (semesters.length === 0) {
      void api.markWhatsNewSeen();
      return;
    }
    api.getWhatsNew().then(
      async (notes) => {
        if (!notes) return;
        await ui.dialog((close) => <WhatsNewDialog notes={notes} close={() => close()} />);
        void api.markWhatsNewSeen();
      },
      () => {},
    );
  }, [semesters, ui]);

  /** Opens what a search result points at (Shift: its week in the timetable). */
  const openPick = useCallback(
    ({ target: t, alt }: SearchPick) => {
      if (!semester) return;
      // Picked while the Semesters page is open: show it in the planner (unless it's that page itself).
      setSemestersOpen(t.kind === 'view' && t.id === 'semesters');
      const list = subjects ?? [];
      const week = alt ? targetWeek(t, semester, todayISO()) : null;
      if (week) {
        setWeekStart(week);
        setView('timetable');
        return;
      }
      switch (t.kind) {
        case 'view':
          if (t.id === 'breaks') ui.dialog((close) => <BreaksDialog semester={semester} close={close} />);
          else if (t.id === 'semesters') setSemestersOpen(true);
          else setView(t.id as View);
          break;
        case 'subject':
          setFocusId(t.subject.id);
          if (view === 'trash' || view === 'settings') setView('timetable');
          break;
        case 'lecture':
          ui.dialog((close) => <LectureDialog semester={semester} subjects={list} lectureId={t.lecture.id} close={close} />);
          break;
        case 'exercise':
          ui.dialog((close) => <ExerciseDialog semester={semester} subjects={list} exerciseId={t.exercise.id} close={close} />);
          break;
        case 'exam':
          ui.dialog((close) => <ExamDialog semester={semester} subjects={list} examId={t.exam.id} close={close} />);
          break;
        case 'break':
          ui.dialog((close) => <BreaksDialog semester={semester} editId={t.brk.id} close={close} />);
          break;
      }
    },
    [semester, subjects, ui, view],
  );
  const openSearch = useCallback(async () => {
    // Not on top of an open dialog.
    if (!semester || document.querySelector('.modal')) return;
    const pick = await ui.dialog<SearchPick>((close) => <SearchPalette semester={semester} views={SEARCH_VIEWS} close={close} />);
    if (pick) openPick(pick);
  }, [semester, ui, openPick]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        void openSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);

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

  if (semestersOpen && overviews) {
    return (
      <SemestersPage
        overviews={overviews}
        activeId={semester.id}
        onBack={() => setSemestersOpen(false)}
        onOpen={(id) => {
          setSemesterId(id);
          setSemestersOpen(false);
          if (view === 'trash' || view === 'settings') setView('timetable');
        }}
      />
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="" width={28} height={28} />
          <span>Study Planner</span>
        </div>

        <button className="search-btn" onClick={() => void openSearch()} title="Search (Ctrl+F)">
          <Search size={15} />
          <span>Search</span>
          <kbd>Ctrl F</kbd>
        </button>

        <div className="semester-picker">
          <div className="sidebar-label">Semester</div>
          {/* Opens the Semesters page: switching, new and edit semester, grades and activity. */}
          <button className="semester-btn" onClick={() => setSemestersOpen(true)} title="All semesters, grades and activity">
            <span className="semester-btn-text">
              <strong>{semester.name}</strong>
              <small>
                {formatDate(semester.startDate, { year: true })} – {formatDate(semester.endDate, { year: true })}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
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
          {/* Real subjects, then the personal tasks (listed last by the service). */}
          {subjects?.map((s) => {
            const active = focus?.id === s.id;
            const what = s.name;
            return (
              <Fragment key={s.id}>
                {s.personal && subjects.every((x) => x.personal) && <p className="sidebar-empty">No subjects yet.</p>}
                <button
                  className={`subject-item ${s.personal ? 'personal' : ''} ${active ? 'active' : ''} ${focus && !active ? 'faded' : ''}`}
                  style={{ '--c': s.color } as CSSProperties}
                  aria-pressed={active}
                  title={active ? `Showing only ${what} — click to show everything` : `Show only ${what}`}
                  onClick={() => toggleFocus(s.id)}
                >
                  <span className="dot" />
                  <span className="subject-name">{s.name}</span>
                  {active && <X size={13} />}
                </button>
              </Fragment>
            );
          })}
          {navItem('subjects', 'Manage subjects', <Sliders size={18} />)}
        </nav>

        <nav className="nav-section sidebar-foot" aria-label="More">
          {update?.state === 'ready' && (
            <button className="nav-item update-ready" onClick={() => restartToUpdate(update.version)} title="Restarts the app and installs the update. Otherwise it installs when you close the app.">
              <Download size={18} />
              <span>Restart to update</span>
              <span className="nav-badge">{update.version}</span>
            </button>
          )}
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
