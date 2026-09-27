# Study Planner

A Windows desktop app for planning a university semester around a weekly timetable: recurring lectures with per-week completion, exercises with planned dates and deadlines, recurring exercise series, an outstanding-items list, and a trash bin.

Built with Electron 44, React 19, TypeScript, and SQLite (Node's built-in `node:sqlite`, so there are no native modules to compile).

## Using the app

- **Timetable** — Monday–Sunday, 24-hour. Use ← / → to change weeks and **T** to jump to the current week.
  - **Click a lecture** to mark that week's occurrence completed or not completed. Right-click (or `⋯`) to edit or delete it.
  - **To do** row: exercises on their *planned* date. Drag a card to another day to reschedule it. Days after the deadline are blocked. Click the circle to cycle the status (not started → in progress → completed).
  - **Due** row: hand-in deadlines, marked with a flag.
  - Long titles wrap. If a lecture's text doesn't fit its time slot, hover over it to see everything. Days with lectures side by side get extra width.
  - Double-click an empty day to create an exercise, or double-click the time grid to create a lecture.
- **Outstanding** — lectures that have taken place but aren't completed yet, plus every exercise that isn't completed, oldest first. Overdue exercises are shown in red.
- **Subjects** — manage the semester's subjects, weekly lectures and exercise series.
- **Trash** — every delete ends up here. Restore it, or delete it permanently.
- **Data & backups** — shows where the data is stored, opens the folder, and creates a backup on demand.

### Recurring exercises
An exercise can be planned on several days: add more days in the exercise dialog, or use **Every <weekday> until the deadline**. Each planned day appears in the timetable as its own session card and can be dragged separately.

Creating an exercise with **Recurring** turned on generates numbered occurrences (`Problem Set 01`, `02`, …), and the planned days repeat in each one — e.g. due every second Friday but planned every Thursday. Each occurrence is its own exercise. When you edit one, choose **Only this exercise**, **This & following**, or **Whole series**. If a series-wide change would overwrite fields you changed on individual occurrences, the app asks whether to overwrite them or keep them. Deleting works the same way.

## Where your data lives

| Build | Data folder |
|---|---|
| Installed / packaged app | `%APPDATA%\StudyPlanner\` |
| `npm run dev` / `npm start` | `%APPDATA%\StudyPlanner-dev\` (kept separate so experiments never touch real data) |
| Any build, with `STUDY_PLANNER_DATA_DIR` set | that folder |

The folder contains `study-planner.db` and `backups\`. It sits outside the install and build folders, so rebuilding, reinstalling or uninstalling the app never touches it. The uninstaller keeps it too.

Backups are created automatically:
- `pre-migration-v<from>-to-v<to>-<time>.db` — before **any** schema migration. Never deleted automatically.
- `auto-<date>.db` — once a day on startup. The last 14 are kept.
- `manual-<time>.db` — from *Create backup now*.

To restore a backup, close the app, then copy the backup over `study-planner.db` (and delete any `study-planner.db-wal` / `-shm` files next to it).

## Development

```sh
npm install
npm run dev        # Vite dev server + Electron, with hot reload for the UI
npm test           # business-rule, persistence and migration tests (vitest)
npm run typecheck
npm run dist       # typecheck + tests + build → release\Study Planner Setup <version>.exe (older installers are removed)
npm run icon       # regenerate build\icon.ico / icon.png from src\renderer\logo.svg
```

Install a new version by running the new setup `.exe`. Your existing data is picked up automatically.

### Architecture

```
src/
  shared/      dates.ts (ISO-date and time helpers), types.ts (domain types + API contract)
  main/        Electron main process
    db/        database.ts (open, WAL, integrity check, backups), migrations.ts (versioned schema)
    service.ts all business rules and persistence (the only code that touches SQL)
    main.ts    window, data-folder resolution, IPC allow-list
  preload/     exposes a single narrow `studyApi.call` bridge
  renderer/    React UI. It calls the service through `api.ts` and never sees the database
tests/         vitest tests against a real SQLite file
```

Data model: `semesters → subjects → lectures` (weekly pattern) `→ lecture_occurrences` (per-week state, keyed by the Monday of the week), and `subjects → exercise_series → exercises` (one row per occurrence; `overrides` records which fields were changed individually), and `exercises → exercise_plan_dates` (the days each exercise is planned for). Deleted rows get `deleted_at` + `trash_batch_id`, so one user action is restored or purged as a unit, and children stay hidden while a parent is in the trash.

### Changing the database schema

Read the header of `src/main/db/migrations.ts` first. In short:
1. **Never edit an existing migration.** Append a new one with the next version number.
2. Preserve data: use `ALTER TABLE … ADD COLUMN`, or rebuild a table by copying every row (`rebuildsTables: true`).
3. Add a test in `tests/service.test.ts` that opens a database created by the previous version and checks the data survives.

On startup the app backs up the database, runs each pending migration in its own transaction, and rolls back if one fails. If the database was created by a *newer* app version, the app refuses to open it and leaves it untouched.
