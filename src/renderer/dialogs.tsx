import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import {
  addDays,
  diffDays,
  formatDate,
  isValidISODate,
  isValidTime,
  startOfWeek,
  todayISO,
  weekday,
  WEEKDAY_NAMES,
  type ISODate,
} from '../shared/dates';
import {
  EXERCISE_STATUS_LABEL,
  EXERCISE_STATUSES,
  type Exercise,
  type ExerciseChanges,
  type ExerciseSeries,
  type ExerciseStatus,
  type Id,
  type Lecture,
  type OverridableField,
  type OverrideConflict,
  type Scope,
  type Semester,
  type Subject,
} from '../shared/types';
import { Modal, useUi } from './ui';
import { Plus, Repeat, StatusIcon, Trash, X } from './components/Icons';
import { useActions } from './actions';

export const SUBJECT_COLORS = [
  '#4f6bed', '#0ea5e9', '#14b8a6', '#22a55b', '#84cc16', '#eab308',
  '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1',
  '#64748b', '#8b5a2b',
];

function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function Footer({
  onCancel,
  onSave,
  saveLabel = 'Save',
  disabled,
  onDelete,
  extra,
}: {
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  disabled?: boolean;
  onDelete?: () => void;
  extra?: ReactNode;
}) {
  return (
    <>
      {onDelete && (
        <button className="btn btn-ghost-danger" onClick={onDelete}>
          <Trash /> Delete
        </button>
      )}
      {extra}
      <span className="spacer" />
      <button className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button className="btn btn-primary" onClick={onSave} disabled={disabled}>
        {saveLabel}
      </button>
    </>
  );
}

/** Text input for 24-hour times. Accepts "9", "915", "9:15", "09.15" and normalizes to "09:15". */
export function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const normalize = (raw: string): string => {
    const s = raw.trim().replace(/[.h]/g, ':');
    let m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
    if (!m && /^\d{3,4}$/.test(s)) m = /^(\d{1,2})(\d{2})$/.exec(s);
    if (!m) return raw;
    const h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (h > 23 || min > 59) return raw;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };
  return (
    <input
      className="input time-input"
      value={value}
      placeholder="HH:MM"
      maxLength={5}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onChange(normalize(e.target.value))}
    />
  );
}

// ------------------------------------------------------------------ semester

