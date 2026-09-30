import type { DatabaseSync } from 'node:sqlite';

/**
 * Versioned schema migrations.
 *
 * RULES FOR ADDING A MIGRATION (read before changing the schema):
 *  1. Never edit or reorder an existing migration. Existing databases have already run it.
 *  2. Append a new entry with `version` = previous version + 1.
 *  3. Preserve data: prefer ALTER TABLE ... ADD COLUMN. If a table must be rebuilt
 *     (to change a column or constraint), create the new table, copy every row with
 *     INSERT INTO new SELECT ... FROM old, then drop the old table and rename.
 *     Set `rebuildsTables: true` so foreign keys are disabled during the migration and
 *     verified with PRAGMA foreign_key_check before committing.
 *  4. Each migration runs inside one transaction: it either applies fully or not at all.
 *  5. A backup of the database file is taken automatically before any migration runs.
 */
export interface Migration {
  version: number;
  name: string;
  rebuildsTables?: boolean;
  up(db: DatabaseSync): void;
}

// Columns shared by every user-data table:
//   deleted_at      - set when the row is in the trash (NULL = live)
//   trash_batch_id  - groups rows deleted in one user action, so they are restored together
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      db.exec(`
        CREATE TABLE trash_batches (
          id          INTEGER PRIMARY KEY,
          kind        TEXT NOT NULL,
          label       TEXT NOT NULL,
          detail      TEXT NOT NULL DEFAULT '',
          deleted_at  TEXT NOT NULL
        );

        CREATE TABLE semesters (
          id              INTEGER PRIMARY KEY,
          name            TEXT NOT NULL,
          start_date      TEXT NOT NULL,
          end_date        TEXT NOT NULL,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          deleted_at      TEXT,
          trash_batch_id  INTEGER,
          CHECK (start_date <= end_date)
        );

        CREATE TABLE subjects (
          id              INTEGER PRIMARY KEY,
          semester_id     INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
          name            TEXT NOT NULL,
          color           TEXT NOT NULL,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          deleted_at      TEXT,
          trash_batch_id  INTEGER
        );
        CREATE INDEX idx_subjects_semester ON subjects(semester_id);

        -- Recurring weekly lecture definition.
        CREATE TABLE lectures (
          id              INTEGER PRIMARY KEY,
          subject_id      INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
          title           TEXT NOT NULL,
          weekday         INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
          start_time      TEXT NOT NULL,
          end_time        TEXT NOT NULL,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          deleted_at      TEXT,
          trash_batch_id  INTEGER,
          CHECK (start_time < end_time)
        );
        CREATE INDEX idx_lectures_subject ON lectures(subject_id);

        -- Per-week state of a lecture. Rows exist only for weeks with state
        -- (completed, removed, or in the trash); other weeks are implicitly "not completed".
        -- Keyed by week (Monday) so moving a lecture to another weekday keeps its history.
        CREATE TABLE lecture_occurrences (
          id              INTEGER PRIMARY KEY,
          lecture_id      INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
          week_start      TEXT NOT NULL,
          completed       INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
          completed_at    TEXT,
          removed         INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
          deleted_at      TEXT,
          trash_batch_id  INTEGER,
          UNIQUE (lecture_id, week_start)
        );

        CREATE TABLE exercise_series (
          id              INTEGER PRIMARY KEY,
          subject_id      INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
          base_title      TEXT NOT NULL,
          interval_weeks  INTEGER NOT NULL CHECK (interval_weeks >= 1),
          next_number     INTEGER NOT NULL,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          deleted_at      TEXT,
          trash_batch_id  INTEGER
        );
        CREATE INDEX idx_series_subject ON exercise_series(subject_id);

        -- Individual exercises; recurring ones are occurrences of a series.
        CREATE TABLE exercises (
          id               INTEGER PRIMARY KEY,
          subject_id       INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
          series_id        INTEGER REFERENCES exercise_series(id) ON DELETE CASCADE,
          sequence_number  INTEGER,
          title            TEXT NOT NULL,
          description      TEXT NOT NULL DEFAULT '',
          planned_date     TEXT NOT NULL,
          deadline_date    TEXT NOT NULL,
          status           TEXT NOT NULL DEFAULT 'not_started'
                           CHECK (status IN ('not_started', 'in_progress', 'completed')),
          overrides        TEXT NOT NULL DEFAULT '[]',
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL,
          deleted_at       TEXT,
          trash_batch_id   INTEGER,
          CHECK (planned_date <= deadline_date)
        );
        CREATE INDEX idx_exercises_subject ON exercises(subject_id);
        CREATE INDEX idx_exercises_series ON exercises(series_id);
        CREATE INDEX idx_exercises_planned ON exercises(planned_date);
        CREATE INDEX idx_exercises_deadline ON exercises(deadline_date);
      `);
    },
  },
  {
    version: 2,
    name: 'multiple planned dates per exercise',
    up(db) {
      // Every day an exercise is planned to be worked on. exercises.planned_date is kept
      // as the earliest of these (used for sorting and the planned <= deadline check).
      db.exec(`
        CREATE TABLE exercise_plan_dates (
          id           INTEGER PRIMARY KEY,
          exercise_id  INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
          date         TEXT NOT NULL,
          UNIQUE (exercise_id, date)
        );
        CREATE INDEX idx_plan_dates_date ON exercise_plan_dates(date);
        INSERT INTO exercise_plan_dates (exercise_id, date) SELECT id, planned_date FROM exercises;
      `);
    },
  },
  {
    version: 3,
    name: 'exams and exercise checklists',
    up(db) {
      db.exec(`
        -- Midterms, endterms, finals of a subject. Times are optional (NULL = not known yet).
        CREATE TABLE exams (
          id              INTEGER PRIMARY KEY,
          subject_id      INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
          kind            TEXT NOT NULL CHECK (kind IN ('midterm', 'endterm', 'final', 'other')),
          title           TEXT NOT NULL DEFAULT '',
          date            TEXT NOT NULL,
          start_time      TEXT,
          end_time        TEXT,
          location        TEXT NOT NULL DEFAULT '',
          notes           TEXT NOT NULL DEFAULT '',
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          deleted_at      TEXT,
          trash_batch_id  INTEGER,
          CHECK (end_time IS NULL OR (start_time IS NOT NULL AND start_time < end_time))
        );
        CREATE INDEX idx_exams_subject ON exams(subject_id);
        CREATE INDEX idx_exams_date ON exams(date);

        -- Sub-steps of an exercise, in order.
        CREATE TABLE exercise_checklist_items (
          id           INTEGER PRIMARY KEY,
          exercise_id  INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
          position     INTEGER NOT NULL,
          text         TEXT NOT NULL,
          done         INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
        );
        CREATE INDEX idx_checklist_exercise ON exercise_checklist_items(exercise_id);
      `);
    },
  },
  {
    version: 4,
    name: 'exercises handed in separately from done',
    up(db) {
      // status = the work (the planned "To do" days); handed_in = the deadline is dealt with.
      // Handed in implies status 'completed'. Exercises completed so far were treated as finished, so they count as handed in.
      db.exec(`
        ALTER TABLE exercises ADD COLUMN handed_in INTEGER NOT NULL DEFAULT 0 CHECK (handed_in IN (0, 1));
        UPDATE exercises SET handed_in = 1 WHERE status = 'completed';
      `);
    },
  },
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1].version;
