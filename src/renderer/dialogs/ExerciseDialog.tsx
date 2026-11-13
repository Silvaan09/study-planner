import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { addDays, diffDays, formatDate, isValidISODate, todayISO, type ISODate } from '../../shared/dates';
import {
  EXERCISE_STAGES,
  EXERCISE_STATUSES,
  exerciseStage,
  type Exercise,
  type ExerciseChanges,
  type ExerciseSeries,
  type ExerciseStage,
  type Id,
  type Scope,
  type Semester,
  type Subject,
} from '../../shared/types';
import { Modal, useUi } from '../ui';
import { Plus, Repeat } from '../components/Icons';
import { DateField } from '../components/DatePicker';
import { useActions } from '../actions';
import { Field, Footer, StatusPicker } from './fields';
import { ConflictDialog, FIELD_LABEL } from './ConflictDialog';
import { normalizeDates, PlannedDatesField } from './PlannedDatesField';
import { ChecklistEditor, cleanSteps, draftSteps, type DraftStep } from './ChecklistEditor';

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
  /** deadlineDate alone: a new exercise with only that deadline (no planned days). */
  defaults?: { plannedDate?: ISODate; deadlineDate?: ISODate; subjectId?: Id };
  close: (ok?: boolean) => void;
}) {
  const ui = useUi();
  const actions = useActions();
  const isEdit = exerciseId !== undefined;
  const initialPlanned = defaults?.plannedDate ?? todayISO();
  const deadlineOnlyDefault = defaults?.deadlineDate !== undefined && defaults.plannedDate === undefined;
  const initialDeadline = defaults?.deadlineDate ?? addDays(initialPlanned, 7);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [series, setSeries] = useState<ExerciseSeries | null>(null);
  const [scope, setScope] = useState<Scope>('this');
  const [subjectId, setSubjectId] = useState<Id | ''>(defaults?.subjectId ?? subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [seriesTitleText, setSeriesTitleText] = useState('');
  const [description, setDescription] = useState('');
  const [planned, setPlanned] = useState<ISODate[]>(deadlineOnlyDefault ? [] : [initialPlanned]);
  // '' = no deadline.
  const [deadline, setDeadline] = useState<ISODate | ''>(initialDeadline);
  const [stage, setStage] = useState<ExerciseStage>('not_started');
  const status = stage === 'handed_in' ? 'completed' : stage;
  const handedIn = stage === 'handed_in';
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [repeat, setRepeat] = useState(false);
  const [interval, setIntervalWeeks] = useState(1);
  const [count, setCount] = useState(() => defaultCount(initialDeadline, semester.endDate, 1));
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
      setDeadline(e.deadlineDate ?? '');
      setStage(exerciseStage(e));
      setSteps(draftSteps(e.checklist));
      if (e.seriesId !== null) {
        const s = await api.getSeries(e.seriesId);
        setSeries(s);
        setSeriesTitleText(s.baseTitle);
      }
    });
  }, [exerciseId, isEdit]);

  const seriesScope = series !== null && scope !== 'this';
  const plannedDates = normalizeDates(planned);
  const latestPlanned = plannedDates[plannedDates.length - 1];
  const hasDeadline = isValidISODate(deadline);
  // No planned days = deadline only, which needs a deadline.
  const plannedValid = (planned.length > 0 || hasDeadline) && planned.every(isValidISODate);
  const dateError = latestPlanned && hasDeadline && latestPlanned > deadline ? "Planned days can't be after the deadline." : null;
  const activeTitle = seriesScope ? seriesTitleText : title;
  // A task: an exercise of the personal subject, i.e. one that belongs to no subject.
  const isTask = subjects.some((s) => s.personal && s.id === subjectId);
  const noun = isTask ? 'task' : 'exercise';
  const valid = subjectId !== '' && activeTitle.trim() && plannedValid && !dateError && (!isEdit || exercise);
  // Without a deadline there is nothing to hand in.
  const stages = hasDeadline ? EXERCISE_STAGES : EXERCISE_STATUSES;
  if (!hasDeadline && stage === 'handed_in') setStage('completed');

  // The series runs until the end of the semester, counted from the deadline (or the last planned day).
  const countFrom = hasDeadline ? deadline : (latestPlanned ?? '');
  useEffect(() => {
    if (!countTouched) setCount(defaultCount(countFrom, semester.endDate, interval));
  }, [countFrom, interval, countTouched, semester.endDate]);

  const preview = useMemo(() => {
    if (!repeat || !plannedValid) return [];
    return Array.from({ length: Math.min(count, 3) }, (_, i) => ({
      title: `${title || 'Title'} ${String(firstNumber + i).padStart(2, '0')}`,
      planned: plannedDates.map((d) => formatDate(addDays(d, 7 * interval * i), { weekday: true })).join(', '),
      due: hasDeadline ? addDays(deadline, 7 * interval * i) : null,
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
          deadlineDate: hasDeadline ? deadline : null,
          status,
          handedIn,
          checklist: cleanSteps(steps),
          recurrence: repeat ? { intervalWeeks: interval, count, firstNumber } : undefined,
        }),
      );
      if (created) {
        if (created.length > 1) ui.toast(`Created ${created.length} ${noun}s`, { kind: 'success' });
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
    if ((hasDeadline ? deadline : null) !== e.deadlineDate) changes.deadlineDate = hasDeadline ? deadline : null;
    if (status !== e.status) changes.status = status;
    if (handedIn !== e.handedIn) changes.handedIn = handedIn;
    const checklist = cleanSteps(steps);
    if (JSON.stringify(checklist) !== JSON.stringify(e.checklist.map(({ text, done }) => ({ text, done })))) changes.checklist = checklist;

    let res = await ui.run(() => api.updateExercise({ id: e.id, scope, changes }));
    if (res?.status === 'conflicts') {
      const policy = await ui.dialog<'overwrite' | 'keep'>((c) => <ConflictDialog conflicts={res!.status === 'conflicts' ? res!.conflicts : []} close={c} />);
      if (!policy) return;
      res = await ui.run(() => api.updateExercise({ id: e.id, scope, changes, overridePolicy: policy }));
    }
    if (res?.status === 'updated') {
      if (res.count > 1) ui.toast(`Updated ${res.count} ${noun}s`, { kind: 'success' });
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
      title={`${isEdit ? 'Edit' : 'New'} ${noun}`}
      onClose={() => close()}
      width={560}
      footer={
        <Footer
          onCancel={() => close()}
          onSave={save}
          disabled={!valid}
          saveLabel={isEdit ? 'Save' : repeat ? `Create ${count} ${noun}s` : `Create ${noun}`}
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
              same number of days. Checklist steps are copied too. Status and ticked steps apply to this exercise only.
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
                {s.personal ? `No subject · ${s.name}` : s.name}
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
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isTask ? 'e.g. Renew passport' : 'e.g. Problem Set'} autoFocus={!isEdit} />
          </Field>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <span className="field-label">Planned for (days I'll work on it)</span>
          <PlannedDatesField dates={planned} deadline={deadline} onChange={setPlanned} />
          {repeat && plannedDates.length > 0 && <span className="field-hint">These days repeat in every occurrence of the series.</span>}
        </div>
        <Field
          label="Deadline (hand-in)"
          error={dateError}
        >
          <DateField
            value={deadline}
            min={latestPlanned}
            marks={plannedDates.map((date) => ({ date, kind: 'planned' as const }))}
            onChange={setDeadline}
            onClear={() => setDeadline('')}
            clearLabel="Remove the deadline"
            placeholder="No deadline"
          />
        </Field>
      </div>

      <Field
        label="Status"
        hint={
          plannedDates.length === 0 && hasDeadline
            ? `Nothing planned to work on: hand it in (the flag on its deadline in the timetable) once it's dealt with.`
            : plannedDates.length > 1
            ? `Of the whole ${noun}: done once every planned day${steps.length ? ' or every checklist step' : ''} is. Each day is checked off on its own in the timetable and on the Today page.`
            : steps.length
              ? `Done once every checklist step is ticked off.`
              : undefined
        }
      >
        <StatusPicker value={stage} onChange={setStage} stages={stages} />
      </Field>

      <div className="field">
        <span className="field-label">Checklist</span>
        <ChecklistEditor steps={steps} onChange={setSteps} />
        {repeat && steps.length > 0 && <span className="field-hint">Every occurrence of the series gets these steps.</span>}
      </div>

      <Field label="Notes">
        <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </Field>

      {!isEdit && (
        <div className={`repeat-box ${repeat ? 'on' : ''}`}>
          <label className="checkbox">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            <Repeat size={14} /> Recurring {noun}
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
                      {p.planned ? `planned ${p.planned}` : 'deadline only'}
                      {p.due && ` · due ${formatDate(p.due, { weekday: true })}`}
                    </em>
                  </span>
                ))}
                {count > 3 && countFrom && (
                  <span className="muted">
                    … {count - 3} more, last {hasDeadline ? 'due' : 'planned'} {formatDate(addDays(countFrom, 7 * interval * (count - 1)), { weekday: true, year: true })}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
