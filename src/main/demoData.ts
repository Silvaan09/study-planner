// Demo semester for manual testing and the README screenshots (`npm run seed-demo -- <empty folder>`).
// Never used by the app itself. Completion states are derived from `today`, so the data looks like a
// semester in progress: past lectures and exercises are mostly done, a few are left open on purpose.
import { dateInWeek, weeksBetween, type ISODate } from '../shared/dates';
import type { ExamKind, Exercise, Id } from '../shared/types';
import type { StudyService } from './service';

const SEMESTER = { name: 'Autumn Semester 2026', startDate: '2026-09-14', endDate: '2026-12-18' };

const SUBJECTS = {
  chemistry: { name: 'Chemistry', color: '#ec4899' },
  cs: { name: 'Computer Science', color: '#14b8a6' },
  math: { name: 'Mathematics', color: '#4f6bed' },
  physics: { name: 'Physics', color: '#f97316' },
} as const;
type SubjectKey = keyof typeof SUBJECTS;

// [subject, title, weekday (1 = Mon), start, end]
const LECTURES: [SubjectKey, string, number, string, string][] = [
  ['math', 'Linear Algebra', 1, '10:15', '12:00'],
  ['chemistry', 'General Chemistry', 1, '14:15', '16:00'],
  ['physics', 'Mechanics', 2, '10:15', '12:00'],
  ['cs', 'Algorithms & Data Structures', 2, '14:15', '16:00'],
  ['math', 'Analysis I', 3, '08:15', '10:00'],
  ['chemistry', 'Organic Chemistry', 3, '10:15', '12:00'],
  ['cs', 'Discrete Structures', 3, '13:15', '15:00'],
  ['physics', 'Electromagnetism', 4, '08:15', '10:00'],
  ['math', 'Analysis Exercise Class', 4, '13:15', '15:00'],
  ['cs', 'Programming Tutorial', 4, '13:15', '14:45'],
  ['chemistry', 'Chemistry Exercise Class', 5, '10:15', '12:00'],
  ['physics', 'Physics Lab', 5, '13:15', '17:00'],
];

interface DemoExercise {
  subject: SubjectKey;
  title: string;
  plannedDates: ISODate[];
  deadlineDate: ISODate;
  /** Recurring: repeats every `interval` weeks, `count` times. */
  every?: { interval: number; count: number };
  /** Checklist steps (copied to every occurrence of a series). */
  steps?: string[];
}

const EXERCISES: DemoExercise[] = [
  { subject: 'math', title: 'Problem Set', plannedDates: ['2026-09-15'], deadlineDate: '2026-09-18', every: { interval: 1, count: 14 } },
  { subject: 'math', title: 'Linear Algebra Sheet', plannedDates: ['2026-09-17', '2026-09-20'], deadlineDate: '2026-09-21', every: { interval: 1, count: 13 } },
  { subject: 'cs', title: 'Coding Assignment', plannedDates: ['2026-09-16'], deadlineDate: '2026-09-18', every: { interval: 1, count: 14 } },
  {
    subject: 'physics',
    title: 'Lab Report',
    plannedDates: ['2026-09-19', '2026-09-24'],
    deadlineDate: '2026-09-28',
    every: { interval: 2, count: 7 },
    steps: ['Collect measurements', 'Analyse the data', 'Plot the results', 'Write the discussion', 'Proofread'],
  },
  { subject: 'physics', title: 'Mechanics Problems', plannedDates: ['2026-09-22'], deadlineDate: '2026-09-23', every: { interval: 1, count: 13 } },
  { subject: 'chemistry', title: 'Worksheet', plannedDates: ['2026-09-16'], deadlineDate: '2026-09-21', every: { interval: 2, count: 7 } },
  {
    subject: 'chemistry',
    title: 'Essay: Chemical Bonding',
    plannedDates: ['2026-09-26', '2026-09-27'],
    deadlineDate: '2026-09-29',
    steps: ['Read the sources', 'Outline', 'Write the draft', 'Edit and cite'],
  },
  { subject: 'cs', title: 'Git Basics Quiz', plannedDates: ['2026-09-24'], deadlineDate: '2026-09-25' },
  {
    subject: 'cs',
    title: 'Project Proposal',
    plannedDates: ['2026-10-03', '2026-10-04'],
    deadlineDate: '2026-10-06',
    steps: ['Pick a topic', 'Research related work', 'Write the proposal', 'Ask for feedback'],
  },
  { subject: 'math', title: 'Midterm Preparation', plannedDates: ['2026-10-26', '2026-10-28', '2026-10-31', '2026-11-01'], deadlineDate: '2026-11-02' },
  { subject: 'physics', title: 'Presentation: Pendulum Experiment', plannedDates: ['2026-11-12', '2026-11-15'], deadlineDate: '2026-11-17' },
];

