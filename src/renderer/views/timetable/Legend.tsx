import { Info } from '../../components/Icons';

/** The top-left corner cell of a week: the legend for the card styles, on hover or keyboard focus. */
export function Legend() {
  return (
    <div className="tt-gutter tt-corner">
      {/* Legend for the card styles, on hover or keyboard focus. */}
      <button className="icon-btn small legend-btn" aria-label="Legend">
        <Info size={15} />
      </button>
      <div className="legend-pop" role="tooltip">
        <div className="legend-key">
          <span className="key key-lecture" /> Lecture
        </div>
        <div className="legend-key">
          <span className="key key-done" /> Completed
        </div>
        <div className="legend-key">
          <span className="key key-missed" /> Missed
        </div>
        <div className="legend-key">
          <span className="key key-plan" /> To do
        </div>
        <div className="legend-key">
          <span className="key key-due" /> Deadline
        </div>
        <div className="legend-key">
          <span className="key key-exam" /> Exam
        </div>
        <div className="legend-key">
          <span className="key key-break" /> Break or holiday
        </div>
        <div className="legend-key">
          <span className="key key-study" /> Exam study period
        </div>
      </div>
    </div>
  );
}
