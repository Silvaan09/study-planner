import { addDays, isValidISODate, todayISO, weekday, WEEKDAY_NAMES, type ISODate } from '../../shared/dates';
import { Plus, Repeat, X } from '../components/Icons';
import { DateField } from '../components/DatePicker';

/** Sorted, de-duplicated valid dates. */
export function normalizeDates(dates: ISODate[]): ISODate[] {
  return [...new Set(dates.filter(isValidISODate))].sort();
}

/**
 * Editable list of the days an exercise is planned to be worked on. With a deadline, every day can be removed: the
 * exercise then has only its deadline (e.g. a registration).
 */
export function PlannedDatesField({ dates, deadline, onChange }: { dates: ISODate[]; deadline: ISODate; onChange: (d: ISODate[]) => void }) {
  const first = normalizeDates(dates)[0];
  const weekdayName = first ? WEEKDAY_NAMES[weekday(first) - 1] : null;
  const hasDeadline = isValidISODate(deadline);
  const addDay = () => {
    const last = normalizeDates(dates).pop();
    const today = todayISO();
    onChange([...dates, last ? addDays(last, 1) : hasDeadline && today > deadline ? deadline : today]);
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
          <DateField
            value={d}
            max={isValidISODate(deadline) ? deadline : undefined}
            marks={[
              ...dates.filter((x, j) => j !== i && isValidISODate(x)).map((date) => ({ date, kind: 'planned' as const })),
              ...(isValidISODate(deadline) ? [{ date: deadline, kind: 'deadline' as const }] : []),
            ]}
            onChange={(v) => onChange(dates.map((x, j) => (j === i ? v : x)))}
          />
          {(dates.length > 1 || hasDeadline) && (
            <button
              type="button"
              className="icon-btn small"
              title={dates.length > 1 ? 'Remove this day' : 'Remove this day (only the deadline is left)'}
              onClick={() => onChange(dates.filter((_, j) => j !== i))}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      {dates.length === 0 && (
        <div className={`planned-none ${hasDeadline ? '' : 'invalid'}`}>
          {hasDeadline ? 'None: deadline only, nothing to work on.' : 'Plan a day to work on it, or set a deadline.'}
        </div>
      )}
      <div className="planned-actions">
        <button type="button" className="btn btn-ghost small" onClick={addDay}>
          <Plus size={13} /> {dates.length === 0 ? 'Plan a day' : 'Add another day'}
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
