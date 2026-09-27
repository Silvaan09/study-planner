import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/main/db/database';
import { StudyService, UserError } from '../src/main/service';
import type { Semester, Subject } from '../src/shared/types';

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

  it('outstanding list excludes completed and flags overdue exercises', () => {
    const [a] = svc.createExercise({ subjectId: math.id, title: 'A', description: '', plannedDates: ['2026-09-15'], deadlineDate: '2026-09-18' });
    const [b] = svc.createExercise({ subjectId: math.id, title: 'B', description: '', plannedDates: ['2026-09-16'], deadlineDate: '2026-10-18' });
    const [c] = svc.createExercise({ subjectId: math.id, title: 'C', description: '', plannedDates: ['2026-09-17'], deadlineDate: '2026-10-18' });
    svc.setExerciseStatus(b.id, 'in_progress');
    svc.setExerciseStatus(c.id, 'completed');
    const out = svc.getOutstanding(sem.id, '2026-09-27');
    expect(out.items.map((i) => (i.kind === 'exercise' ? [i.exercise.id, i.overdue] : null))).toEqual([
      [a.id, true],
      [b.id, false],
    ]);
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
