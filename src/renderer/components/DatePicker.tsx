import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  formatDate,
  formatMonth,
  isValidISODate,
  MONTH_SHORT,
  startOfMonth,
  startOfWeek,
  todayISO,
  weekday,
  type ISODate,
} from '../../shared/dates';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from './Icons';

const WEEKDAY_MIN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MARK_LABEL = { planned: 'Planned day', deadline: 'Deadline' } as const;

/** A day highlighted with a dot in the calendar (e.g. the other planned days and the deadline of an exercise). */
export interface DateMark {
  date: ISODate;
  kind: keyof typeof MARK_LABEL;
}

export interface CalendarOptions {
  /** The selected day (in `weeks` mode: any day of the selected week). Invalid or empty = nothing selected. */
  value: ISODate;
  /** Earliest / latest selectable day. */
  min?: ISODate;
  max?: ISODate;
  marks?: DateMark[];
  /** Days tinted as belonging together (e.g. the semester). */
  range?: { start: ISODate; end: ISODate };
  /** Week selection: rows highlight as whole weeks. */
  weeks?: boolean;
}

function clamp(d: ISODate, min?: ISODate, max?: ISODate): ISODate {
  if (min && d < min) return min;
  if (max && d > max) return max;
  return d;
}

/** Height of one week row in px (row + gap). The scroller shows VISIBLE_WEEKS rows and always rests on a whole row. */
const ROW_PX = 34;
const VISIBLE_WEEKS = 6;
/** Weeks reachable by scrolling on either side of the initial day (~10 years). */
const SPAN_WEEKS = 520;
/** Extra rows rendered above/below the visible ones. */
const OVERSCAN = 4;