// [subject, kind, title, date, start, end, room]
const EXAMS: [SubjectKey, ExamKind, string, ISODate, string | null, string | null, string][] = [
  ['math', 'midterm', '', '2026-11-04', '10:15', '12:00', 'HG F 1'],
  ['physics', 'midterm', 'Mechanics Midterm', '2026-11-11', '08:15', '10:00', 'HPH G 2'],
  ['cs', 'endterm', '', '2026-12-16', '14:15', '16:00', 'CAB G 61'],
  ['chemistry', 'final', '', '2027-01-25', null, null, ''],
  ['math', 'final', 'Analysis & Linear Algebra', '2027-02-01', '09:00', '12:00', 'HG E 7'],
];


/** Past lecture occurrences left uncompleted ("title|date"), so the Outstanding view has something to show. */
const MISSED_LECTURES = new Set(['Analysis I|2026-09-16', 'Programming Tutorial|2026-09-24', 'Electromagnetism|2026-10-01']);
/** Exercises left "not started" although their deadline passed (overdue). */
const OVERDUE_EXERCISES = new Set(['Git Basics Quiz', 'Mechanics Problems 01']);
/** Exercises worked through (all planned days past) but not handed in yet, while their deadline is still ahead. */
const DONE_NOT_HANDED_IN = new Set(['Essay: Chemical Bonding']);

export interface DemoSummary {
  semesterId: Id;
  subjects: number;
  lectures: number;
  exercises: number;
  exams: number;
}

/** Fills an empty database with the demo semester. Runs in one transaction. */
export function seedDemo(svc: StudyService, today: ISODate): DemoSummary {
  return svc.tx(() => {
    const sem = svc.createSemester(SEMESTER);
    const subjectIds = {} as Record<SubjectKey, Id>;
    for (const [key, s] of Object.entries(SUBJECTS) as [SubjectKey, (typeof SUBJECTS)[SubjectKey]][]) {
      subjectIds[key] = svc.createSubject({ semesterId: sem.id, ...s }).id;
    }

    for (const [subject, title, weekday, startTime, endTime] of LECTURES) {
      const lecture = svc.createLecture({ subjectId: subjectIds[subject], title, weekday, startTime, endTime });
      for (const week of weeksBetween(sem.startDate, sem.endDate)) {
        const date = dateInWeek(week, weekday);
        if (date >= sem.startDate && date < today && !MISSED_LECTURES.has(`${title}|${date}`)) {
          svc.setLectureCompleted(lecture.id, week, true);
        }
      }
    }

    const exercises: Exercise[] = [];
    for (const e of EXERCISES) {
      exercises.push(
        ...svc.createExercise({
          subjectId: subjectIds[e.subject],
          title: e.title,
          description: '',
          plannedDates: e.plannedDates,
          deadlineDate: e.deadlineDate,
          checklist: (e.steps ?? []).map((text) => ({ text, done: false })),
          recurrence: e.every && { intervalWeeks: e.every.interval, count: e.every.count, firstNumber: 1 },
        }),
      );
    }
    for (const e of exercises) {
      if (OVERDUE_EXERCISES.has(e.title)) continue;
      // Handed in (due before today) or done: every step ticked; in progress: the first half.
      const handedIn = e.deadlineDate < today;
      const worked = !handedIn && DONE_NOT_HANDED_IN.has(e.title) && e.plannedDates[e.plannedDates.length - 1] < today;
      const done = handedIn || worked ? e.checklist : e.plannedDate < today ? e.checklist.slice(0, Math.ceil(e.checklist.length / 2)) : [];
      for (const step of done) svc.setChecklistItemDone(step.id, true);
      if (handedIn) svc.setExerciseHandedIn(e.id, true);
      else if (worked) svc.setExerciseStatus(e.id, 'completed');
      else if (e.plannedDate < today) svc.setExerciseStatus(e.id, 'in_progress');
    }

    for (const [subject, kind, title, date, startTime, endTime, location] of EXAMS) {
      svc.createExam({ subjectId: subjectIds[subject], kind, title, date, startTime, endTime, location, notes: '' });
    }

    return {
      semesterId: sem.id,
      subjects: Object.keys(SUBJECTS).length,
      lectures: LECTURES.length,
      exercises: exercises.length,
      exams: EXAMS.length,
    };
  });
}
