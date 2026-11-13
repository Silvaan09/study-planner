import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { useLoad, useNow, useUi } from '../ui';
import { formatDate, formatDateRange, todayISO } from '../../shared/dates';
import { formatAverage, formatNumber, gradeStats, resultLabel, subjectOutcome, type GradeStats } from '../../shared/grades';
import { semesterLastDay } from '../../shared/currentSemester';
import type { Id, Semester, SemesterOverview, Subject } from '../../shared/types';
import { SemesterDialog, SubjectDialog } from '../dialogs';
import { ActivityGrid } from '../components/ActivityGrid';
import { GradeTrend, type TrendPoint } from '../components/GradeTrend';
import { ArrowLeft, Pencil, Plus } from '../components/Icons';

type Tab = 'overview' | Id;

/**
 * All semesters on one page (opened from the sidebar's semester button, full window): an overview with the overall
 * average, credits, a grade trend and one card per semester, then one tab per semester with its subjects' credits and
 * results and a day-by-day activity grid. Viewing a tab doesn't change the semester the planner shows.
 */
export function SemestersPage({
  overviews,
  activeId,
  onBack,
  onOpen,
}: {
  overviews: SemesterOverview[];
  /** The semester the planner shows. */
  activeId: Id;
  onBack: () => void;
  /** Make this the planner's semester and go back. */
  onOpen: (id: Id) => void;
}) {
  const ui = useUi();
  const [tab, setTab] = useState<Tab>('overview');
  const selected = tab === 'overview' ? null : (overviews.find((o) => o.semester.id === tab) ?? null);

  // Esc goes back (not while a dialog is open; dialogs handle their own Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal')) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  // A semester that went to the trash: back to the overview.
  useEffect(() => {
    if (tab !== 'overview' && !selected) setTab('overview');
  }, [tab, selected]);

  const newSemester = async () => {
    const s = await ui.dialog<Semester>((close) => <SemesterDialog close={close} />);
    if (s) setTab(s.id);
  };

  return (
    <div className="semesters-page">
      <header className="view-header sp-header">
        <button className="btn" onClick={onBack} title="Back (Esc)">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="week-title">
          <h1>Semesters</h1>
        </div>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={newSemester}>
          <Plus size={15} /> Semester
        </button>
      </header>
      <nav className="sp-tabs" role="tablist" aria-label="Semesters">
        <button role="tab" aria-selected={tab === 'overview'} className={`sp-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          Overview
        </button>
        {overviews.map((o) => (
          <button
            key={o.semester.id}
            role="tab"
            aria-selected={tab === o.semester.id}
            className={`sp-tab ${tab === o.semester.id ? 'active' : ''}`}
            onClick={() => setTab(o.semester.id)}
          >
            {o.semester.name}
            {o.semester.id === activeId && <span className="sp-tab-dot" title="Open in the planner" />}
          </button>
        ))}
      </nav>
      <div className="sp-body">
        {selected ? (
          <SemesterTab overview={selected} active={selected.semester.id === activeId} onOpen={() => onOpen(selected.semester.id)} />
        ) : (
          <OverviewTab overviews={overviews} activeId={activeId} onPick={setTab} onNew={newSemester} />
        )}
      </div>
    </div>
  );
}

function StatTiles({ stats, extra }: { stats: GradeStats; extra?: React.ReactNode }) {
  return (
    <div className="stat-row sp-stats">
      <div className="stat sp-stat">
        <div>
          <strong>{stats.average === null ? '–' : formatAverage(stats.average)}</strong>
          <span>Average{stats.average !== null && ` · weighted by ${formatNumber(stats.gradedCredits)} credits`}</span>
        </div>
      </div>
      <div className="stat sp-stat">
        <div>
          <strong>
            {formatNumber(stats.earnedCredits)}
            <small> / {formatNumber(stats.totalCredits)}</small>
          </strong>
          <span>Credits earned</span>
        </div>
      </div>
      {extra}
    </div>
  );
}

function OverviewTab({
  overviews,
  activeId,
  onPick,
  onNew,
}: {
  overviews: SemesterOverview[];
  activeId: Id;
  onPick: (id: Id) => void;
  onNew: () => void;
}) {
  const overall = useMemo(() => gradeStats(overviews.flatMap((o) => o.subjects)), [overviews]);
  const perSemester = useMemo(() => new Map(overviews.map((o) => [o.semester.id, gradeStats(o.subjects)])), [overviews]);
  const trend: TrendPoint[] = [...overviews]
    .sort((a, b) => a.semester.startDate.localeCompare(b.semester.startDate))
    .flatMap((o) => {
      const s = perSemester.get(o.semester.id)!;
      return s.average === null ? [] : [{ id: o.semester.id, label: o.semester.name, average: s.average, credits: s.gradedCredits }];
    });
  const subjects = overviews.reduce((n, o) => n + o.subjects.length, 0);

  return (
    <>
      <StatTiles
        stats={overall}
        extra={
          <div className="stat sp-stat">
            <div>
              <strong>{overviews.length}</strong>
              <span>
                Semester{overviews.length === 1 ? '' : 's'} · {subjects} subject{subjects === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        }
      />
      <section className="info-card sp-card">
        <h2 className="card-title">Average per semester</h2>
        {trend.length > 0 ? (
          <GradeTrend points={trend} onPick={onPick} />
        ) : (
          <p className="muted small">
            Enter your subjects' credits and grades (Manage subjects → edit a subject) and your averages show up here.
          </p>
        )}
      </section>
      <div className="sp-cards">
        {overviews.map((o) => {
          const s = perSemester.get(o.semester.id)!;
          return (
            <button key={o.semester.id} className="sp-sem-card" onClick={() => onPick(o.semester.id)}>
              <span className="sp-sem-name">
                {o.semester.name}
                {o.semester.id === activeId && <span className="badge sp-badge">In planner</span>}
              </span>
              <span className="sp-sem-dates">{formatDateRange(o.semester.startDate, o.semester.endDate)}</span>
              <span className="sp-sem-stats">
                <span>
                  <strong>{s.average === null ? '–' : formatAverage(s.average)}</strong>
                  <small>average</small>
                </span>
                <span>
                  <strong>
                    {formatNumber(s.earnedCredits)}
                    <small> / {formatNumber(s.totalCredits)}</small>
                  </strong>
                  <small>credits</small>
                </span>
                <span>
                  <strong>{o.subjects.length}</strong>
                  <small>subject{o.subjects.length === 1 ? '' : 's'}</small>
                </span>
              </span>
            </button>
          );
        })}
        <button className="sp-sem-card sp-sem-new" onClick={onNew}>
          <Plus size={18} /> New semester
        </button>
      </div>
    </>
  );
}

function SemesterTab({ overview, active, onOpen }: { overview: SemesterOverview; active: boolean; onOpen: () => void }) {
  const ui = useUi();
  const { semester, studyPeriod, subjects } = overview;
  const today = todayISO(useNow());
  const stats = useMemo(() => gradeStats(subjects), [subjects]);
  const { data: activity } = useLoad(() => api.getSemesterActivity(semester.id), [semester.id]);
  const last = semesterLastDay(overview);

  const editSubject = (s: Subject) => ui.dialog((close) => <SubjectDialog semesterId={semester.id} subject={s} close={close} />);

  return (
    <>
      <div className="sp-sem-head">
        <div>
          <h2>{semester.name}</h2>
          <div className="week-sub">
            {formatDateRange(semester.startDate, semester.endDate)}
            {studyPeriod && ` · exam study period until ${formatDate(studyPeriod.endDate, { year: true })}`}
          </div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => ui.dialog((close) => <SemesterDialog semester={semester} close={close} />)}>
          <Pencil size={14} /> Edit semester
        </button>
        <button className="btn btn-primary" onClick={onOpen}>
          {active ? 'Back to the planner' : 'Open in planner'}
        </button>
      </div>
      <StatTiles
        stats={stats}
        extra={
          <div className="stat sp-stat">
            <div>
              <strong>
                {stats.withResult}
                <small> / {subjects.length}</small>
              </strong>
              <span>Subjects with a result</span>
            </div>
          </div>
        }
      />
      <section className="info-card sp-card">
        <h2 className="card-title">Subjects</h2>
        {subjects.length === 0 ? (
          <p className="muted small">No subjects yet. Add them in Manage subjects.</p>
        ) : (
          <table className="sp-subjects">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Assessment</th>
                <th className="num">Credits</th>
                <th className="num">Result</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => {
                const outcome = subjectOutcome(s);
                return (
                  <tr key={s.id} onClick={() => editSubject(s)} title="Edit credits and result" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && editSubject(s)}>
                    <td>
                      <span className="sp-subject" style={{ '--c': s.color } as CSSProperties}>
                        <span className="dot" /> {s.name}
                      </span>
                    </td>
                    <td className="muted">{s.assessment === 'grade' ? 'Grade' : 'Pass/fail'}</td>
                    <td className="num">{s.credits === null ? <span className="muted">–</span> : formatNumber(s.credits)}</td>
                    <td className="num">
                      {outcome === null ? (
                        <span className="muted">–</span>
                      ) : (
                        <span className={`result-badge ${outcome}`}>{resultLabel(s)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {stats.gradesWithoutCredits > 0 && (
          <p className="muted small sp-note">
            {stats.gradesWithoutCredits === 1 ? 'One grade has' : `${stats.gradesWithoutCredits} grades have`} no credits, so{' '}
            {stats.gradesWithoutCredits === 1 ? "it isn't" : "they aren't"} counted in the average.
          </p>
        )}
      </section>
      <section className="info-card sp-card">
        <h2 className="card-title">Activity</h2>
        <p className="muted small sp-note-top">
          One square per day from {formatDate(semester.startDate)} to {formatDate(last, { year: true })}: the fuller, the more of that day's lectures and
          exercise sessions are done. Hover a day to see each subject.
        </p>
        {activity && <ActivityGrid days={activity} subjects={subjects} today={today} />}
      </section>
    </>
  );
}
