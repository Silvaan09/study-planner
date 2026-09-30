import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/main/db/database';
import { StudyService, UserError } from '../src/main/service';
import type { Semester, Subject } from '../src/shared/types';
import { biggerCelebration, celebrationFor, computeStreak, exerciseWeeks, weekProgress, weekStatus } from '../src/shared/progress';

let dir: string;
let svc: StudyService;
let close: () => void;
let sem: Semester;
let math: Subject;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-'));
  const opened = openDatabase(dir);
  svc = new StudyService(opened.db);
  close = () => opened.db.close();
  // Monday 14 Sep 2026 .. Friday 18 Dec 2026
  sem = svc.createSemester({ name: 'Autumn 2026', startDate: '2026-09-14', endDate: '2026-12-18' });
  math = svc.createSubject({ semesterId: sem.id, name: 'Mathematics', color: '#3366ff' });
});

afterEach(() => {
  close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('semesters and subjects', () => {
  it('keeps same-named subjects in different semesters independent', () => {
    const spring = svc.createSemester({ name: 'Spring 2027', startDate: '2027-02-15', endDate: '2027-05-28' });
    const math2 = svc.createSubject({ semesterId: spring.id, name: 'Mathematics', color: '#3366ff' });
    svc.updateSubject(math2.id, { semesterId: spring.id, name: 'Mathematics II', color: '#ff0000' });
    expect(svc.listSubjects(sem.id)[0]).toMatchObject({ name: 'Mathematics', color: '#3366ff' });
    expect(svc.listSubjects(spring.id)[0]).toMatchObject({ name: 'Mathematics II', color: '#ff0000' });
  });

  it('rejects a semester that ends before it starts', () => {
    expect(() => svc.createSemester({ name: 'x', startDate: '2026-10-01', endDate: '2026-09-01' })).toThrow(UserError);
  });
});

describe('lectures', () => {
  it('recurs weekly inside the semester and tracks completion per occurrence', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'Linear Algebra', weekday: 1, startTime: '10:00', endTime: '12:00' });
    svc.setLectureCompleted(l.id, '2026-09-28', true);
    expect(svc.getWeek(sem.id, '2026-09-21').lectures[0]).toMatchObject({ date: '2026-09-21', completed: false });
    expect(svc.getWeek(sem.id, '2026-09-28').lectures[0]).toMatchObject({ date: '2026-09-28', completed: true });
    expect(svc.getWeek(sem.id, '2026-10-05').lectures[0].completed).toBe(false);
    // Outside the semester: no occurrence.
    expect(svc.getWeek(sem.id, '2026-09-07').lectures).toHaveLength(0);
    expect(svc.getWeek(sem.id, '2026-12-21').lectures).toHaveLength(0);
  });

  it('keeps completion when the lecture moves to another weekday', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 1, startTime: '10:00', endTime: '12:00' });
    svc.setLectureCompleted(l.id, '2026-09-14', true);
    svc.updateLecture(l.id, { subjectId: math.id, title: 'LA', weekday: 3, startTime: '10:00', endTime: '12:00' });
    expect(svc.getWeek(sem.id, '2026-09-14').lectures[0]).toMatchObject({ date: '2026-09-16', completed: true });
  });

  it('deletes a single week, restores it with its state, and can remove it permanently', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 1, startTime: '10:00', endTime: '12:00' });
    svc.setLectureCompleted(l.id, '2026-09-21', true);
    const del = svc.deleteLecture(l.id, 'this', '2026-09-21');
    expect(svc.getWeek(sem.id, '2026-09-21').lectures).toHaveLength(0);
    expect(svc.getWeek(sem.id, '2026-09-28').lectures).toHaveLength(1);
    svc.restoreTrash(del.trashId);
    expect(svc.getWeek(sem.id, '2026-09-21').lectures[0].completed).toBe(true);
    const del2 = svc.deleteLecture(l.id, 'this', '2026-09-21');
    svc.purgeTrash(del2.trashId);
    expect(svc.getWeek(sem.id, '2026-09-21').lectures).toHaveLength(0);
    expect(svc.getWeek(sem.id, '2026-09-28').lectures).toHaveLength(1);
    expect(svc.listTrash()).toHaveLength(0);
  });

  it('deletes this and following weeks only', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 1, startTime: '10:00', endTime: '12:00' });
    svc.deleteLecture(l.id, 'future', '2026-11-02');
    expect(svc.getWeek(sem.id, '2026-10-26').lectures).toHaveLength(1);
    expect(svc.getWeek(sem.id, '2026-11-02').lectures).toHaveLength(0);
    expect(svc.getWeek(sem.id, '2026-12-14').lectures).toHaveLength(0);
  });

  it('lists past uncompleted lectures as outstanding', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 1, startTime: '10:00', endTime: '12:00' });
    svc.setLectureCompleted(l.id, '2026-09-14', true);
    const out = svc.getOutstanding(sem.id, '2026-09-29');
    expect(out.items.map((i) => i.date)).toEqual(['2026-09-21', '2026-09-28']);
  });
});

