import { Fragment, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { useLoad, useUi } from '../ui';
import { useActions } from '../actions';
import { WEEKDAY_SHORT, formatDate, todayISO } from '../../shared/dates';
import { EXERCISE_STAGE_LABEL, exerciseStage, type Exercise, type Id, type Semester, type Subject } from '../../shared/types';
import { ExamDialog, ExerciseDialog, LectureDialog, SubjectDialog } from '../dialogs';
import { FocusPill } from '../components/FocusPill';
import { ExamRow } from '../components/ExamRow';
import { ChecklistProgress } from '../components/Checklist';
import { Book, ChevronDown, ChevronRight, Flag, Pencil, Plus, Repeat, StatusIcon, Trash } from '../components/Icons';

export function SubjectsView({ semester, focus, clearFocus }: { semester: Semester; focus: Subject | null; clearFocus: () => void }) {
  const ui = useUi();
  const actions = useActions();
  const { data } = useLoad(() => api.subjectOverview(semester.id), [semester.id]);
  const subjects: Subject[] = (data ?? []).map((o) => o.subject);
  const today = todayISO();

  const [expanded, setExpanded] = useState<ReadonlySet<Id>>(new Set());

  const newSubject = () => ui.dialog((close) => <SubjectDialog semesterId={semester.id} close={close} />);

  const toggle = (seriesId: Id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(seriesId)) next.add(seriesId);
      return next;
    });

  const exerciseRow = (e: Exercise) => (
    <button
      key={e.id}
      className={`row-item row-exercise status-${exerciseStage(e)}`}
      title={`${EXERCISE_STAGE_LABEL[exerciseStage(e)]} — edit exercise`}
      onClick={() => ui.dialog((close) => <ExerciseDialog semester={semester} subjects={subjects} exerciseId={e.id} close={close} />)}
    >
      <StatusIcon status={exerciseStage(e)} size={13} />
      <span className="row-title">{e.title}</span>
      <ChecklistProgress exercise={e} compact />
      <span className="row-due">
        <Flag size={11} /> {formatDate(e.deadlineDate, { weekday: true })}
      </span>
    </button>
  );

  return (
    <div className="page">
      <header className="view-header">
        <div className="week-title">
          <h1>Subjects</h1>
          <div className="week-sub">{semester.name} — subjects, exams, weekly lectures and exercises</div>
        </div>
        <span className="spacer" />
        <FocusPill subject={focus} onClear={clearFocus} />
        <button className="btn btn-primary" onClick={newSubject}>
          <Plus size={15} /> Subject
        </button>
      </header>

      {data && data.length === 0 && (
        <div className="empty-state">
          <Book size={36} />
          <h2>No subjects yet</h2>
          <p>Subjects group your lectures and exercises. Each gets its own color in the timetable.</p>
          <button className="btn btn-primary" onClick={newSubject}>
            <Plus size={15} /> Add your first subject
          </button>
        </div>
      )}

      <div className="subject-grid">
        {(data ?? []).map(({ subject, lectures, series, exercises, exerciseCount, exams }) => (
          <article key={subject.id} className={`subject-card ${focus && focus.id !== subject.id ? 'dimmed' : ''}`} style={{ '--c': subject.color } as CSSProperties}>
            <header>
              <span className="subject-swatch" />
              <h2>{subject.name}</h2>
              <span className="spacer" />
              <button className="icon-btn" title="Edit subject" onClick={() => ui.dialog((close) => <SubjectDialog semesterId={semester.id} subject={subject} close={close} />)}>
                <Pencil size={15} />
              </button>
              <button className="icon-btn" title="Delete subject" onClick={() => actions.deleteSubject(subject)}>
                <Trash size={15} />
              </button>
            </header>

            <section>
              <h3>Exams</h3>
              {exams.length === 0 && <p className="muted small">No exams yet. Add midterms, endterms and finals to see a countdown.</p>}
              {exams.map((x) => (
                <ExamRow
                  key={x.id}
                  exam={x}
                  today={today}
                  onClick={() => ui.dialog((close) => <ExamDialog semester={semester} subjects={subjects} examId={x.id} close={close} />)}
                />
              ))}
              <button
                className="btn btn-ghost small"
                onClick={() => ui.dialog((close) => <ExamDialog semester={semester} subjects={subjects} defaults={{ subjectId: subject.id }} close={close} />)}
              >
                <Plus size={13} /> Exam
              </button>
            </section>

            <section>
              <h3>Weekly lectures</h3>
              {lectures.length === 0 && <p className="muted small">No lectures yet.</p>}
              {lectures.map((l) => (
                <div key={l.id} className="row-item">
                  <span className="row-day">{WEEKDAY_SHORT[l.weekday - 1]}</span>
                  <span className="row-time">
                    {l.startTime}–{l.endTime}
                  </span>
                  <span className="row-title">{l.title}</span>
                  <button className="icon-btn small" title="Edit" onClick={() => ui.dialog((close) => <LectureDialog subjects={subjects} lectureId={l.id} close={close} />)}>
                    <Pencil size={13} />
                  </button>
                  <button className="icon-btn small" title="Delete" onClick={() => actions.deleteLecture(l)}>
                    <Trash size={13} />
                  </button>
                </div>
              ))}
              <button className="btn btn-ghost small" onClick={() => ui.dialog((close) => <LectureDialog subjects={subjects} defaults={{ subjectId: subject.id }} close={close} />)}>
                <Plus size={13} /> Lecture
              </button>
            </section>

            <section>
              <h3>Exercises</h3>
              <p className="muted small">
                {exerciseCount} exercise{exerciseCount === 1 ? '' : 's'} in total
              </p>
              {series.map((s) => {
                const open = expanded.has(s.id);
                return (
                  <Fragment key={s.id}>
                    <div className="row-item">
                      <button className="row-toggle" aria-expanded={open} title={open ? 'Hide exercises' : 'Show exercises'} onClick={() => toggle(s.id)}>
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <Repeat size={13} />
                        <span className="row-title">
                          {s.baseTitle}
                          <span className="muted"> · every {s.intervalWeeks === 1 ? 'week' : `${s.intervalWeeks} weeks`} · {s.occurrenceCount} active</span>
                        </span>
                      </button>
                      <button
                        className="btn btn-ghost small"
                        title="Append the next occurrence"
                        onClick={async () => {
                          const more = await ui.run(() => api.extendSeries(s.id, 1));
                          if (more) ui.toast(`Added ${more[0].title}`, { kind: 'success' });
                        }}
                      >
                        <Plus size={13} /> Next
                      </button>
                    </div>
                    {open && (
                      <div className="row-children">
                        {exercises.filter((e) => e.seriesId === s.id).map(exerciseRow)}
                      </div>
                    )}
                  </Fragment>
                );
              })}
              {exercises.filter((e) => e.seriesId === null).map(exerciseRow)}
              <button
                className="btn btn-ghost small"
                onClick={() => ui.dialog((close) => <ExerciseDialog semester={semester} subjects={subjects} defaults={{ subjectId: subject.id }} close={close} />)}
              >
                <Plus size={13} /> Exercise
              </button>
            </section>
          </article>
        ))}
      </div>
    </div>
  );
}
