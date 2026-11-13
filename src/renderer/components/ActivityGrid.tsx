import { useMemo, useState, type CSSProperties } from 'react';
import { addDays, formatDate, weeksBetween, type ISODate } from '../../shared/dates';
import type { ActivityDay, Id, Subject } from '../../shared/types';
import { activityCell, ACTIVITY_LEVELS } from '../activity';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

interface Hover {
  day: ActivityDay;
  x: number;
  y: number;
}

/**
 * A semester day by day, like a contribution graph: one square per day (columns = weeks, rows = Mon–Sun), the fuller
 * the more of that day's lectures and exercise sessions are done. Hovering shows each subject's share.
 */
export function ActivityGrid({ days, subjects, today }: { days: ActivityDay[]; subjects: Subject[]; today: ISODate }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const subjectById = useMemo(() => new Map<Id, Subject>(subjects.map((s) => [s.id, s])), [subjects]);
  if (days.length === 0) return null;
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const weeks = weeksBetween(first, last);

  // A month's name above the first week that has one of its days in range.
  let prevMonth = '';
  const monthLabels = weeks.map((w) => {
    const d = w < first ? first : w;
    const month = d.slice(0, 7);
    if (month === prevMonth) return '';
    prevMonth = month;
    return MONTHS[+month.slice(5) - 1];
  });

  return (
    <div className="activity" style={{ '--ag-weeks': weeks.length } as CSSProperties} onMouseLeave={() => setHover(null)}>
      <div className="ag-body">
        <div className="ag-weekdays" aria-hidden>
          {WEEKDAYS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="ag-main">
          <div className="ag-months" aria-hidden>
            {monthLabels.map((m, i) => (
              <span key={weeks[i]}>{m}</span>
            ))}
          </div>
          <div className="ag-grid" role="grid" aria-label="Activity per day">
            {weeks.flatMap((w) =>
              [0, 1, 2, 3, 4, 5, 6].map((i) => {
                const date = addDays(w, i);
                const day = byDate.get(date);
                if (!day) return <span key={date} className="ag-cell ag-none" aria-hidden />;
                const cell = activityCell(day, today);
                return (
                  <span
                    key={date}
                    role="gridcell"
                    aria-label={`${formatDate(date, { weekday: true })}: ${cell.label}`}
                    className={`ag-cell ag-l${cell.level} ${cell.future ? 'ag-future' : ''} ${date === today ? 'ag-today' : ''}`}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget;
                      setHover({ day, x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop });
                    }}
                  />
                );
              }),
            )}
          </div>
          {hover && <ActivityTooltip hover={hover} today={today} subjectById={subjectById} />}
        </div>
      </div>
      <div className="ag-legend" aria-hidden>
        <span>Done:</span>
        <span>none</span>
        {[0, ...ACTIVITY_LEVELS].map((l) => (
          <span key={l} className={`ag-cell ag-l${l}`} />
        ))}
        <span>all</span>
        <span className="ag-cell ag-future ag-l0" />
        <span>upcoming</span>
      </div>
    </div>
  );
}

function ActivityTooltip({ hover, today, subjectById }: { hover: Hover; today: ISODate; subjectById: Map<Id, Subject> }) {
  const { day } = hover;
  const cell = activityCell(day, today);
  const rows = [...day.subjects].sort((a, b) => (subjectById.get(a.subjectId)?.name ?? '').localeCompare(subjectById.get(b.subjectId)?.name ?? ''));
  return (
    // Centred over the day, except near the left edge, where it would stick out.
    <div className={`ag-tip ${hover.x < 150 ? 'start' : ''}`} style={{ left: hover.x, top: hover.y }} role="tooltip">
      <div className="ag-tip-head">
        <strong>{formatDate(day.date, { weekday: true, year: true })}</strong>
        <span>{cell.label}</span>
      </div>
      {rows.map((r) => {
        const s = subjectById.get(r.subjectId);
        return (
          <div key={r.subjectId} className="ag-tip-row" style={{ '--c': s?.color ?? 'var(--text-3)' } as CSSProperties}>
            <span className="dot" />
            <span className="ag-tip-name">{s?.name ?? 'Subject'}</span>
            <span className="ag-tip-bar">
              <span style={{ width: `${(r.done / r.total) * 100}%` }} />
            </span>
            <span className="ag-tip-count">
              {r.done}/{r.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}