describe('exercises', () => {
  it('rejects a planned date after the deadline', () => {
    expect(() =>
      svc.createExercise({ subjectId: math.id, title: 'PS', description: '', plannedDates: ['2026-09-20'], deadlineDate: '2026-09-18' }),
    ).toThrow(/after the deadline/);
    const [e] = svc.createExercise({ subjectId: math.id, title: 'PS', description: '', plannedDates: ['2026-09-15'], deadlineDate: '2026-09-18' });
    expect(() => svc.moveExercise(e.id, '2026-09-15', '2026-09-19')).toThrow(UserError);
    expect(svc.moveExercise(e.id, '2026-09-15', '2026-09-18').plannedDate).toBe('2026-09-18');
  });

  it('generates numbered recurring occurrences', () => {
    const list = svc.createExercise({
      subjectId: math.id,
      title: 'Problem Set',
      description: '',
      plannedDates: ['2026-09-15'],
      deadlineDate: '2026-09-18',
      recurrence: { intervalWeeks: 2, count: 4, firstNumber: 1 },
    });
    expect(list.map((e) => e.title)).toEqual(['Problem Set 01', 'Problem Set 02', 'Problem Set 03', 'Problem Set 04']);
    expect(list.map((e) => e.deadlineDate)).toEqual(['2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30']);
  });

  function series() {
    return svc.createExercise({
      subjectId: math.id,
      title: 'Problem Set',
      description: '',
      plannedDates: ['2026-09-15'],
      deadlineDate: '2026-09-18',
      recurrence: { intervalWeeks: 1, count: 4, firstNumber: 1 },
    });
  }

  it('edits one occurrence independently', () => {
    const list = series();
    svc.updateExercise({ id: list[2].id, scope: 'this', changes: { title: 'Problem Set 03 (bonus)', status: 'in_progress' } });
    const after = list.map((e) => svc.getExercise(e.id));
    expect(after.map((e) => e.title)).toEqual(['Problem Set 01', 'Problem Set 02', 'Problem Set 03 (bonus)', 'Problem Set 04']);
    expect(after.map((e) => e.status)).toEqual(['not_started', 'not_started', 'in_progress', 'not_started']);
    expect(after[2].overrides).toEqual(['title']);
  });

  it('asks before overwriting individual changes in a series edit', () => {
    const list = series();
    svc.updateExercise({ id: list[2].id, scope: 'this', changes: { deadlineDate: '2026-10-03' } });
    const res = svc.updateExercise({ id: list[0].id, scope: 'all', changes: { deadlineDate: '2026-09-17' } });
    expect(res).toEqual({ status: 'conflicts', conflicts: [{ id: list[2].id, title: 'Problem Set 03', fields: ['deadlineDate'] }] });
    // Nothing changed yet.
    expect(svc.getExercise(list[0].id).deadlineDate).toBe('2026-09-18');

    svc.updateExercise({ id: list[0].id, scope: 'all', changes: { deadlineDate: '2026-09-17' }, overridePolicy: 'keep' });
    expect(list.map((e) => svc.getExercise(e.id).deadlineDate)).toEqual(['2026-09-17', '2026-09-24', '2026-10-03', '2026-10-08']);
  });

  it('applies to this and future occurrences only', () => {
    const list = series();
    svc.updateExercise({ id: list[1].id, scope: 'future', changes: { title: 'Homework' } });
    expect(list.map((e) => svc.getExercise(e.id).title)).toEqual(['Problem Set 01', 'Homework 02', 'Homework 03', 'Homework 04']);
    const more = svc.extendSeries(list[0].seriesId!, 1);
    expect(more[0]).toMatchObject({ title: 'Homework 05', plannedDates: ['2026-10-13'], deadlineDate: '2026-10-16' });
  });

  it('rejects series edits that would break planned <= deadline, changing nothing', () => {
    const list = series();
    svc.updateExercise({ id: list[3].id, scope: 'this', changes: { plannedDates: ['2026-10-09'] } });
    expect(() =>
      svc.updateExercise({ id: list[0].id, scope: 'all', changes: { deadlineDate: '2026-09-15' }, overridePolicy: 'overwrite' }),
    ).toThrow(/Problem Set 04/);
    expect(svc.getExercise(list[0].id).deadlineDate).toBe('2026-09-18');
  });

  it('deletes and restores this-and-future occurrences', () => {
    const list = series();
    const del = svc.deleteExercise(list[2].id, 'future');
    expect(svc.getWeek(sem.id, '2026-09-28').exercises).toHaveLength(0);
    expect(svc.getWeek(sem.id, '2026-09-21').exercises).toHaveLength(1);
    svc.restoreTrash(del.trashId);
    expect(svc.getWeek(sem.id, '2026-09-28').exercises).toHaveLength(1);
  });

  it('deleting a series keeps occurrences trashed earlier as separate entries', () => {
    const list = series();
    const one = svc.deleteExercise(list[0].id, 'this');
    const all = svc.deleteExercise(list[1].id, 'all');
    expect(() => svc.restoreTrash(one.trashId)).toThrow(/Restore exercise series/);
    svc.restoreTrash(all.trashId);
    expect(svc.getWeek(sem.id, '2026-09-14').exercises).toHaveLength(0);
    svc.restoreTrash(one.trashId);
    expect(svc.getWeek(sem.id, '2026-09-14').exercises).toHaveLength(1);
  });

  it('subject overview lists the live exercises of each subject by deadline', () => {
    const list = series();
    const [solo] = svc.createExercise({ subjectId: math.id, title: 'Essay', description: '', plannedDates: ['2026-09-20'], deadlineDate: '2026-09-22' });
    svc.deleteExercise(list[3].id, 'this');
    const [o] = svc.subjectOverview(sem.id);
    expect(o.exercises.map((e) => e.id)).toEqual([list[0].id, solo.id, list[1].id, list[2].id]);
    expect(o.exerciseCount).toBe(3 + 1);
    expect(o.exercises[1]).toMatchObject({ seriesId: null, plannedDates: ['2026-09-20'] });
  });

  it('outstanding list excludes handed-in exercises and flags overdue ones', () => {
    const [a] = svc.createExercise({ subjectId: math.id, title: 'A', description: '', plannedDates: ['2026-09-15'], deadlineDate: '2026-09-18' });
    const [b] = svc.createExercise({ subjectId: math.id, title: 'B', description: '', plannedDates: ['2026-09-16'], deadlineDate: '2026-10-18' });
    const [c] = svc.createExercise({ subjectId: math.id, title: 'C', description: '', plannedDates: ['2026-09-17'], deadlineDate: '2026-10-18' });
    const [d] = svc.createExercise({ subjectId: math.id, title: 'D', description: '', plannedDates: ['2026-09-17'], deadlineDate: '2026-10-18' });
    svc.setExerciseStatus(b.id, 'in_progress');
    svc.setExerciseStatus(c.id, 'completed'); // done, but not handed in yet
    svc.setExerciseHandedIn(d.id, true);
    const out = svc.getOutstanding(sem.id, '2026-09-27');
    expect(out.items.map((i) => (i.kind === 'exercise' ? [i.exercise.id, i.overdue] : null))).toEqual([
      [a.id, true],
      [b.id, false],
      [c.id, false],
    ]);
  });
});

