// Calendar-date helpers. All dates are ISO strings "YYYY-MM-DD" representing a
// local calendar day (no time zone). Arithmetic is done in UTC so daylight-saving
// transitions can never shift a day.

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function toUTC(date: ISODate): Date {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function fromUTC(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(new Date(toUTC(date).getTime() + days * MS_PER_DAY));
}

/** Whole days from `a` to `b` (positive if b is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / MS_PER_DAY);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function weekday(date: ISODate): number {
  const d = toUTC(date).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, 1 - weekday(date));
}

/** The date of `weekdayNum` (1..7) in the week starting at Monday `weekStart`. */
export function dateInWeek(weekStart: ISODate, weekdayNum: number): ISODate {
  return addDays(weekStart, weekdayNum - 1);
}

export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** Mondays of every week that overlaps [start, end]. */
export function weeksBetween(start: ISODate, end: ISODate): ISODate[] {
  const weeks: ISODate[] = [];
  for (let w = startOfWeek(start); w <= end; w = addDays(w, 7)) weeks.push(w);
  return weeks;
}

// ---- Time of day ("HH:MM", 24-hour) ----

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function timeToMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return +m[1] * 60 + +m[2];
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---- Display formatting (English, Monday-first, 24h) ----

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(date: ISODate, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = toUTC(date);
  let s = `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
  if (opts.year) s += ` ${d.getUTCFullYear()}`;
  if (opts.weekday) s = `${WEEKDAY_SHORT[weekday(date) - 1]} ${s}`;
  return s;
}

export function formatWeekRange(weekStart: ISODate): string {
  const end = addDays(weekStart, 6);
  const a = toUTC(weekStart);
  const b = toUTC(end);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) {
    return `${formatDate(weekStart, { year: true })} – ${formatDate(end, { year: true })}`;
  }
  if (a.getUTCMonth() === b.getUTCMonth()) {
    return `${a.getUTCDate()} – ${b.getUTCDate()} ${MONTH_SHORT[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  return `${formatDate(weekStart)} – ${formatDate(end)} ${b.getUTCFullYear()}`;
}

/** ISO-8601 calendar week number. */
export function isoWeekNumber(date: ISODate): number {
  const thursday = addDays(date, 4 - weekday(date));
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(jan1, thursday) / 7) + 1;
}