export function SemesterDialog({ semester, close }: { semester?: Semester; close: (s?: Semester) => void }) {
  const ui = useUi();
  const actions = useActions();
  const today = todayISO();
  const [name, setName] = useState(semester?.name ?? '');
  const [start, setStart] = useState(semester?.startDate ?? startOfWeek(today));
  const [end, setEnd] = useState(semester?.endDate ?? addDays(startOfWeek(today), 7 * 14 - 3));
  const error = isValidISODate(start) && isValidISODate(end) && start > end ? 'The end date must be on or after the start date.' : null;
  const valid = name.trim() && isValidISODate(start) && isValidISODate(end) && !error;

  const save = async () => {
    const input = { name, startDate: start, endDate: end };
    const s = await ui.run(() => (semester ? api.updateSemester(semester.id, input) : api.createSemester(input)));
    if (s) close(s);
  };
  const weeks = isValidISODate(start) && isValidISODate(end) && !error ? Math.ceil((diffDays(start, end) + 1) / 7) : null;

  return (
    <Modal
      title={semester ? 'Edit semester' : 'New semester'}
      onClose={() => close()}
      footer={
        <Footer
          onCancel={() => close()}
          onSave={save}
          disabled={!valid}
          saveLabel={semester ? 'Save' : 'Create semester'}
          onDelete={semester ? async () => (await actions.deleteSemester(semester)) && close() : undefined}
        />
      }
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Autumn Semester 2026" autoFocus />
      </Field>
      <div className="field-row">
        <Field label="Start date">
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End date" error={error}>
          <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      {weeks && <p className="muted small">Spans {weeks} week{weeks === 1 ? '' : 's'}. Lectures repeat weekly within these dates.</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------ subject

export function SubjectDialog({ semesterId, subject, close }: { semesterId: Id; subject?: Subject; close: (s?: Subject) => void }) {
  const ui = useUi();
  const actions = useActions();
  const [name, setName] = useState(subject?.name ?? '');
  const [color, setColor] = useState(subject?.color ?? SUBJECT_COLORS[Math.floor(Math.random() * 12)]);

  const save = async () => {
    const input = { semesterId, name, color };
    const s = await ui.run(() => (subject ? api.updateSubject(subject.id, input) : api.createSubject(input)));
    if (s) close(s);
  };
  return (
    <Modal
      title={subject ? 'Edit subject' : 'New subject'}
      onClose={() => close()}
      footer={
        <Footer
          onCancel={() => close()}
          onSave={save}
          disabled={!name.trim()}
          saveLabel={subject ? 'Save' : 'Create subject'}
          onDelete={subject ? async () => (await actions.deleteSubject(subject)) && close() : undefined}
        />
      }
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mathematics" autoFocus />
      </Field>
      <Field label="Color">
        <div className="swatches">
          {SUBJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${c === color ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={c}
            />
          ))}
          <input type="color" className="swatch-custom" value={color} onChange={(e) => setColor(e.target.value)} title="Custom color" />
        </div>
      </Field>
      <div className="subject-preview" style={{ '--c': color } as React.CSSProperties}>
        <span className="dot" /> {name || 'Subject'}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ lecture

export function LectureDialog({
  subjects,
  lectureId,
  defaults,
  weekStart,
  close,
}: {
  subjects: Subject[];
  lectureId?: Id;
  defaults?: Partial<Lecture>;
  /** When opened from the timetable: the week of the clicked occurrence (enables per-week deletion). */
  weekStart?: ISODate;
  close: (ok?: boolean) => void;
}) {
  const ui = useUi();
  const actions = useActions();
  const [loaded, setLoaded] = useState<Lecture | null>(null);
  const [subjectId, setSubjectId] = useState<Id | ''>(defaults?.subjectId ?? subjects[0]?.id ?? '');
  const [title, setTitle] = useState(defaults?.title ?? '');
  const [day, setDay] = useState(defaults?.weekday ?? 1);
  const [start, setStart] = useState(defaults?.startTime ?? '10:00');
  const [end, setEnd] = useState(defaults?.endTime ?? '12:00');

  useEffect(() => {
    if (lectureId === undefined) return;
    api.getLecture(lectureId).then((l) => {
      setLoaded(l);
      setSubjectId(l.subjectId);
      setTitle(l.title);
      setDay(l.weekday);
      setStart(l.startTime);
      setEnd(l.endTime);
    });
  }, [lectureId]);

  const timeError = !isValidTime(start) || !isValidTime(end) ? 'Use 24-hour HH:MM' : start >= end ? 'Must end after it starts' : null;
  const valid = subjectId !== '' && title.trim() && !timeError;

  const save = async () => {
    const input = { subjectId: subjectId as Id, title, weekday: day, startTime: start, endTime: end };
    const ok = await ui.run(() => (lectureId !== undefined ? api.updateLecture(lectureId, input) : api.createLecture(input)));
    if (ok) {
      if (lectureId === undefined) ui.toast(`Lecture added every ${WEEKDAY_NAMES[day - 1]}`, { kind: 'success' });
      close(true);
    }
  };

  if (subjects.length === 0) {
    return (
      <Modal title="New lecture" onClose={() => close()}>
        <p>Create a subject first — every lecture belongs to a subject.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={lectureId !== undefined ? 'Edit lecture' : 'New lecture'}
      onClose={() => close()}
      footer={
        <Footer
          onCancel={() => close()}
          onSave={save}
          disabled={!valid || (lectureId !== undefined && !loaded)}
          saveLabel={lectureId !== undefined ? 'Save' : 'Add lecture'}
          onDelete={
            loaded
              ? async () => {
                  if (await actions.deleteLecture(loaded, weekStart)) close(true);
                }
              : undefined
          }
        />
      }
    >
      <Field label="Subject">
        <select className="input" value={subjectId} onChange={(e) => setSubjectId(+e.target.value)}>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Linear Algebra" autoFocus />
      </Field>
      <div className="field-row three">
        <Field label="Day">
          <select className="input" value={day} onChange={(e) => setDay(+e.target.value)}>
            {WEEKDAY_NAMES.map((n, i) => (
              <option key={n} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start">
          <TimeInput value={start} onChange={setStart} />
        </Field>
        <Field label="End" error={timeError}>
          <TimeInput value={end} onChange={setEnd} />
        </Field>
      </div>
      <p className="muted small">
        <Repeat size={13} /> Repeats every week within the semester. Each week's completion is tracked separately.
        {lectureId !== undefined && ' Changes apply to all weeks; completion states are kept.'}
      </p>
    </Modal>
  );
}

// ------------------------------------------------------------------ exercise

export function StatusPicker({ value, onChange }: { value: ExerciseStatus; onChange: (s: ExerciseStatus) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {EXERCISE_STATUSES.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} className={`seg status-${s} ${value === s ? 'active' : ''}`} onClick={() => onChange(s)}>
          <StatusIcon status={s} size={14} /> {EXERCISE_STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

const FIELD_LABEL: Record<OverridableField, string> = {
  title: 'title',
  description: 'notes',
  plannedDate: 'planned dates',
  deadlineDate: 'deadline',
  subjectId: 'subject',
};

function ConflictDialog({ conflicts, close }: { conflicts: OverrideConflict[]; close: (p?: 'overwrite' | 'keep') => void }) {
  return (
    <Modal
      title="Some exercises were changed individually"
      onClose={() => close()}
      width={500}
      footer={
        <>
          <button className="btn" onClick={() => close()}>
            Cancel
          </button>
          <span className="spacer" />
          <button className="btn" onClick={() => close('overwrite')}>
            Overwrite them
          </button>
          <button className="btn btn-primary" onClick={() => close('keep')} autoFocus>
            Keep individual changes
          </button>
        </>
      }
    >
      <p>These exercises have their own changes to the fields you edited:</p>
      <ul className="conflict-list">
        {conflicts.map((c) => (
          <li key={c.id}>
            <strong>{c.title}</strong> — {c.fields.map((f) => FIELD_LABEL[f]).join(', ')}
          </li>
        ))}
      </ul>
      <p className="muted small">"Keep" updates everything else and leaves those fields untouched on these exercises.</p>
    </Modal>
  );
}

/** Sorted, de-duplicated valid dates. */
function normalizeDates(dates: ISODate[]): ISODate[] {
  return [...new Set(dates.filter(isValidISODate))].sort();
}

/** Editable list of the days an exercise is planned to be worked on. */
function PlannedDatesField({ dates, deadline, onChange }: { dates: ISODate[]; deadline: ISODate; onChange: (d: ISODate[]) => void }) {
  const first = normalizeDates(dates)[0];
  const weekdayName = first ? WEEKDAY_NAMES[weekday(first) - 1] : null;
  const addDay = () => {
    const last = normalizeDates(dates).pop();
    onChange([...dates, last ? addDays(last, 1) : todayISO()]);
  };
  const everyWeek = () => {
    const weekly: ISODate[] = [];
    for (let d = first!; d <= deadline && weekly.length < 100; d = addDays(d, 7)) weekly.push(d);
    onChange(normalizeDates([...dates, ...weekly]));
  };
  return (
    <div className="planned-dates">
      {dates.map((d, i) => (
        <div key={i} className="planned-row">
          <input
            type="date"
            className="input"
            value={d}
            max={deadline}
            onChange={(e) => onChange(dates.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {dates.length > 1 && (
            <button type="button" className="icon-btn small" title="Remove this day" onClick={() => onChange(dates.filter((_, j) => j !== i))}>
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      <div className="planned-actions">
        <button type="button" className="btn btn-ghost small" onClick={addDay}>
          <Plus size={13} /> Add another day
        </button>
        {weekdayName && isValidISODate(deadline) && first! <= deadline && (
          <button type="button" className="btn btn-ghost small" onClick={everyWeek} title={`Plan every ${weekdayName} from the first day until the deadline`}>
            <Repeat size={13} /> Every {weekdayName} until the deadline
          </button>
        )}
      </div>
    </div>
  );
}

function defaultCount(deadline: ISODate, semEnd: ISODate, interval: number): number {
  if (!isValidISODate(deadline) || deadline > semEnd) return 1;
  return Math.min(200, Math.floor(diffDays(deadline, semEnd) / (7 * interval)) + 1);
}

export function ExerciseDialog({
  semester,
  subjects,
  exerciseId,
  defaults,
  close,
}: {
  semester: Semester;
  subjects: Subject[];
  exerciseId?: Id;
  defaults?: { plannedDate?: ISODate; subjectId?: Id };
  close: (ok?: boolean) => void;
}) {
  const ui = useUi();
  const actions = useActions();
  const isEdit = exerciseId !== undefined;
  const initialPlanned = defaults?.plannedDate ?? todayISO();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [series, setSeries] = useState<ExerciseSeries | null>(null);
  const [scope, setScope] = useState<Scope>('this');
  const [subjectId, setSubjectId] = useState<Id | ''>(defaults?.subjectId ?? subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [seriesTitleText, setSeriesTitleText] = useState('');
  const [description, setDescription] = useState('');
  const [planned, setPlanned] = useState<ISODate[]>([initialPlanned]);
  const [deadline, setDeadline] = useState(addDays(initialPlanned, 7));
  const [status, setStatus] = useState<ExerciseStatus>('not_started');
  const [repeat, setRepeat] = useState(false);
  const [interval, setIntervalWeeks] = useState(1);
  const [count, setCount] = useState(() => defaultCount(addDays(initialPlanned, 7), semester.endDate, 1));
  const [countTouched, setCountTouched] = useState(false);
  const [firstNumber, setFirstNumber] = useState(1);

  useEffect(() => {
    if (!isEdit) return;
    api.getExercise(exerciseId).then(async (e) => {
      setExercise(e);
      setSubjectId(e.subjectId);
      setTitle(e.title);
      setDescription(e.description);
      setPlanned(e.plannedDates);
      setDeadline(e.deadlineDate);
      setStatus(e.status);
      if (e.seriesId !== null) {
        const s = await api.getSeries(e.seriesId);
        setSeries(s);
        setSeriesTitleText(s.baseTitle);
      }
    });
  }, [exerciseId, isEdit]);

  useEffect(() => {
    if (!countTouched) setCount(defaultCount(deadline, semester.endDate, interval));
  }, [deadline, interval, countTouched, semester.endDate]);

  const seriesScope = series !== null && scope !== 'this';
  const plannedDates = normalizeDates(planned);
  const latestPlanned = plannedDates[plannedDates.length - 1];
  const plannedValid = planned.length > 0 && planned.every(isValidISODate);
  const dateError =
    latestPlanned && isValidISODate(deadline) && latestPlanned > deadline ? "Planned days can't be after the deadline." : null;
  const activeTitle = seriesScope ? seriesTitleText : title;
  const valid = subjectId !== '' && activeTitle.trim() && plannedValid && isValidISODate(deadline) && !dateError && (!isEdit || exercise);

  const preview = useMemo(() => {
    if (!repeat || !plannedValid || !isValidISODate(deadline)) return [];
    return Array.from({ length: Math.min(count, 3) }, (_, i) => ({
      title: `${title || 'Title'} ${String(firstNumber + i).padStart(2, '0')}`,
      planned: plannedDates.map((d) => formatDate(addDays(d, 7 * interval * i), { weekday: true })).join(', '),
      due: addDays(deadline, 7 * interval * i),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeat, planned, deadline, count, title, firstNumber, interval]);

  const save = async () => {
    if (!isEdit) {
      const created = await ui.run(() =>
        api.createExercise({
          subjectId: subjectId as Id,
          title,
          description,
          plannedDates,
          deadlineDate: deadline,
          status,
          recurrence: repeat ? { intervalWeeks: interval, count, firstNumber } : undefined,
        }),
      );
      if (created) {
        if (created.length > 1) ui.toast(`Created ${created.length} exercises`, { kind: 'success' });
        close(true);
      }
      return;
    }
    const e = exercise!;
    const changes: ExerciseChanges = {};
    if (seriesScope) {
      if (seriesTitleText !== series!.baseTitle) changes.title = seriesTitleText;
    } else if (title !== e.title) changes.title = title;
    if (description !== e.description) changes.description = description;
    if (subjectId !== e.subjectId) changes.subjectId = subjectId as Id;
    if (plannedDates.join() !== e.plannedDates.join()) changes.plannedDates = plannedDates;
    if (deadline !== e.deadlineDate) changes.deadlineDate = deadline;
    if (status !== e.status) changes.status = status;

    let res = await ui.run(() => api.updateExercise({ id: e.id, scope, changes }));
    if (res?.status === 'conflicts') {
      const policy = await ui.dialog<'overwrite' | 'keep'>((c) => <ConflictDialog conflicts={res!.status === 'conflicts' ? res!.conflicts : []} close={c} />);
      if (!policy) return;
      res = await ui.run(() => api.updateExercise({ id: e.id, scope, changes, overridePolicy: policy }));
    }
    if (res?.status === 'updated') {
      if (res.count > 1) ui.toast(`Updated ${res.count} exercises`, { kind: 'success' });
      close(true);
    }
  };

  if (subjects.length === 0) {
    return (
      <Modal title="New exercise" onClose={() => close()}>
        <p>Create a subject first — every exercise belongs to a subject.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={isEdit ? 'Edit exercise' : 'New exercise'}
      onClose={() => close()}
      width={560}
      footer={
        <Footer
          onCancel={() => close()}
          onSave={save}
          disabled={!valid}
          saveLabel={isEdit ? 'Save' : repeat ? `Create ${count} exercises` : 'Create exercise'}
          onDelete={exercise ? async () => (await actions.deleteExercise(exercise)) && close(true) : undefined}
          extra={
            series ? (
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  const more = await ui.run(() => api.extendSeries(series.id, 1));
                  if (more) ui.toast(`Added ${more[0].title}`, { kind: 'success' });
                }}
                title="Append the next occurrence to this series"
              >
                <Plus size={14} /> Next occurrence
              </button>
            ) : undefined
          }
        />
      }
    >
      {series && (
        <div className="series-banner">
          <div className="series-banner-title">
            <Repeat size={14} /> Part of the series <strong>"{series.baseTitle}"</strong> · every {series.intervalWeeks === 1 ? 'week' : `${series.intervalWeeks} weeks`}
          </div>
          <div className="segmented full">
            {(
              [
                ['this', 'Only this exercise'],
                ['future', 'This & following'],
                ['all', 'Whole series'],
              ] as [Scope, string][]
            ).map(([v, l]) => (
              <button key={v} type="button" className={`seg ${scope === v ? 'active' : ''}`} onClick={() => setScope(v)}>
                {l}
              </button>
            ))}
          </div>
          {seriesScope && (
            <p className="small muted">
              Planned days are copied to every affected exercise at the same place in its cycle; a changed deadline shifts each one by the
              same number of days. Status applies to this exercise only.
            </p>
          )}
          {!seriesScope && exercise && exercise.overrides.length > 0 && (
            <p className="small muted">Individually changed: {exercise.overrides.map((f) => FIELD_LABEL[f]).join(', ')}.</p>
          )}
        </div>
      )}

      <div className="field-row">
        <Field label="Subject">
          <select className="input" value={subjectId} onChange={(e) => setSubjectId(+e.target.value)}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {seriesScope ? (
          <Field label="Series title" hint={`This exercise becomes "${seriesTitleText} ${String(exercise?.sequenceNumber ?? 0).padStart(2, '0')}"`}>
            <input className="input" value={seriesTitleText} onChange={(e) => setSeriesTitleText(e.target.value)} />
          </Field>
        ) : (
          <Field label="Title" hint={repeat ? 'A number is appended: "Problem Set 01", "Problem Set 02", …' : undefined}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Problem Set" autoFocus={!isEdit} />
          </Field>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <span className="field-label">Planned for (days I'll work on it)</span>
          <PlannedDatesField dates={planned} deadline={deadline} onChange={setPlanned} />
          {repeat && plannedDates.length > 0 && <span className="field-hint">These days repeat in every occurrence of the series.</span>}
        </div>
        <Field label="Deadline (hand-in)" error={dateError}>
          <input type="date" className="input" value={deadline} min={latestPlanned} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
      </div>

      <Field label="Status">
        <StatusPicker value={status} onChange={setStatus} />
      </Field>

      <Field label="Notes">
        <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </Field>

      {!isEdit && (
        <div className={`repeat-box ${repeat ? 'on' : ''}`}>
          <label className="checkbox">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            <Repeat size={14} /> Recurring exercise
          </label>
          {repeat && (
            <>
              <div className="field-row three">
                <Field label="Every … weeks">
                  <input type="number" className="input" min={1} max={52} value={interval} onChange={(e) => setIntervalWeeks(Math.max(1, Math.min(52, +e.target.value || 1)))} />
                </Field>
                <Field label="Occurrences">
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={200}
                    value={count}
                    onChange={(e) => {
                      setCountTouched(true);
                      setCount(Math.max(1, Math.min(200, +e.target.value || 1)));
                    }}
                  />
                </Field>
                <Field label="First number">
                  <input type="number" className="input" min={0} max={9999} value={firstNumber} onChange={(e) => setFirstNumber(Math.max(0, +e.target.value || 0))} />
                </Field>
              </div>
              <div className="repeat-preview">
                {preview.map((p) => (
                  <span key={p.title}>
                    {p.title}{' '}
                    <em>
                      planned {p.planned} · due {formatDate(p.due, { weekday: true })}
                    </em>
                  </span>
                ))}
                {count > 3 && <span className="muted">… {count - 3} more, last due {formatDate(addDays(deadline, 7 * interval * (count - 1)), { weekday: true, year: true })}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

