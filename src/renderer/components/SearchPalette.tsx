import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../ui';
import { diffDays, formatDate, formatDateRange, startOfWeek, todayISO, WEEKDAY_SHORT, type ISODate } from '../../shared/dates';
import {
  breakTitle,
  EXAM_KIND_LABEL,
  examTitle,
  exerciseDueBy,
  exerciseSettled,
  exerciseStage,
  type Exam,
  type Exercise,
  type Lecture,
  type Semester,
  type SemesterBreak,
  type Subject,
} from '../../shared/types';
import { groupResults, search, type SearchEntry, type SearchKind } from '../search';
import { Book, GraduationCap, Palm, Search, StatusIcon } from './Icons';

/** What a search result points at. */
export type SearchTarget =
  | { kind: 'view'; id: string }
  | { kind: 'subject'; subject: Subject }
  | { kind: 'lecture'; lecture: Lecture }
  | { kind: 'exercise'; exercise: Exercise }
  | { kind: 'exam'; exam: Exam }
  | { kind: 'break'; brk: SemesterBreak };

/** `alt` = Shift+Enter / Shift+click: show it in the timetable instead of opening it. */
export interface SearchPick {
  target: SearchTarget;
  alt: boolean;
}

export interface SearchView {
  id: string;
  label: string;
  icon: ReactNode;
  /** Other words it is found by. */
  keywords?: string[];
}

const GROUP_LABEL: Record<SearchKind, string> = {
  view: 'Go to',
  subject: 'Subjects',
  exercise: 'Exercises & tasks',
  lecture: 'Lectures',
  exam: 'Exams',
  break: 'Breaks & holidays',
};

/** The week to show for Shift+Enter: the item's next date from today on, else its last one. */
export function targetWeek(t: SearchTarget, semester: Semester, today: ISODate): ISODate | null {
  const next = (dates: ISODate[]) => {
    const sorted = [...dates].sort();
    return startOfWeek(sorted.find((d) => d >= today) ?? sorted[sorted.length - 1]);
  };
  switch (t.kind) {
    case 'exercise':
      return next([...t.exercise.plannedDates, ...(t.exercise.deadlineDate ? [t.exercise.deadlineDate] : [])]);
    case 'exam':
      return startOfWeek(t.exam.date);
    case 'break':
      return startOfWeek(t.brk.startDate);
    case 'lecture': {
      const from = t.lecture.startDate ?? semester.startDate;
      const to = t.lecture.endDate ?? semester.endDate;
      return startOfWeek(today < from ? from : today > to ? to : today);
    }
    default:
      return null;
  }
}

function buildEntries(
  views: SearchView[],
  subjects: Subject[],
  overview: Awaited<ReturnType<typeof api.subjectOverview>>,
  breaks: SemesterBreak[],
  today: ISODate,
): SearchEntry<SearchTarget>[] {
  const away = (d: ISODate) => Math.abs(diffDays(today, d));
  const name = (id: number) => {
    const s = subjects.find((x) => x.id === id);
    return s ? s.name : '';
  };
  const entries: SearchEntry<SearchTarget>[] = views.map((v) => ({
    kind: 'view',
    key: `view:${v.id}`,
    title: v.label,
    extra: v.keywords ?? [],
    item: { kind: 'view', id: v.id },
  }));
  for (const s of subjects) {
    entries.push({ kind: 'subject', key: `subject:${s.id}`, title: name(s.id), extra: ['subject'], item: { kind: 'subject', subject: s } });
  }
  for (const o of overview) {
    for (const l of o.lectures) {
      entries.push({
        kind: 'lecture',
        key: `lecture:${l.id}`,
        title: l.title,
        extra: [name(l.subjectId), WEEKDAY_SHORT[l.weekday - 1], l.startTime, 'lecture'],
        item: { kind: 'lecture', lecture: l },
      });
    }
    for (const e of o.exercises) {
      entries.push({
        kind: 'exercise',
        key: `exercise:${e.id}`,
        title: e.title,
        extra: [
          name(e.subjectId),
          e.description,
          ...e.checklist.map((c) => c.text),
          ...e.plannedDates.map((d) => formatDate(d, { weekday: true })),
          e.deadlineDate ? `due ${formatDate(e.deadlineDate, { weekday: true })}` : '',
          o.subject.personal ? 'task' : 'exercise',
        ],
        // Open ones nearest to today first, finished ones after them.
        order: away(exerciseDueBy(e)) + (exerciseSettled(e) ? 10_000 : 0),
        item: { kind: 'exercise', exercise: e },
      });
    }
    for (const x of o.exams) {
      entries.push({
        kind: 'exam',
        key: `exam:${x.id}`,
        title: `${examTitle(x)} · ${name(x.subjectId)}`,
        extra: [EXAM_KIND_LABEL[x.kind], x.location, x.notes, formatDate(x.date, { weekday: true }), 'exam'],
        order: away(x.date) + (x.date < today ? 10_000 : 0),
        item: { kind: 'exam', exam: x },
      });
    }
  }
  for (const b of breaks) {
    entries.push({
      kind: 'break',
      key: `break:${b.id}`,
      title: breakTitle(b),
      extra: [formatDateRange(b.startDate, b.endDate), 'break', 'holiday'],
      order: away(b.startDate),
      item: { kind: 'break', brk: b },
    });
  }
  return entries;
}

