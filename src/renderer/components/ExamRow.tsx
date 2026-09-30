import { diffDays, formatCountdown, formatDate, type ISODate } from '../../shared/dates';
import { EXAM_KIND_LABEL, examTitle, type Exam } from '../../shared/types';
import { GraduationCap } from './Icons';

/** "10:15–12:00", "from 10:15", or '' when the time isn't known. */
export function examTime(e: Exam): string {
  if (!e.startTime) return '';
  return e.endTime ? `${e.startTime}–${e.endTime}` : `from ${e.startTime}`;
}

/** Whether to add the kind after the title: only when there is a title and it doesn't already say it ("Mechanics Midterm"). */
export function showsKind(e: Exam): boolean {
  return e.title !== '' && !e.title.toLowerCase().includes(EXAM_KIND_LABEL[e.kind].toLowerCase());
}

/** Countdown badge: accent today, amber within a week, muted once it's over. */
export function ExamCountdown({ exam, today }: { exam: Exam; today: ISODate }) {
  const n = diffDays(today, exam.date);
  const cls = n < 0 ? 'past' : n === 0 ? 'today' : n <= 7 ? 'soon' : '';
  return <span className={`exam-countdown ${cls}`}>{formatCountdown(today, exam.date)}</span>;
}

/** One exam on a subject card: title (and kind), date/time/room and the countdown. */
export function ExamRow({ exam, today, onClick }: { exam: Exam; today: ISODate; onClick: () => void }) {
  const when = [formatDate(exam.date, { weekday: true, year: exam.date.slice(0, 4) !== today.slice(0, 4) }), examTime(exam), exam.location]
    .filter(Boolean)
    .join(' · ');
  return (
    <button className={`row-item row-exam ${exam.date < today ? 'past' : ''}`} title="Edit exam"
      onClick={onClick}
    >
      <GraduationCap size={14} />
      <span className="row-title">
        {examTitle(exam)}
        {showsKind(exam) && <span className="muted"> · {EXAM_KIND_LABEL[exam.kind]}</span>}
        <span className="row-sub">{when}</span>
      </span>
      <ExamCountdown exam={exam} today={today} />
    </button>
  );
}