function CalendarPanel({
  value,
  min,
  max,
  marks,
  range,
  weeks,
  onSelect,
  onClose,
}: CalendarOptions & { onSelect: (d: ISODate) => void; onClose: () => void }) {
  const today = todayISO();
  const selected = isValidISODate(value) ? value : null;
  // The weeks form one continuous list starting at `origin`; only the rows near the viewport are rendered.
  const [origin] = useState(() => addDays(startOfWeek(clamp(selected ?? today, min, max)), -7 * SPAN_WEEKS));
  const lastDay = addDays(origin, 7 * (2 * SPAN_WEEKS + 1) - 1);
  const rowOf = (d: ISODate) => diffDays(origin, startOfWeek(d)) / 7;
  const inList = (d: ISODate) => clamp(d, origin, lastDay);

  // The highlighted day (keyboard focus or mouse hover).
  const [focus, setFocusOnly] = useState<ISODate>(() => clamp(selected ?? today, min, max));
  // Scroll position; starts with the focused day's month at the top, like a month page.
  const [top, setTop] = useState(() => rowOf(startOfMonth(focus)) * ROW_PX);
  const [mode, setMode] = useState<'days' | 'months'>('days');
  const [pickerYear, setPickerYear] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The month the view is "in" (title, brighter days, base for the ↑ ↓ buttons): the one with the most visible days
  // (the earlier one on a tie). With a month's first week at the top, that is always this month.
  const activeMonth = useMemo(() => {
    const first = addDays(origin, Math.round(top / ROW_PX) * 7);
    const count = new Map<ISODate, number>();
    for (let i = 0; i < VISIBLE_WEEKS * 7; i++) {
      const m = startOfMonth(addDays(first, i));
      count.set(m, (count.get(m) ?? 0) + 1);
    }
    return [...count].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
  }, [origin, top]);

  // Where a running smooth scroll will end (and, for month steps, which month it shows), so repeated clicks or
  // wheel notches continue from the target instead of from wherever the animation currently is.
  const pending = useRef<{ top: number; month?: ISODate } | null>(null);
  const wheelRest = useRef(0);

  /** Smooth-scrolls to `y` (always a whole row). */
  const animateTo = (y: number, month?: ISODate) => {
    const el = scrollRef.current;
    if (!el) return;
    y = Math.max(0, Math.min(y, el.scrollHeight - el.clientHeight));
    if (Math.abs(el.scrollTop - y) < 1) {
      pending.current = null;
      return;
    }
    pending.current = { top: y, month };
    el.scrollTo({ top: y, behavior: 'smooth' });
  };
  /** Moves the highlight and scrolls just enough to show it. */
  const setFocus = (d: ISODate) => {
    d = inList(d);
    setFocusOnly(d);
    const el = scrollRef.current;
    if (!el) return;
    const y = rowOf(d) * ROW_PX;
    const viewTop = pending.current?.top ?? el.scrollTop;
    if (y < viewTop) animateTo(y);
    else if (y + ROW_PX > viewTop + el.clientHeight) animateTo(y + ROW_PX - el.clientHeight);
  };
  /** Scrolls so the week containing the 1st of `month` is the top row, and highlights day `dayNum` of it (clamped to the month's length). */
  const showMonth = (month: ISODate, dayNum: number, smooth = true) => {
    month = startOfMonth(inList(month));
    const day = Math.min(dayNum, daysInMonth(+month.slice(0, 4), +month.slice(5, 7)));
    setFocusOnly(inList(`${month.slice(0, 8)}${String(day).padStart(2, '0')}`));
    const y = rowOf(month) * ROW_PX;
    // Smooth scrolling reports its progress via onScroll; a jump (e.g. from the month view, where the list isn't mounted) sets it directly.
    if (smooth && scrollRef.current) animateTo(y, month);
    else {
      pending.current = null;
      setTop(y);
      if (scrollRef.current) scrollRef.current.scrollTop = y;
    }
  };
  /** One month up/down from the month shown (or being scrolled to). */
  const stepMonth = (n: number) => showMonth(addMonths(pending.current?.month ?? activeMonth, n), +focus.slice(8));

  // Restore the scroll position whenever the day list (re)appears.
  useLayoutEffect(() => {
    if (mode === 'days' && scrollRef.current) scrollRef.current.scrollTop = top;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Wheel: one week per mouse-wheel notch (instead of the browser's ~3 rows); small trackpad deltas add up to a week per row height.
  // Needs a non-passive listener to cancel the native scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (mode !== 'days' || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      let steps: number;
      if (Math.abs(px) >= 50) {
        steps = Math.sign(px);
        wheelRest.current = 0;
      } else {
        wheelRest.current += px;
        steps = Math.trunc(wheelRest.current / ROW_PX);
        wheelRest.current -= steps * ROW_PX;
      }
      if (!steps) return;
      const base = pending.current?.top ?? Math.round(el.scrollTop / ROW_PX) * ROW_PX;
      animateTo(base + steps * ROW_PX);
    };
    const onEnd = () => (pending.current = null);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scrollend', onEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scrollend', onEnd);
    };
    // animateTo only uses refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode === 'days') gridRef.current?.focus({ preventScroll: true });
  }, [mode]);

  const markOf = useMemo(() => new Map((marks ?? []).map((m) => [m.date, m.kind])), [marks]);
  const disabled = (d: ISODate) => (min !== undefined && d < min) || (max !== undefined && d > max);
  const select = (d: ISODate) => !disabled(d) && onSelect(d);

  const firstRow = Math.max(0, Math.floor(top / ROW_PX) - OVERSCAN);
  const lastRow = Math.min(2 * SPAN_WEEKS, Math.floor(top / ROW_PX) + VISIBLE_WEEKS + OVERSCAN);
  const rows = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const monday = addDays(origin, r * 7);
    rows.push({ r, monday, days: Array.from({ length: 7 }, (_, c) => addDays(monday, c)) });
  }
  const selectedWeek = weeks && selected ? startOfWeek(selected) : null;

  const onGridKey = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) setFocus(addDays(focus, step[e.key]));
    else if (e.key === 'PageUp') showMonth(addMonths(focus, e.shiftKey ? -12 : -1), +focus.slice(8));
    else if (e.key === 'PageDown') showMonth(addMonths(focus, e.shiftKey ? 12 : 1), +focus.slice(8));
    else if (e.key === 'Home') setFocus(startOfWeek(focus));
    else if (e.key === 'End') setFocus(addDays(startOfWeek(focus), 6));
    else if (e.key === 'Enter') select(focus);
    else if (e.key !== ' ') return;
    e.preventDefault();
  };

  const month = activeMonth;
  const year = pickerYear;
  const monthOpen = (y: number, m: number) => {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = `${y}-${String(m).padStart(2, '0')}-${daysInMonth(y, m)}`;
    return !(min !== undefined && last < min) && !(max !== undefined && first > max);
  };

  return (
    <div
      className="date-panel"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        if (mode === 'months') setMode('days');
        else onClose();
      }}
    >
      {mode === 'days' ? (
        <>
          <div className="dp-head">
            <button
              type="button"
              className="dp-title"
              onClick={() => {
                setPickerYear(+month.slice(0, 4));
                setMode('months');
              }}
              title="Choose month and year"
            >
              {formatMonth(month)} <ChevronDown size={14} />
            </button>
            <span className="spacer" />
            <button type="button" className="icon-btn small" onClick={() => stepMonth(-1)} title="Previous month (Page Up)">
              <ChevronUp size={16} />
            </button>
            <button type="button" className="icon-btn small" onClick={() => stepMonth(1)} title="Next month (Page Down)">
              <ChevronDown size={16} />
            </button>
          </div>
          <div
            ref={gridRef}
            className={`dp-grid ${weeks ? 'weeks' : ''}`}
            role="grid"
            tabIndex={0}
            aria-label={formatMonth(month)}
            onKeyDown={onGridKey}
            // Space selects on key-up: selecting moves focus back to the field, whose own key-up would reopen it.
            onKeyUp={(e) => e.key === ' ' && select(focus)}
          >
            <div className="dp-row dp-weekdays" role="row">
              {WEEKDAY_MIN.map((w, i) => (
                <span key={w} role="columnheader" className={i >= 5 ? 'weekend' : ''}>
                  {w}
                </span>
              ))}
            </div>
            <div
              ref={scrollRef}
              className="dp-scroll"
              style={{ height: VISIBLE_WEEKS * ROW_PX }}
              onScroll={(e) => {
                const st = e.currentTarget.scrollTop;
                setTop(st);
                if (pending.current && Math.abs(st - pending.current.top) < 1) pending.current = null;
              }}
            >
              <div className="dp-track" style={{ height: (2 * SPAN_WEEKS + 1) * ROW_PX }}>
                {rows.map(({ r, monday, days }) => (
                  <div
                    key={monday}
                    className={`dp-row dp-week ${monday === selectedWeek ? 'selected' : ''}`}
                    role="row"
                    style={{ top: r * ROW_PX, height: ROW_PX - 2 }}
                  >
                    {days.map((d) => {
                      const mark = markOf.get(d);
                      const cls = [
                        'dp-day',
                        d.slice(0, 7) !== month.slice(0, 7) && 'other',
                        weekday(d) >= 6 && 'weekend',
                        d === today && 'today',
                        !weeks && d === selected && 'selected',
                        d === focus && 'focused',
                        range && d >= range.start && d <= range.end && 'in-range',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <button
                          key={d}
                          type="button"
                          tabIndex={-1}
                          role="gridcell"
                          aria-selected={weeks ? monday === selectedWeek : d === selected}
                          className={cls}
                          disabled={disabled(d)}
                          title={[formatDate(d, { weekday: true, year: true }), mark && MARK_LABEL[mark]].filter(Boolean).join(' · ')}
                          onClick={() => select(d)}
                          onMouseEnter={() => setFocusOnly(d)}
                        >
                          {/* The 1st of each month carries the month's name, so month changes stand out while scrolling. */}
                          {d.endsWith('-01') && <span className="dp-mon">{MONTH_SHORT[+d.slice(5, 7) - 1]}</span>}
                          {+d.slice(8)}
                          {mark && <span className={`dp-mark ${mark}`} />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="dp-foot">
            {marks && marks.length > 0 && (
              <span className="dp-legend">
                {[...new Set(marks.map((m) => m.kind))].map((k) => (
                  <span key={k}>
                    <span className={`dp-mark ${k}`} /> {MARK_LABEL[k]}
                  </span>
                ))}
              </span>
            )}
            <span className="spacer" />
            {/* Only scrolls there (and highlights today); picking is still a click or Enter. */}
            <button
              type="button"
              className="btn btn-ghost small"
              title={weeks ? 'Scroll to the current week' : 'Scroll to today'}
              onClick={() => {
                showMonth(today, +today.slice(8));
                gridRef.current?.focus({ preventScroll: true });
              }}
            >
              {weeks ? 'This week' : 'Today'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="dp-head">
            <button type="button" className="icon-btn small" onClick={() => setPickerYear(year - 1)} title="Previous year">
              <ChevronLeft size={16} />
            </button>
            <span className="dp-year">{year}</span>
            <button type="button" className="icon-btn small" onClick={() => setPickerYear(year + 1)} title="Next year">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="dp-months">
            {MONTH_SHORT.map((name, i) => {
              const m = i + 1;
              const first = `${year}-${String(m).padStart(2, '0')}-01`;
              const isActive = first === month;
              return (
                <button
                  key={name}
                  type="button"
                  className={`dp-month ${isActive ? 'selected' : ''} ${first === startOfMonth(today) ? 'today' : ''}`}
                  disabled={!monthOpen(year, m) || first < startOfMonth(origin) || first > lastDay}
                  autoFocus={isActive}
                  onClick={() => {
                    showMonth(first, +focus.slice(8), false);
                    setMode('days');
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Calendar popup anchored below (or above, when there's no room) `anchor`. Rendered into <body> so modal scroll areas don't clip it.
 * `onClose(refocus)`: refocus = return focus to the anchor (after keyboard use).
 */
export function DatePopover({
  anchor,
  onSelect,
  onClose,
  ...options
}: CalendarOptions & { anchor: HTMLElement; onSelect: (d: ISODate) => void; onClose: (refocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let top = a.bottom + 6;
      if (top + h > window.innerHeight - 8 && a.top - 6 - h >= 8) top = a.top - 6 - h;
      setPos({
        left: Math.max(8, Math.min(a.left, window.innerWidth - w - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - h - 8)),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    return () => window.removeEventListener('scroll', place, true);
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose(false);
    };
    const close = () => onClose(false);
    window.addEventListener('mousedown', down);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="date-popover"
      role="dialog"
      aria-label="Choose a date"
      // Until measured: invisible but still focusable (the calendar grabs focus on mount).
      style={pos ?? { left: 0, top: 0, opacity: 0 }}
      // Keys used here must not reach window-level shortcuts (timetable ← →, Esc closing the dialog).
      onKeyDown={(e) => e.stopPropagation()}
      onBlur={(e) => e.relatedTarget && !ref.current?.contains(e.relatedTarget as Node) && onClose(false)}
    >
      <CalendarPanel
        {...options}
        onSelect={(d) => {
          onSelect(d);
          onClose(true);
        }}
        onClose={() => onClose(true)}
      />
    </div>,
    document.body,
  );
}

/** Replacement for <input type="date">: shows the date as text and opens the calendar popup. */
export function DateField({
  value,
  onChange,
  placeholder = 'Choose a date',
  ...options
}: Omit<CalendarOptions, 'weeks'> & { onChange: (d: ISODate) => void; placeholder?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);
  const valid = isValidISODate(value);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`input date-field ${open ? 'open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={valid ? '' : 'placeholder'}>{valid ? formatDate(value, { weekday: true, year: true }) : placeholder}</span>
        <Calendar size={15} />
      </button>
      {open && btn.current && <DatePopover anchor={btn.current} value={value} onSelect={onChange} onClose={close} {...options} />}
    </>
  );
}