/** Ctrl+K: finds views, subjects, exercises and tasks, lectures, exams and breaks of the semester. */
export function SearchPalette({
  semester,
  views,
  close,
}: {
  semester: Semester;
  views: SearchView[];
  close: (pick?: SearchPick) => void;
}) {
  const today = todayISO();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { data } = useLoad(
    () => Promise.all([api.listSubjects(semester.id), api.subjectOverview(semester.id), api.listBreaks(semester.id)]),
    [semester.id],
  );
  const entries = useMemo(() => (data ? buildEntries(views, data[0], data[1], data[2], today) : buildEntries(views, [], [], [], today)), [data, views, today]);
  const groups = useMemo(() => groupResults(search(entries, query)), [entries, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const subjectById = useMemo(() => new Map((data?.[0] ?? []).map((s) => [s.id, s])), [data]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [active, flat]);

  const pick = (e: SearchEntry<SearchTarget> | undefined, alt: boolean) => e && close({ target: e.item, alt });

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (flat.length) setActive((a) => (a + (ev.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      pick(flat[active], ev.shiftKey);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };

  const color = (id: number) => subjectById.get(id)?.color ?? '#888';
  const subjectName = (id: number) => {
    const s = subjectById.get(id);
    return s ? s.name : '';
  };
  const icon = (t: SearchTarget): ReactNode => {
    switch (t.kind) {
      case 'view':
        return views.find((v) => v.id === t.id)?.icon;
      case 'subject':
        return <span className="dot" style={{ background: t.subject.color }} />;
      case 'lecture':
        return <Book size={15} />;
      case 'exercise':
        return <StatusIcon status={exerciseStage(t.exercise)} size={15} />;
      case 'exam':
        return <GraduationCap size={15} />;
      case 'break':
        return <Palm size={15} />;
    }
  };
  const meta = (t: SearchTarget): ReactNode => {
    switch (t.kind) {
      case 'lecture': {
        const l = t.lecture;
        const dates = l.startDate || l.endDate ? ` · ${formatDateRange(l.startDate ?? semester.startDate, l.endDate ?? semester.endDate)}` : '';
        return `${subjectName(l.subjectId)} · ${WEEKDAY_SHORT[l.weekday - 1]} ${l.startTime}–${l.endTime}${dates}`;
      }
      case 'exercise': {
        const e = t.exercise;
        const when = e.deadlineDate ? `due ${formatDate(e.deadlineDate, { weekday: true })}` : `planned ${formatDate(e.plannedDates[e.plannedDates.length - 1], { weekday: true })}`;
        return `${subjectName(e.subjectId)} · ${when}`;
      }
      case 'exam':
        return `${formatDate(t.exam.date, { weekday: true, year: true })}${t.exam.startTime ? ` · ${t.exam.startTime}` : ''}${t.exam.location ? ` · ${t.exam.location}` : ''}`;
      case 'break':
        return `${formatDateRange(t.brk.startDate, t.brk.endDate)} · no lectures`;
      default:
        return null;
    }
  };
  const subjectOf = (t: SearchTarget): number | null =>
    t.kind === 'lecture' ? t.lecture.subjectId : t.kind === 'exercise' ? t.exercise.subjectId : t.kind === 'exam' ? t.exam.subjectId : null;

  let index = -1;
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-input">
          <Search size={17} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search exercises, tasks, lectures, exams, subjects…"
            aria-label="Search"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results" ref={listRef} role="listbox">
          {groups.map((g) => (
            <div key={g.kind} className="palette-group">
              <div className="palette-group-label">{GROUP_LABEL[g.kind]}</div>
              {g.entries.map((e) => {
                const i = ++index;
                const sid = subjectOf(e.item);
                return (
                  <div
                    key={e.key}
                    role="option"
                    aria-selected={i === active}
                    className={`palette-row ${i === active ? 'active' : ''} ${e.item.kind === 'exercise' && exerciseSettled(e.item.exercise) ? 'settled' : ''}`}
                    style={sid !== null ? ({ '--c': color(sid) } as CSSProperties) : undefined}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={(ev) => pick(e, ev.shiftKey)}
                  >
                    <span className="palette-icon">{icon(e.item)}</span>
                    <span className="palette-text">
                      <span className="palette-title">{e.title}</span>
                      {meta(e.item) && <span className="palette-meta">{meta(e.item)}</span>}
                    </span>
                    {sid !== null && <span className="palette-subject" aria-hidden />}
                  </div>
                );
              })}
            </div>
          ))}
          {query.trim() && flat.length === 0 && <p className="palette-empty">Nothing found for "{query.trim()}".</p>}
        </div>
        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> choose
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Shift</kbd>+<kbd>Enter</kbd> show in timetable
          </span>
        </footer>
      </div>
    </div>
  );
}