describe('handing in', () => {
  const create = (extra: object = {}) =>
    svc.createExercise({ subjectId: math.id, title: 'Sheet', description: '', plannedDates: ['2026-09-22'], deadlineDate: '2026-09-25', ...extra });

  it('keeps the work status and handing in apart', () => {
    const [e] = create();
    expect(e).toMatchObject({ status: 'not_started', handedIn: false });
    // Working through it on the planned day doesn't hand it in: still due, then overdue.
    svc.setExerciseStatus(e.id, 'completed');
    expect(svc.getExercise(e.id)).toMatchObject({ status: 'completed', handedIn: false });
    expect(svc.getToday(sem.id, '2026-09-23').dueSoon.map((x) => x.id)).toEqual([e.id]);
    expect(svc.getToday(sem.id, '2026-09-26').overdue.map((x) => x.id)).toEqual([e.id]);
    // ...but the planned day and its week count as done.
    expect(weekProgress(svc.getWeek(sem.id, '2026-09-21'))).toMatchObject({ exercises: 1, exercisesDone: 1 });

    svc.setExerciseHandedIn(e.id, true);
    expect(svc.getToday(sem.id, '2026-09-26').overdue).toEqual([]);
    // Taking it back keeps the work done; going back to a lower status clears the hand-in.
    svc.setExerciseHandedIn(e.id, false);
    expect(svc.getExercise(e.id)).toMatchObject({ status: 'completed', handedIn: false });
    svc.setExerciseHandedIn(e.id, true);
    svc.setExerciseStatus(e.id, 'completed');
    expect(svc.getExercise(e.id).handedIn).toBe(true);
    svc.setExerciseStatus(e.id, 'in_progress');
    expect(svc.getExercise(e.id)).toMatchObject({ status: 'in_progress', handedIn: false });
  });

  it('handing in marks the work done too', () => {
    const [e] = create();
    svc.setExerciseHandedIn(e.id, true);
    expect(svc.getExercise(e.id)).toMatchObject({ status: 'completed', handedIn: true });
    const [f] = create({ handedIn: true });
    expect(f).toMatchObject({ status: 'completed', handedIn: true });
  });

  it('edits hand-in and status of this occurrence only, keeping them consistent', () => {
    const list = create({ recurrence: { intervalWeeks: 1, count: 3, firstNumber: 1 }, handedIn: true });
    expect(list.map((x) => x.handedIn)).toEqual([true, false, false]);
    const [, second] = list;
    svc.updateExercise({ id: second.id, scope: 'all', changes: { handedIn: true, description: 'x' } });
    expect(svc.getExercise(second.id)).toMatchObject({ status: 'completed', handedIn: true });
    expect(svc.getExercise(list[2].id)).toMatchObject({ status: 'not_started', handedIn: false, description: 'x' });
    svc.updateExercise({ id: second.id, scope: 'this', changes: { status: 'in_progress' } });
    expect(svc.getExercise(second.id)).toMatchObject({ status: 'in_progress', handedIn: false });
    svc.updateExercise({ id: second.id, scope: 'this', changes: { status: 'completed', handedIn: false } });
    expect(svc.getExercise(second.id)).toMatchObject({ status: 'completed', handedIn: false });
    expect(svc.getExercise(second.id).overrides).toEqual([]);
    expect(() => svc.setExerciseHandedIn(second.id, 'yes' as never)).toThrow(UserError);
  });
});

