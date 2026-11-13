import { useEffect, useState } from 'react';
import { api } from '../api';
import { addDays, diffDays, isValidISODate, isValidTime, todayISO, type ISODate } from '../../shared/dates';
import { EXAM_KIND_LABEL, EXAM_KINDS, type Exam, type ExamKind, type Id, type Semester, type Subject } from '../../shared/types';
import { Modal, useUi } from '../ui';
import { DateField } from '../components/DatePicker';
import { useActions } from '../actions';
import { Field, Footer, TimeInput } from './fields';

/** Default date for a new exam: the middle of the semester for a midterm, its last day otherwise (never in the past). */
function defaultExamDate(semester: Semester, kind: ExamKind): ISODate {
  const mid = addDays(semester.startDate, Math.floor(diffDays(semester.startDate, semester.endDate) / 2));
  const d = kind === 'midterm' ? mid : semester.endDate;
  const today = todayISO();
  return d < today ? today : d;
}

export function ExamDialog({
  semester,
  subjects,
  examId,
  defaults,
  close,
}: {
  semester: Semester;
  subjects: Subject[];
  examId?: Id;
  defaults?: { subjectId?: Id; kind?: ExamKind };
  close: (ok?: boolean) => void;
}) {
  const ui = useUi();
  const actions = useActions();
  const isEdit = examId !== undefined;
  const courses = subjects.filter((s) => !s.personal);
  const [loaded, setLoaded] = useState<Exam | null>(null);
  const [subjectId, setSubjectId] = useState<Id | ''>(defaults?.subjectId ?? courses[0]?.id ?? '');
  const [kind, setKind] = useState<ExamKind>(defaults?.kind ?? 'midterm');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => defaultExamDate(semester, defaults?.kind ?? 'midterm'));
  const [dateTouched, setDateTouched] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (examId === undefined) return;
    api.getExam(examId).then((e) => {
      setLoaded(e);
      setSubjectId(e.subjectId);
      setKind(e.kind);
      setTitle(e.title);
      setDate(e.date);
      setDateTouched(true);
      setStart(e.startTime ?? '');
      setEnd(e.endTime ?? '');
      setLocation(e.location);
      setNotes(e.notes);
    });
  }, [examId]);

  const pickKind = (k: ExamKind) => {
    setKind(k);
    if (!isEdit && !dateTouched) setDate(defaultExamDate(semester, k));
  };

  const timeError =
    (start && !isValidTime(start)) || (end && !isValidTime(end))
      ? 'Use 24-hour HH:MM'
      : end && !start
        ? 'Enter a start time too'
        : start && end && start >= end
          ? 'Must end after it starts'
          : null;
  const valid = subjectId !== '' && isValidISODate(date) && !timeError && (!isEdit || loaded);

  const save = async () => {
    const input = { subjectId: subjectId as Id, kind, title, date, startTime: start || null, endTime: end || null, location, notes };
    const ok = await ui.run(() => (examId !== undefined ? api.updateExam(examId, input) : api.createExam(input)));
    if (ok) close(true);
  };

  if (courses.length === 0) {
    return (
      <Modal title="New exam" onClose={() => close()}>
        <p>Create a subject first — every exam belongs to a subject.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={isEdit ? 'Edit exam' : 'New exam'}
      onClose={() => close()}
      width={520}
      footer={
        <Footer
          onCancel={() => close()}
          onSave={save}
          disabled={!valid}
          saveLabel={isEdit ? 'Save' : 'Add exam'}
          onDelete={loaded ? async () => (await actions.deleteExam(loaded)) && close(true) : undefined}
        />
      }
    >
      <Field label="Kind">
        <div className="segmented full" role="radiogroup">
          {EXAM_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`seg ${kind === k ? 'active' : ''}`} onClick={() => pickKind(k)}>
              {k === 'other' ? 'Other' : EXAM_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </Field>
      <div className="field-row">
        <Field label="Subject">
          <select className="input" value={subjectId} onChange={(e) => setSubjectId(+e.target.value)}>
            {courses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" hint="Optional">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={EXAM_KIND_LABEL[kind]} autoFocus={!isEdit} />
        </Field>
      </div>
      <div className="field-row three">
        <Field label="Date">
          <DateField
            value={date}
            range={{ start: semester.startDate, end: semester.endDate }}
            onChange={(d) => {
              setDate(d);
              setDateTouched(true);
            }}
          />
        </Field>
        <Field label="Start" hint="Optional">
          <TimeInput value={start} onChange={setStart} />
        </Field>
        <Field label="End" error={timeError}>
          <TimeInput value={end} onChange={setEnd} />
        </Field>
      </div>
      <Field label="Room">
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional, e.g. HG F 1" />
      </Field>
      <Field label="Notes">
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Topics, allowed aids, …" />
      </Field>
    </Modal>
  );
}
