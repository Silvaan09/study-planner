import { useEffect, useState } from 'react';
import { api } from '../api';
import { addDays, diffDays, formatDateRange, isValidISODate, isValidTime, weekday, WEEKDAY_NAMES, type ISODate } from '../../shared/dates';
import type { Id, Lecture, Semester, Subject } from '../../shared/types';
import { Modal, useUi } from '../ui';
import { Repeat } from '../components/Icons';
import { DateField } from '../components/DatePicker';
import { useActions } from '../actions';
import { Field, Footer, TimeInput } from './fields';

/** How many times a lecture on `day` (1 = Monday) takes place between `from` and `to`. */
function weekdayCount(from: ISODate, to: ISODate, day: number): number {
  if (!isValidISODate(from) || !isValidISODate(to) || from > to) return 0;
  const first = addDays(from, (day - weekday(from) + 7) % 7);
  return first > to ? 0 : Math.floor(diffDays(first, to) / 7) + 1;
}

export function LectureDialog({
  semester,
  subjects,
  lectureId,
  defaults,
  weekStart,
  close,
}: {
  semester: Semester;
  subjects: Subject[];
  lectureId?: Id;
  defaults?: Partial<Lecture>;
  /** When opened from the timetable: the week of the clicked occurrence (enables per-week deletion). */
  weekStart?: ISODate;
  close: (ok?: boolean) => void;
}) {
  const ui = useUi();
  const actions = useActions();
  const courses = subjects.filter((s) => !s.personal);
  const [loaded, setLoaded] = useState<Lecture | null>(null);
  const [subjectId, setSubjectId] = useState<Id | ''>(defaults?.subjectId ?? courses[0]?.id ?? '');
  const [title, setTitle] = useState(defaults?.title ?? '');
  const [day, setDay] = useState(defaults?.weekday ?? 1);
  const [start, setStart] = useState(defaults?.startTime ?? '10:00');
  const [end, setEnd] = useState(defaults?.endTime ?? '12:00');
  // The days it takes place; the semester's start and end unless changed (stored as "the semester's", see save).
  const clampToSemester = (d: ISODate | null | undefined, fallback: ISODate) =>
    !d ? fallback : d < semester.startDate ? semester.startDate : d > semester.endDate ? semester.endDate : d;
  const [from, setFrom] = useState(semester.startDate);
  const [until, setUntil] = useState(semester.endDate);

  useEffect(() => {
    if (lectureId === undefined) return;
    api.getLecture(lectureId).then((l) => {
      setLoaded(l);
      setSubjectId(l.subjectId);
      setTitle(l.title);
      setDay(l.weekday);
      setStart(l.startTime);
      setEnd(l.endTime);
      setFrom(clampToSemester(l.startDate, semester.startDate));
      setUntil(clampToSemester(l.endDate, semester.endDate));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureId]);

  const timeError = !isValidTime(start) || !isValidTime(end) ? 'Use 24-hour HH:MM' : start >= end ? 'Must end after it starts' : null;
  const count = weekdayCount(from, until, day);
  const wholeSemester = from === semester.startDate && until === semester.endDate;
  const datesError =
    from > until ? 'Must be on or after the first lecture' : count === 0 ? `No ${WEEKDAY_NAMES[day - 1]} in these dates` : null;
  const valid = subjectId !== '' && title.trim() && !timeError && !datesError;

  const save = async () => {
    const input = {
      subjectId: subjectId as Id,
      title,
      weekday: day,
      startTime: start,
      endTime: end,
      // The semester's own start / end are stored as "none", so the lecture follows later changes to the semester.
      startDate: from === semester.startDate ? null : from,
      endDate: until === semester.endDate ? null : until,
    };
    const ok = await ui.run(() => (lectureId !== undefined ? api.updateLecture(lectureId, input) : api.createLecture(input)));
    if (ok) {
      if (lectureId === undefined) {
        ui.toast(wholeSemester ? `Lecture added every ${WEEKDAY_NAMES[day - 1]}` : `Lecture added: ${count} × ${WEEKDAY_NAMES[day - 1]}`, { kind: 'success' });
      }
      close(true);
    }
  };

  if (courses.length === 0) {
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
          {courses.map((s) => (
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
      <div className="field-row">
        <Field label="First lecture">
          <DateField value={from} onChange={setFrom} min={semester.startDate} max={semester.endDate} range={{ start: semester.startDate, end: semester.endDate }} />
        </Field>
        <Field label="Last lecture" error={datesError}>
          <DateField value={until} onChange={setUntil} min={semester.startDate} max={semester.endDate} range={{ start: semester.startDate, end: semester.endDate }} />
        </Field>
      </div>
      <p className="muted small">
        <Repeat size={13} />{' '}
        {wholeSemester
          ? 'Repeats every week of the semester'
          : `${count} time${count === 1 ? '' : 's'}, ${formatDateRange(from, until)}`}
        , except during breaks. Each week's completion is tracked separately.
        {lectureId !== undefined && ' Changes apply to all weeks; completion states are kept.'}
      </p>
    </Modal>
  );
}
