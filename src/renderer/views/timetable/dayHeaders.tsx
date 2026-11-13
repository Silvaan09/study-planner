import { formatDate, formatDateRange, WEEKDAY_SHORT } from '../../../shared/dates';
import { breakOn, breakTitle } from '../../../shared/types';
import { Palm } from '../../components/Icons';
import { Legend } from './Legend';
import type { WeekLayout } from './layout';
import type { WeekContext } from './weekContext';

/** A week's header row: the legend corner and one header per day (date, month, break pill; right-click = day menu). */
export function renderDayHeaders(L: WeekLayout, ctx: WeekContext) {
  const { dayClass, dropProps, dayMenu } = ctx;
  return (
    <div className="tt-row tt-head">
      <Legend />
      {L.days.map((d, i) => (
        <div key={d} className={`tt-day-head ${dayClass(d, L.week)}`} {...dropProps(d)} onContextMenu={(ev) => dayMenu(ev, d, L.week)}>
          <span className="dow">{WEEKDAY_SHORT[i]}</span>
          <span className="dom">{+d.slice(8)}</span>
          {d.slice(8) === '01' || i === 0 ? <span className="mon">{formatDate(d).split(' ')[1]}</span> : null}
          {(() => {
            const b = breakOn(L.week?.breaks ?? [], d);
            return b ? (
              <span className="day-break" title={`${breakTitle(b)} (${formatDateRange(b.startDate, b.endDate)}): no lectures`}>
                <Palm size={12} />
                <span>{breakTitle(b)}</span>
              </span>
            ) : null;
          })()}
        </div>
      ))}
    </div>
  );
}
