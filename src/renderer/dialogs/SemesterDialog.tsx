import { useState } from 'react';
import { api } from '../api';
import { addDays, diffDays, formatDateRange, isValidISODate, startOfWeek, todayISO } from '../../shared/dates';
import { breakTitle, type Semester } from '../../shared/types';
import { Modal, useLoad, useUi } from '../ui';
import { Palm } from '../components/Icons';
import { DateField } from '../components/DatePicker';
import { useActions } from '../actions';
import { Field, Footer } from './fields';
import { BreaksDialog } from './BreaksDialog';

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
  const semesterRange = weeks ? { start, end } : undefined;
  const { data: breaks } = useLoad(() => (semester ? api.listBreaks(semester.id) : Promise.resolve([])), [semester?.id]);

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
          <DateField value={start} onChange={setStart} range={semesterRange} />
        </Field>
        <Field label="End date" error={error}>
          <DateField value={end} onChange={setEnd} range={semesterRange} />
        </Field>
      </div>
      {weeks && (
        <p className="muted small">
          Spans {weeks} week{weeks === 1 ? '' : 's'}. Lectures repeat weekly within these dates
          {semester ? ', except during breaks.' : '. Breaks and holidays can be added once the semester exists (Edit semester).'}
        </p>
      )}
      {semester && (
        <div className="semester-breaks">
          <span className="field-label">Breaks &amp; holidays</span>
          <div className="break-chips">
            {breaks?.map((b) => (
              <span key={b.id} className="break-chip" title={`No lectures ${formatDateRange(b.startDate, b.endDate)}`}>
                {breakTitle(b)} · {formatDateRange(b.startDate, b.endDate)}
              </span>
            ))}
            {breaks?.length === 0 && <span className="muted small">None</span>}
            <button className="btn btn-ghost small" onClick={() => ui.dialog((close) => <BreaksDialog semester={semester} close={close} />)}>
              <Palm size={14} /> {breaks?.length ? 'Manage…' : 'Add…'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
