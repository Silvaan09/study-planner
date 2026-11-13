import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { diffDays, formatDateRange, isValidISODate, type ISODate } from '../../shared/dates';
import { breakTitle, type Id, type Semester, type SemesterBreak } from '../../shared/types';
import { Modal, useLoad, useUi } from '../ui';
import { Palm, Pencil, Plus, Trash } from '../components/Icons';
import { DateField } from '../components/DatePicker';
import { useActions } from '../actions';
import { Field } from './fields';

/**
 * Lists a semester's breaks and holidays and adds / edits / deletes them; every change is saved right away.
 * `date` prefills a new break (timetable day header), `editId` opens one for editing.
 */
export function BreaksDialog({ semester, date, editId, close }: { semester: Semester; date?: ISODate; editId?: Id; close: () => void }) {
  const ui = useUi();
  const actions = useActions();
  const { data: breaks } = useLoad(() => api.listBreaks(semester.id), [semester.id]);
  const [editing, setEditing] = useState<Id | null>(null);
  const [name, setName] = useState('');
  const [from, setFrom] = useState<ISODate>(date ?? '');
  const [to, setTo] = useState<ISODate>(date ?? '');
  const nameRef = useRef<HTMLInputElement>(null);

  const edit = (b: SemesterBreak) => {
    setEditing(b.id);
    setName(b.name);
    setFrom(b.startDate);
    setTo(b.endDate);
    nameRef.current?.focus();
  };
  const reset = () => {
    setEditing(null);
    setName('');
    setFrom('');
    setTo('');
  };
  const openedEdit = useRef(false);
  useEffect(() => {
    if (openedEdit.current || !breaks || editId === undefined) return;
    openedEdit.current = true;
    const b = breaks.find((x) => x.id === editId);
    if (b) edit(b);
  }, [breaks, editId]);

  const datesSet = isValidISODate(from) && isValidISODate(to);
  const error = !datesSet
    ? null
    : from > to
      ? 'Must be on or after the first day'
      : to < semester.startDate || from > semester.endDate
        ? 'Outside the semester'
        : null;
  const valid = datesSet && !error;
  const range = { start: semester.startDate, end: semester.endDate };

  const save = async () => {
    const input = { semesterId: semester.id, name, startDate: from, endDate: to };
    const b = await ui.run(() => (editing !== null ? api.updateBreak(editing, input) : api.createBreak(input)));
    if (!b) return;
    const when = b.startDate === b.endDate ? 'that day' : formatDateRange(b.startDate, b.endDate);
    ui.toast(`${breakTitle(b)} ${editing !== null ? 'saved' : 'added'}: no lectures ${when}`, { kind: 'success' });
    reset();
  };

  return (
    <Modal
      title="Breaks & holidays"
      onClose={close}
      width={540}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <p className="muted small">
        No lectures take place during a break or on a holiday. Exercises, tasks and exams stay where they are.
      </p>
      <div className="break-list">
        {breaks?.length === 0 && <p className="muted small">No breaks or holidays in {semester.name} yet.</p>}
        {breaks?.map((b) => (
          <div key={b.id} className={`row-item break-row ${editing === b.id ? 'editing' : ''}`}>
            <Palm size={15} />
            <span className="row-title">{breakTitle(b)}</span>
            <span className="break-dates">{formatDateRange(b.startDate, b.endDate)}</span>
            <span className="break-days">
              {diffDays(b.startDate, b.endDate) + 1} day{b.startDate === b.endDate ? '' : 's'}
            </span>
            <button className="icon-btn small" title="Edit" onClick={() => edit(b)}>
              <Pencil size={13} />
            </button>
            <button
              className="icon-btn small"
              title="Delete"
              onClick={async () => {
                if ((await actions.deleteBreak(b)) && editing === b.id) reset();
              }}
            >
              <Trash size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="break-form">
        <h3>{editing !== null ? 'Edit break' : 'Add a break or holiday'}</h3>
        <Field label="Name">
          <input ref={nameRef} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Autumn break (optional)" />
        </Field>
        <div className="field-row">
          <Field label="First day">
            <DateField
              value={from}
              range={range}
              onChange={(d) => {
                setFrom(d);
                if (!isValidISODate(to) || to < d) setTo(d);
              }}
            />
          </Field>
          <Field label="Last day" error={error}>
            <DateField value={to} range={range} min={isValidISODate(from) ? from : undefined} onChange={setTo} />
          </Field>
        </div>
        <div className="button-row">
          <span className="spacer" />
          {editing !== null && (
            <button className="btn" onClick={reset}>
              Cancel
            </button>
          )}
          <button className="btn btn-primary" disabled={!valid} onClick={save}>
            {editing !== null ? (
              'Save break'
            ) : (
              <>
                <Plus size={14} /> Add
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