describe('multiple planned dates', () => {
  it('shows an exercise on each planned day and validates all dates against the deadline', () => {
    expect(() =>
      svc.createExercise({ subjectId: math.id, title: 'X', description: '', plannedDates: ['2026-09-15', '2026-09-19'], deadlineDate: '2026-09-18' }),
    ).toThrow(/Sat 19 Sep/);
    const [e] = svc.createExercise({
      subjectId: math.id,
      title: 'Project',
      description: '',
      plannedDates: ['2026-09-24', '2026-09-17', '2026-09-17'],
      deadlineDate: '2026-09-25',
    });
    expect(e.plannedDates).toEqual(['2026-09-17', '2026-09-24']);
    expect(e.plannedDate).toBe('2026-09-17');
    expect(svc.getWeek(sem.id, '2026-09-14').exercises.map((x) => x.id)).toEqual([e.id]);
    expect(svc.getWeek(sem.id, '2026-09-21').exercises.map((x) => x.id)).toEqual([e.id]);
  });

  it('repeats the planned pattern in every occurrence: every Thursday, due every second Friday', () => {
    const list = svc.createExercise({
      subjectId: math.id,
      title: 'Sheet',
      description: '',
      plannedDates: ['2026-09-17', '2026-09-24'],
      deadlineDate: '2026-09-25',
      recurrence: { intervalWeeks: 2, count: 3, firstNumber: 1 },
    });
    expect(list.map((e) => e.plannedDates)).toEqual([
      ['2026-09-17', '2026-09-24'],
      ['2026-10-01', '2026-10-08'],
      ['2026-10-15', '2026-10-22'],
    ]);
    const more = svc.extendSeries(list[0].seriesId!, 1);
    expect(more[0].plannedDates).toEqual(['2026-10-29', '2026-11-05']);
  });

  it('moves a single planned date and merges duplicates', () => {
    const [e] = svc.createExercise({
      subjectId: math.id,
      title: 'P',
      description: '',
      plannedDates: ['2026-09-15', '2026-09-17'],
      deadlineDate: '2026-09-18',
    });
    expect(svc.moveExercise(e.id, '2026-09-17', '2026-09-16').plannedDates).toEqual(['2026-09-15', '2026-09-16']);
    expect(svc.moveExercise(e.id, '2026-09-16', '2026-09-15').plannedDates).toEqual(['2026-09-15']);
    expect(() => svc.moveExercise(e.id, '2026-09-17', '2026-09-16')).toThrow(/no longer exists/);
  });

  it('applies an edited planned pattern to the rest of the series', () => {
    const list = svc.createExercise({
      subjectId: math.id,
      title: 'PS',
      description: '',
      plannedDates: ['2026-09-15'],
      deadlineDate: '2026-09-18',
      recurrence: { intervalWeeks: 1, count: 3, firstNumber: 1 },
    });
    svc.updateExercise({ id: list[1].id, scope: 'future', changes: { plannedDates: ['2026-09-21', '2026-09-23'] } });
    expect(list.map((e) => svc.getExercise(e.id).plannedDates)).toEqual([
      ['2026-09-15'],
      ['2026-09-21', '2026-09-23'],
      ['2026-09-28', '2026-09-30'],
    ]);
  });

  it('migrating a v1 database keeps each exercise planned on its original date', async () => {
    close();
    const { migrations } = await import('../src/main/db/migrations');
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-v1-'));
    const v1 = openDatabase(dir1, { migrations: [migrations[0]] });
    const t = '2026-01-01T00:00:00.000Z';
    v1.db.exec(`INSERT INTO semesters (id, name, start_date, end_date, created_at, updated_at) VALUES (1, 'S', '2026-09-14', '2026-12-18', '${t}', '${t}');
      INSERT INTO subjects (id, semester_id, name, color, created_at, updated_at) VALUES (1, 1, 'M', '#3366ff', '${t}', '${t}');
      INSERT INTO exercises (id, subject_id, title, planned_date, deadline_date, created_at, updated_at) VALUES (7, 1, 'Old', '2026-09-16', '2026-09-18', '${t}', '${t}');`);
    v1.db.close();
    const v2 = openDatabase(dir1);
    close = () => {
      v2.db.close();
      fs.rmSync(dir1, { recursive: true, force: true });
    };
    expect(v2.backupsCreated).toHaveLength(1);
    expect(new StudyService(v2.db).getExercise(7)).toMatchObject({ plannedDate: '2026-09-16', plannedDates: ['2026-09-16'] });
  });
});

describe('schema v3', () => {
  it('migrating a v2 database keeps exercises and gives them an empty checklist', async () => {
    close();
    const { migrations } = await import('../src/main/db/migrations');
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-v2-'));
    const v2 = openDatabase(dir2, { migrations: migrations.slice(0, 2) });
    const t = '2026-01-01T00:00:00.000Z';
    v2.db.exec(`INSERT INTO semesters (id, name, start_date, end_date, created_at, updated_at) VALUES (1, 'S', '2026-09-14', '2026-12-18', '${t}', '${t}');
      INSERT INTO subjects (id, semester_id, name, color, created_at, updated_at) VALUES (1, 1, 'M', '#3366ff', '${t}', '${t}');
      INSERT INTO exercises (id, subject_id, title, planned_date, deadline_date, status, created_at, updated_at) VALUES (7, 1, 'Old', '2026-09-16', '2026-09-18', 'in_progress', '${t}', '${t}');
      INSERT INTO exercise_plan_dates (exercise_id, date) VALUES (7, '2026-09-16'), (7, '2026-09-17');`);
    v2.db.close();
    const v3 = openDatabase(dir2);
    close = () => {
      v3.db.close();
      fs.rmSync(dir2, { recursive: true, force: true });
    };
    expect(v3.schemaVersion).toBe(migrations.length);
    expect(v3.backupsCreated).toHaveLength(1);
    const s3 = new StudyService(v3.db);
    expect(s3.getExercise(7)).toMatchObject({ title: 'Old', status: 'in_progress', plannedDates: ['2026-09-16', '2026-09-17'], checklist: [] });
    expect(s3.subjectOverview(1)[0].exams).toEqual([]);
  });
});

