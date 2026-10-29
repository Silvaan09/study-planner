import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/main/db/database';
import { StudyService } from '../src/main/service';
import { seedDemo } from '../src/main/demoData';

let dir: string;
let svc: StudyService;
let close: () => void;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-demo-'));
  const opened = openDatabase(dir);
  svc = new StudyService(opened.db);
  close = () => opened.db.close();
});

afterEach(() => {
  close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('demo data (npm run seed-demo)', () => {
  it('builds a semester in progress as of the given day', () => {
    const today = '2026-09-28';
    const { semesterId } = seedDemo(svc, today);
    const overview = svc.subjectOverview(semesterId);
    expect(overview.map((o) => o.subject.name)).toEqual(['Chemistry', 'Computer Science', 'Mathematics', 'Physics', 'Personal']);

    // Week 2 is a full week in the past: everything done except the one missed lecture.
    const week2 = svc.getWeek(semesterId, '2026-09-21');
    expect(week2.lectures).toHaveLength(12);
    expect(week2.lectures.filter((l) => !l.completed).map((l) => l.title)).toEqual(['Programming Tutorial']);

    // Nothing in the future is completed.
    expect(svc.getWeek(semesterId, '2026-10-05').lectures.some((l) => l.completed)).toBe(false);

    // The autumn break (week 7) has no lectures, but its exercises stay; Exam Revision only runs in the last five weeks.
    const breakWeek = svc.getWeek(semesterId, '2026-10-26');
    expect([breakWeek.lectures.length, breakWeek.breaks.map((b) => b.name)]).toEqual([0, ['Autumn break']]);
    expect(breakWeek.exercises.length).toBeGreaterThan(0);
    const revision = (w: string) => svc.getWeek(semesterId, w).lectures.filter((l) => l.title === 'Exam Revision').length;
    expect([revision('2026-11-09'), revision('2026-11-16'), revision('2026-12-14')]).toEqual([0, 1, 1]);

    const out = svc.getOutstanding(semesterId, today);
    const overdue = out.items.filter((i) => i.kind === 'exercise' && i.overdue).map((i) => (i.kind === 'exercise' ? i.exercise.title : ''));
    expect(overdue.sort()).toEqual(['Git Basics Quiz', 'Mechanics Problems 01', 'Reading: Periodic Table']);
    // The two missed lectures, plus today's (Monday's) two, which are still open.
    expect(out.items.filter((i) => i.kind === 'lecture').map((i) => i.date)).toEqual(['2026-09-16', '2026-09-24', '2026-09-28', '2026-09-28']);

    // Exams: every subject has at least one, listed by date.
    expect(overview.map((o) => o.exams.length)).toEqual([1, 1, 2, 1, 0]);
    const todayData = svc.getToday(semesterId, today);
    expect(todayData.exams.map((e) => e.date)).toEqual(['2026-11-04', '2026-11-11', '2026-12-16', '2027-01-25', '2027-02-01']);

    // Checklists follow the status: Lab Report 01 (due today, planned before) is half done.
    const lab = overview[3].exercises.find((e) => e.title === 'Lab Report 01')!;
    expect(lab.checklist.map((c) => c.done)).toEqual([true, true, true, false, false]);
    expect(lab.status).toBe('in_progress');
    // Its sessions: the first one done, the last (both past) still in progress.
    expect(lab.sessions.map((x) => x.status)).toEqual(['completed', 'in_progress']);
    // The essay (due tomorrow, planned days past) is done but not handed in, so it is still outstanding.
    const essay = overview[0].exercises.find((e) => e.title === 'Essay: Chemical Bonding')!;
    expect([essay.status, essay.handedIn, essay.checklist.every((c) => c.done)]).toEqual(['completed', false, true]);
    expect(out.items.some((i) => i.kind === 'exercise' && i.exercise.id === essay.id)).toBe(true);
    // Exercises due before today are handed in.
    const set1 = overview[2].exercises.find((e) => e.title === 'Problem Set 01')!;
    expect([set1.status, set1.handedIn]).toEqual(['completed', true]);
    const lab2 = overview[3].exercises.find((e) => e.title === 'Lab Report 02')!;
    expect(lab2.checklist.every((c) => !c.done)).toBe(true);
    // Without a deadline: done once the planned day is past, so it isn't outstanding; the future one is.
    const reading = overview[0].exercises.find((e) => e.title === 'Reading: Atomic Structure')!;
    expect([reading.deadlineDate, reading.status, reading.handedIn]).toEqual([null, 'completed', false]);
    expect(out.items.some((i) => i.kind === 'exercise' && i.exercise.id === reading.id)).toBe(false);
    expect(out.items.some((i) => i.kind === 'exercise' && i.exercise.title === 'Reading: Reaction Kinetics' && !i.overdue)).toBe(true);

    // Personal tasks: the past ones are finished, the upcoming one is open.
    const tasks = overview[4].exercises;
    expect(tasks.map((e) => [e.title, e.status, e.handedIn])).toEqual([
      ['Call the landlord about the heating', 'completed', false],
      ['Renew bike insurance', 'completed', true],
      ['Apply for student job', 'not_started', false],
    ]);
  });

  it('can be seeded late in the semester, across the break', () => {
    const { semesterId } = seedDemo(svc, '2026-12-01');
    expect(svc.getWeek(semesterId, '2026-11-23').lectures.every((l) => l.completed)).toBe(true);
    expect(svc.getToday(semesterId, '2026-12-01').missedLectures.map((o) => o.title)).toEqual(['Analysis I', 'Programming Tutorial', 'Electromagnetism']);
  });

  it('leaves the sessions of a partly past exercise half done', () => {
    // On 30 Sep, "Apply for student job" (planned 29 Sep and 1 Oct) has one session behind it and one ahead.
    const { semesterId } = seedDemo(svc, '2026-09-30');
    const job = svc.subjectOverview(semesterId)[4].exercises.find((e) => e.title === 'Apply for student job')!;
    expect(job.sessions).toEqual([
      { date: '2026-09-29', status: 'completed' },
      { date: '2026-10-01', status: 'not_started' },
    ]);
    expect(job.status).toBe('in_progress');
  });
});
