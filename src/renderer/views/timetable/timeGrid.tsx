import type { CSSProperties } from 'react';
import { timeToMinutes } from '../../../shared/dates';
import { Check } from '../../components/Icons';
import { HOUR_PX, type WeekLayout } from './layout';
import type { WeekContext } from './weekContext';

/** A week's time grid: hour lines, one column per day with its lecture cards, and the now line. */
export function renderTimeGrid(L: WeekLayout, ctx: WeekContext) {
  const { today, nowMin, dayClass, dropProps, colorOf, subjectName, dim, lectureMenu, toggleLecture, newLecture } = ctx;
  return (
    <div className="tt-row tt-grid" style={{ height: L.hours.length * HOUR_PX }}>
      <div className="tt-gutter tt-hours">
        {L.hours.map((h) => (
          <div key={h} className="hour-label" style={{ top: (h - L.firstHour) * HOUR_PX }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>
      {L.days.map((d, i) => (
        <div
          key={d}
          className={`tt-col ${dayClass(d, L.week)}`}
          {...dropProps(d)}
          onDoubleClick={(ev) => {
            const y = ev.clientY - (ev.currentTarget as HTMLElement).getBoundingClientRect().top;
            newLecture(i + 1, Math.min(22 * 60, L.firstHour * 60 + Math.floor(y / HOUR_PX) * 60));
          }}
        >
          {L.hours.map((h) => (
            <div key={h} className="hour-line" style={{ top: (h - L.firstHour) * HOUR_PX }} />
          ))}
          {L.lecturesByDay.get(d)!.map((p) => {
            const o = p.occ;
            const past = o.date < today || (o.date === today && timeToMinutes(o.endTime) <= nowMin);
            const top = ((p.start - L.firstHour * 60) / 60) * HOUR_PX;
            const height = Math.max(22, ((p.end - p.start) / 60) * HOUR_PX - 2);
            return (
              <button
                key={o.lectureId}
                className={`lecture ${o.completed ? 'completed' : past ? 'missed' : ''} ${height < 40 ? 'short' : ''} ${p.cols > 1 ? 'narrow' : ''} ${dim(o.subjectId)}`}
                style={
                  {
                    '--c': colorOf(o.subjectId),
                    '--h': `${height}px`,
                    top,
                    left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                    width: `calc(${100 / p.cols}% - 4px)`,
                  } as CSSProperties
                }
                onClick={() => toggleLecture(o)}
                onDoubleClick={(ev) => ev.stopPropagation()}
                onContextMenu={(ev) => lectureMenu(ev, o)}
                title={`${o.title} (${subjectName(o.subjectId)})\n${o.startTime}–${o.endTime}\n${o.completed ? 'Completed' : 'Not completed'}`}
              >
                <span className="lec-body">
                  <span className="lec-check">{o.completed ? <Check size={12} /> : null}</span>
                  <span className="lec-title">{o.title}</span>
                  <span className="lec-meta">
                    {o.startTime}–{o.endTime}
                  </span>
                  <span className="lec-meta">{subjectName(o.subjectId)}</span>
                </span>
                <span
                  className="lec-more"
                  role="button"
                  title="More"
                  onClick={(ev) => lectureMenu(ev, o)}
                >
                  ⋯
                </span>
              </button>
            );
          })}
          {d === today && nowMin >= L.firstHour * 60 && nowMin <= L.lastHour * 60 && (
            <div className="now-line" style={{ top: ((nowMin - L.firstHour * 60) / 60) * HOUR_PX }} />
          )}
        </div>
      ))}
    </div>
  );
}