describe('schema v4', () => {
  it('migrating a v3 database counts completed exercises as handed in', async () => {
    close();
    const { migrations } = await import('../src/main/db/migrations');
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-v3-'));
    const v3 = openDatabase(dir3, { migrations: migrations.slice(0, 3) });
    const t = '2026-01-01T00:00:00.000Z';
    v3.db.exec(`INSERT INTO semesters (id, name, start_date, end_date, created_at, updated_at) VALUES (1, 'S', '2026-09-14', '2026-12-18', '${t}', '${t}');
      INSERT INTO subjects (id, semester_id, name, color, created_at, updated_at) VALUES (1, 1, 'M', '#3366ff', '${t}', '${t}');
      INSERT INTO exercises (id, subject_id, title, planned_date, deadline_date, status, created_at, updated_at) VALUES
        (7, 1, 'Done', '2026-09-16', '2026-09-18', 'completed', '${t}', '${t}'),
        (8, 1, 'Open', '2026-09-16', '2026-09-18', 'in_progress', '${t}', '${t}');
      INSERT INTO exercise_plan_dates (exercise_id, date) VALUES (7, '2026-09-16'), (8, '2026-09-16');
      INSERT INTO exercise_checklist_items (exercise_id, position, text, done) VALUES (7, 0, 'Step', 1);`);
    v3.db.close();
    const v4 = openDatabase(dir3);
    close = () => {
      v4.db.close();
      fs.rmSync(dir3, { recursive: true, force: true });
    };
    expect(v4.schemaVersion).toBe(4);
    expect(v4.backupsCreated).toHaveLength(1);
    const s4 = new StudyService(v4.db);
    expect(s4.getExercise(7)).toMatchObject({ title: 'Done', status: 'completed', handedIn: true, checklist: [{ text: 'Step', done: true }] });
    expect(s4.getExercise(8)).toMatchObject({ title: 'Open', status: 'in_progress', handedIn: false });
  });
});

describe('week progress and celebrations', () => {
  const W = '2026-09-21';
  const progress = () => weekProgress(svc.getWeek(sem.id, W));

  it('counts lectures and exercises planned in the week, not ones only due in it', () => {
    svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 1, startTime: '10:00', endTime: '12:00' });
    svc.createExercise({ subjectId: math.id, title: 'Planned', description: '', plannedDates: ['2026-09-22'], deadlineDate: '2026-09-30' });
    svc.createExercise({ subjectId: math.id, title: 'Only due', description: '', plannedDates: ['2026-09-17'], deadlineDate: '2026-09-23' });
    expect(progress()).toEqual({ lectures: 1, lecturesDone: 0, exercises: 1, exercisesDone: 0, exercisesInProgress: 0 });
    expect(exerciseWeeks(['2026-09-17', '2026-09-18', '2026-09-24'])).toEqual(['2026-09-14', '2026-09-21']);
  });

  it('celebrates lectures, exercises and the whole week once each becomes complete', () => {
    const a = svc.createLecture({ subjectId: math.id, title: 'A', weekday: 1, startTime: '10:00', endTime: '12:00' });
    const b = svc.createLecture({ subjectId: math.id, title: 'B', weekday: 3, startTime: '10:00', endTime: '12:00' });
    const [e] = svc.createExercise({ subjectId: math.id, title: 'Sheet', description: '', plannedDates: ['2026-09-22'], deadlineDate: '2026-09-25' });
    const step = (change: () => void) => {
      const before = progress();
      change();
      return celebrationFor(before, progress());
    };
    expect(step(() => svc.setLectureCompleted(a.id, W, true))).toBeNull();
    expect(step(() => svc.setLectureCompleted(b.id, W, true))).toBe('lectures');
    expect(step(() => svc.setExerciseStatus(e.id, 'in_progress'))).toBeNull();
    expect(step(() => svc.setExerciseStatus(e.id, 'completed'))).toBe('everything');
    // Re-opening and completing again celebrates again; completing the lectures last also counts as everything.
    expect(step(() => svc.setLectureCompleted(b.id, W, false))).toBeNull();
    expect(step(() => svc.setLectureCompleted(b.id, W, true))).toBe('everything');
    expect(step(() => svc.setExerciseStatus(e.id, 'in_progress'))).toBeNull();
    svc.setLectureCompleted(a.id, W, false);
    expect(step(() => svc.setExerciseStatus(e.id, 'completed'))).toBe('exercises');
  });

  it('celebrates the whole week when the other category is empty', () => {
    const a = svc.createLecture({ subjectId: math.id, title: 'A', weekday: 1, startTime: '10:00', endTime: '12:00' });
    const before = progress();
    svc.setLectureCompleted(a.id, W, true);
    expect(celebrationFor(before, progress())).toBe('everything');
    // And the other way round: a week with exercises but no lectures.
    const empty = { lectures: 0, lecturesDone: 0, exercises: 0, exercisesDone: 0, exercisesInProgress: 0 };
    expect(celebrationFor({ ...empty, exercises: 2, exercisesDone: 1 }, { ...empty, exercises: 2, exercisesDone: 2 })).toBe('everything');
  });

  it('reports the state of every semester week for the week picker', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 1, startTime: '10:00', endTime: '12:00' });
    const [e] = svc.createExercise({ subjectId: math.id, title: 'Sheet', description: '', plannedDates: ['2026-09-29'], deadlineDate: '2026-10-02' });
    svc.setLectureCompleted(l.id, '2026-09-14', true);
    svc.setExerciseStatus(e.id, 'in_progress');
    const weeks = svc.getSemesterProgress(sem.id);
    expect(weeks).toHaveLength(14);
    expect(weeks[0].weekStart).toBe('2026-09-14');
    const status = (w: string) => weekStatus(weeks.find((x) => x.weekStart === w)!);
    expect(status('2026-09-14')).toBe('completed');
    expect(status('2026-09-21')).toBe('not_started');
    expect(status('2026-09-28')).toBe('in_progress');
    svc.deleteLecture(l.id, 'all', '');
    expect(weekStatus(svc.getSemesterProgress(sem.id)[1])).toBeNull();
  });

  it('needs something to complete and prefers the bigger celebration', () => {
    const empty = { lectures: 0, lecturesDone: 0, exercises: 0, exercisesDone: 0, exercisesInProgress: 0 };
    expect(celebrationFor(empty, empty)).toBeNull();
    expect(biggerCelebration('lectures', 'everything')).toBe('everything');
    expect(biggerCelebration('everything', 'exercises')).toBe('everything');
    expect(biggerCelebration(null, 'lectures')).toBe('lectures');
  });
});

