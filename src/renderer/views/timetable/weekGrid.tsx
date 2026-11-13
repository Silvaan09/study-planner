import { renderDayHeaders } from './dayHeaders';
import { renderDueRow } from './dueRow';
import type { WeekLayout } from './layout';
import { renderPlannedRow } from './plannedRow';
import { renderTimeGrid } from './timeGrid';
import type { WeekContext } from './weekContext';

/**
 * One week's grid. Only the current pane is interactive; the panes beside it are `inert` and only seen while
 * swiping. One scroll container per week for all its rows, so every row has the same width and the day lines align.
 * A plain function (not a component), so the panes' DOM is kept across renders.
 */
export function renderWeek(L: WeekLayout, pane: 'prev' | 'current' | 'next', ctx: WeekContext) {
  const { scrollRef, prevScrollRef, nextScrollRef, stickyRef, alignPanes } = ctx;
  return (
    <div key={L.days[0]} className="tt-pane" inert={pane !== 'current'}>
      <div
        className="tt-scroll"
        ref={pane === 'current' ? scrollRef : pane === 'prev' ? prevScrollRef : nextScrollRef}
        style={L.style}
        data-first-hour={L.firstHour}
        onScroll={pane === 'current' ? alignPanes : undefined}
      >
        <div className="tt-sticky" ref={pane === 'current' ? stickyRef : undefined}>
          {/* Day headers */}
          {renderDayHeaders(L, ctx)}

          {/* Planned exercises */}
          {renderPlannedRow(L, ctx)}

          {/* Exams and deadlines */}
          {renderDueRow(L, ctx)}
        </div>

        {/* Time grid */}
        {renderTimeGrid(L, ctx)}
      </div>
    </div>
  );
}