describe('exams', () => {
  const exam = (over: Partial<Parameters<StudyService['createExam']>[0]> = {}) =>
    svc.createExam({ subjectId: math.id, kind: 'midterm', title: '', date: '2026-11-04', startTime: '10:15', endTime: '12:00', location: 'HG F1', notes: '', ...over });

  it('creates, validates, lists by subject and shows in the week', () => {
    const e = exam();
    expect(e).toMatchObject({ kind: 'midterm', title: '', startTime: '10:15', endTime: '12:00', location: 'HG F1' });
    const noTime = exam({ kind: 'final', title: 'Final exam', date: '2027-01-20', startTime: null, endTime: null });
    expect(noTime.startTime).toBeNull();
    expect(() => exam({ startTime: '12:00', endTime: '10:00' })).toThrow(/end after it starts/);
    expect(() => exam({ startTime: null, endTime: '10:00' })).toThrow(/start time/);
    expect(() => exam({ kind: 'oral' as never })).toThrow(UserError);
    expect(svc.subjectOverview(sem.id)[0].exams.map((x) => x.id)).toEqual([e.id, noTime.id]);
    expect(svc.getWeek(sem.id, '2026-11-02').exams.map((x) => x.id)).toEqual([e.id]);
    expect(svc.getWeek(sem.id, '2026-11-09').exams).toHaveLength(0);
    expect(svc.updateExam(e.id, { ...e, title: 'Midterm 1', date: '2026-11-05' })).toMatchObject({ title: 'Midterm 1', date: '2026-11-05' });
  });

  it('goes to the trash on its own or with its subject', () => {
    const e = exam();
    const del = svc.deleteExam(e.id);
    expect(svc.listTrash()[0]).toMatchObject({ kind: 'exam', label: 'Midterm (Mathematics)', itemCount: 1 });
    expect(() => svc.getExam(e.id)).toThrow(/no longer exists/);
    svc.restoreTrash(del.trashId);
    const subj = svc.deleteSubject(math.id);
    expect(() => svc.getExam(e.id)).toThrow(UserError);
    svc.restoreTrash(subj.trashId);
    expect(svc.getExam(e.id).id).toBe(e.id);
    svc.purgeTrash(svc.deleteSubject(math.id).trashId);
    expect(svc.listTrash()).toHaveLength(0);
  });
});

describe('checklists', () => {
  const steps = (...texts: string[]) => texts.map((text) => ({ text, done: false }));
  const texts = (id: number) => svc.getExercise(id).checklist.map((c) => `${c.text}${c.done ? ' (done)' : ''}`);

  it('stores steps in order, ticks them and starts the exercise', () => {
    const [e] = svc.createExercise({
      subjectId: math.id, title: 'Lab Report', description: '', plannedDates: ['2026-09-15'], deadlineDate: '2026-09-18',
      checklist: steps('Measure', 'Plot', 'Write up'),
    });
    expect(e.checklist.map((c) => c.text)).toEqual(['Measure', 'Plot', 'Write up']);
    const after = svc.setChecklistItemDone(e.checklist[1].id, true);
    expect(after.status).toBe('in_progress');
    expect(texts(e.id)).toEqual(['Measure', 'Plot (done)', 'Write up']);
    expect(() =>
      svc.createExercise({ subjectId: math.id, title: 'X', description: '', plannedDates: ['2026-09-15'], deadlineDate: '2026-09-18', checklist: steps('  ') }),
    ).toThrow(/empty/);
  });

  it('copies steps through a series: new occurrences, series edits keep ticks, ticking is not an override', () => {
    const list = svc.createExercise({
      subjectId: math.id, title: 'Report', description: '', plannedDates: ['2026-09-15'], deadlineDate: '2026-09-18',
      checklist: [{ text: 'Draft', done: true }, { text: 'Submit', done: false }],
      recurrence: { intervalWeeks: 1, count: 3, firstNumber: 1 },
    });
    expect(list.map((e) => texts(e.id))).toEqual([['Draft (done)', 'Submit'], ['Draft', 'Submit'], ['Draft', 'Submit']]);
    // Ticking in the dialog (scope 'this') is progress, not an individual change.
    svc.updateExercise({ id: list[1].id, scope: 'this', changes: { checklist: [{ text: 'Draft', done: true }, { text: 'Submit', done: false }] } });
    expect(svc.getExercise(list[1].id).overrides).toEqual([]);
    // Adding a step to the whole series keeps each occurrence's ticks.
    svc.updateExercise({
      id: list[0].id,
      scope: 'all',
      changes: { checklist: [{ text: 'Draft', done: true }, { text: 'Review', done: false }, { text: 'Submit', done: true }] },
    });
    expect(list.map((e) => texts(e.id))).toEqual([
      ['Draft (done)', 'Review', 'Submit (done)'],
      ['Draft (done)', 'Review', 'Submit'],
      ['Draft', 'Review', 'Submit'],
    ]);
    expect(svc.extendSeries(list[0].seriesId!, 1)[0].checklist.map((c) => [c.text, c.done])).toEqual([
      ['Draft', false],
      ['Review', false],
      ['Submit', false],
    ]);
  });

  it('asks before replacing individually changed steps', () => {
    const list = svc.createExercise({
      subjectId: math.id, title: 'Report', description: '', plannedDates: ['2026-09-15'], deadlineDate: '2026-09-18',
      checklist: steps('A'), recurrence: { intervalWeeks: 1, count: 2, firstNumber: 1 },
    });
    svc.updateExercise({ id: list[1].id, scope: 'this', changes: { checklist: steps('A', 'Extra') } });
    expect(svc.getExercise(list[1].id).overrides).toEqual(['checklist']);
    const res = svc.updateExercise({ id: list[0].id, scope: 'all', changes: { checklist: steps('B') } });
    expect(res).toMatchObject({ status: 'conflicts', conflicts: [{ id: list[1].id, fields: ['checklist'] }] });
    svc.updateExercise({ id: list[0].id, scope: 'all', changes: { checklist: steps('B') }, overridePolicy: 'keep' });
    expect([texts(list[0].id), texts(list[1].id)]).toEqual([['B'], ['A', 'Extra']]);
  });
});

describe('today', () => {
  it('collects today, what is next, overdue, due soon and exams', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 2, startTime: '10:00', endTime: '12:00' });
    svc.createLecture({ subjectId: math.id, title: 'Analysis', weekday: 3, startTime: '08:00', endTime: '10:00' });
    const [late] = svc.createExercise({ subjectId: math.id, title: 'Late', description: '', plannedDates: ['2026-09-22'], deadlineDate: '2026-09-25' });
    const [now] = svc.createExercise({ subjectId: math.id, title: 'Now', description: '', plannedDates: ['2026-09-29'], deadlineDate: '2026-10-02' });
    svc.createExercise({ subjectId: math.id, title: 'Later', description: '', plannedDates: ['2026-10-10'], deadlineDate: '2026-10-20' });
    const ex = svc.createExam({ subjectId: math.id, kind: 'midterm', title: '', date: '2026-11-04', startTime: null, endTime: null, location: '', notes: '' });
    svc.createExam({ subjectId: math.id, kind: 'other', title: 'Past quiz', date: '2026-09-20', startTime: null, endTime: null, location: '', notes: '' });
    svc.setLectureCompleted(l.id, '2026-09-14', true);

    const d = svc.getToday(sem.id, '2026-09-29'); // a Tuesday
    expect(d.lectures.map((o) => o.title)).toEqual(['LA']);
    expect(d.upcomingLectures[0]).toMatchObject({ title: 'Analysis', date: '2026-09-30' });
    expect(d.planned.map((e) => e.id)).toEqual([now.id]);
    expect(d.overdue.map((e) => e.id)).toEqual([late.id]);
    expect(d.dueSoon.map((e) => e.id)).toEqual([now.id]);
    expect(d.exams.map((e) => e.id)).toEqual([ex.id]);
    // Missed: LA on 22 Sep, Analysis on 16 and 23 Sep.
    expect(d.missedLectures.map((o) => o.date)).toEqual(['2026-09-16', '2026-09-22', '2026-09-23']);
  });

  it('counts the streak of days with everything done', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 1, startTime: '10:00', endTime: '12:00' });
    const w = svc.createLecture({ subjectId: math.id, title: 'An', weekday: 3, startTime: '10:00', endTime: '12:00' });
    for (const week of ['2026-09-14', '2026-09-21', '2026-09-28']) svc.setLectureCompleted(l.id, week, true);
    svc.setLectureCompleted(w.id, '2026-09-21', true);
    // Mon 14 done, Wed 16 missed, Mon 21 done, Wed 23 done, Mon 28 done; today Tue 29 has nothing.
    expect(svc.getToday(sem.id, '2026-09-29').streak).toEqual({ current: 3, best: 3, today: 'empty' });
    // Today (Wed 30) is still open: it doesn't break the streak.
    expect(svc.getToday(sem.id, '2026-09-30').streak).toEqual({ current: 3, best: 3, today: 'open' });
    svc.setLectureCompleted(w.id, '2026-09-28', true);
    expect(svc.getToday(sem.id, '2026-09-30').streak).toEqual({ current: 4, best: 4, today: 'done' });
    // An exercise planned on a day counts for that day: Mon 21 is no longer complete.
    svc.createExercise({ subjectId: math.id, title: 'PS', description: '', plannedDates: ['2026-09-21'], deadlineDate: '2026-10-02' });
    expect(svc.getToday(sem.id, '2026-09-29').streak).toEqual({ current: 2, best: 2, today: 'empty' });
  });

  it('keeps the streak while today is unfinished and only loses it for an unfinished earlier day', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 1, startTime: '10:00', endTime: '12:00' });
    // Mon 21, Mon 28 done; nothing else before today (Wed 30).
    for (const week of ['2026-09-21', '2026-09-28']) svc.setLectureCompleted(l.id, week, true);
    const [a] = svc.createExercise({ subjectId: math.id, title: 'A', description: '', plannedDates: ['2026-09-30'], deadlineDate: '2026-10-02' });
    const [b] = svc.createExercise({ subjectId: math.id, title: 'B', description: '', plannedDates: ['2026-09-30'], deadlineDate: '2026-10-02' });
    // Nothing of today done yet, then part of it (one done, one in progress): the streak stays.
    expect(svc.getToday(sem.id, '2026-09-30').streak).toEqual({ current: 2, best: 2, today: 'open' });
    svc.setExerciseStatus(a.id, 'completed');
    svc.setExerciseStatus(b.id, 'in_progress');
    expect(svc.getToday(sem.id, '2026-09-30').streak).toEqual({ current: 2, best: 2, today: 'open' });
    // The next day, today's leftovers break it.
    expect(svc.getToday(sem.id, '2026-10-01').streak).toEqual({ current: 0, best: 2, today: 'empty' });
    // An unfinished exercise on an earlier day (Tue 29) breaks it right away.
    const [c] = svc.createExercise({ subjectId: math.id, title: 'C', description: '', plannedDates: ['2026-09-29'], deadlineDate: '2026-10-02' });
    expect(svc.getToday(sem.id, '2026-09-30').streak).toEqual({ current: 0, best: 2, today: 'open' });
    // Finishing everything repairs both days.
    svc.setExerciseStatus(c.id, 'completed');
    svc.setExerciseStatus(b.id, 'completed');
    expect(svc.getToday(sem.id, '2026-09-30').streak).toEqual({ current: 4, best: 4, today: 'done' });
  });

  it('computeStreak skips empty days and keeps the best run', () => {
    const days = new Map([
      ['2026-09-01', { total: 2, done: 2 }],
      ['2026-09-02', { total: 1, done: 1 }],
      ['2026-09-04', { total: 1, done: 0 }],
      ['2026-09-05', { total: 3, done: 3 }],
    ]);
    expect(computeStreak(days, '2026-09-01', '2026-09-06')).toEqual({ current: 1, best: 2, today: 'empty' });
  });
});

describe('trash', () => {
  it('restores a subject with all its data and relationships', () => {
    const l = svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 2, startTime: '08:15', endTime: '10:00' });
    svc.setLectureCompleted(l.id, '2026-09-14', true);
    svc.createExercise({ subjectId: math.id, title: 'PS', description: 'notes', plannedDates: ['2026-09-15'], deadlineDate: '2026-09-18' });
    const del = svc.deleteSubject(math.id);
    expect(svc.listSubjects(sem.id)).toHaveLength(0);
    expect(svc.getWeek(sem.id, '2026-09-14').lectures).toHaveLength(0);
    expect(svc.getWeek(sem.id, '2026-09-14').exercises).toHaveLength(0);
    svc.restoreTrash(del.trashId);
    const w = svc.getWeek(sem.id, '2026-09-14');
    expect(w.lectures[0].completed).toBe(true);
    expect(w.exercises[0]).toMatchObject({ title: 'PS', description: 'notes' });
  });

  it('does not touch unrelated items', () => {
    const phys = svc.createSubject({ semesterId: sem.id, name: 'Physics', color: '#00aa00' });
    svc.createLecture({ subjectId: phys.id, title: 'Mechanics', weekday: 1, startTime: '08:00', endTime: '10:00' });
    const del = svc.deleteSubject(math.id);
    svc.purgeTrash(del.trashId);
    expect(svc.listSubjects(sem.id).map((s) => s.name)).toEqual(['Physics']);
    expect(svc.getWeek(sem.id, '2026-09-14').lectures).toHaveLength(1);
  });

  it('purging a semester removes trash entries of its children', () => {
    const del1 = svc.deleteSubject(math.id);
    const del2 = svc.deleteSemester(sem.id);
    expect(svc.listTrash().map((t) => t.id).sort()).toEqual([del1.trashId, del2.trashId].sort());
    svc.purgeTrash(del2.trashId);
    expect(svc.listTrash()).toHaveLength(0);
  });
});

describe('persistence and migrations', () => {
  it('reopens the same database file with all data', () => {
    svc.createLecture({ subjectId: math.id, title: 'LA', weekday: 1, startTime: '10:00', endTime: '12:00' });
    close();
    const reopened = openDatabase(dir);
    close = () => reopened.db.close();
    const s2 = new StudyService(reopened.db);
    expect(s2.listSemesters()).toHaveLength(1);
    expect(s2.getWeek(sem.id, '2026-09-14').lectures).toHaveLength(1);
    expect(reopened.backupsCreated).toHaveLength(0);
  });

  it('backs up and migrates an existing database, preserving data', async () => {
    close();
    const { migrations } = await import('../src/main/db/migrations');
    const v2 = [
      ...migrations,
      {
        version: migrations.length + 1,
        name: 'test: add column',
        up: (db: import('node:sqlite').DatabaseSync) => db.exec("ALTER TABLE subjects ADD COLUMN teacher TEXT NOT NULL DEFAULT ''"),
      },
    ];
    const reopened = openDatabase(dir, { migrations: v2 });
    close = () => reopened.db.close();
    expect(reopened.schemaVersion).toBe(migrations.length + 1);
    expect(reopened.backupsCreated).toHaveLength(1);
    expect(fs.existsSync(reopened.backupsCreated[0])).toBe(true);
    expect(new StudyService(reopened.db).listSubjects(sem.id)[0].name).toBe('Mathematics');
  });

  it('refuses to open a database from a newer app version', () => {
    close();
    const opened = openDatabase(dir);
    opened.db.exec('PRAGMA user_version = 999');
    opened.db.close();
    expect(() => openDatabase(dir)).toThrow(/newer version/);
    close = () => {};
  });

  it('rolls back a failing migration and leaves the data intact', async () => {
    close();
    const { migrations } = await import('../src/main/db/migrations');
    const bad = [
      ...migrations,
      {
        version: migrations.length + 1,
        name: 'broken',
        up: (db: import('node:sqlite').DatabaseSync) => {
          db.exec('DELETE FROM subjects');
          throw new Error('boom');
        },
      },
    ];
    expect(() => openDatabase(dir, { migrations: bad })).toThrow('boom');
    const reopened = openDatabase(dir);
    close = () => reopened.db.close();
    expect(reopened.schemaVersion).toBe(migrations.length);
    expect(new StudyService(reopened.db).listSubjects(sem.id)).toHaveLength(1);
  });
});
