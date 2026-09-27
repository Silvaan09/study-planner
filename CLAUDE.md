# Study Planner — overview for Claude

Windows desktop app for planning a university semester around a weekly timetable. Single user, offline, local SQLite database. Written in English; UI uses Monday-first weeks and 24-hour time.

**Keep this file current.** After any change to code, scripts, tests or config, update the relevant sections here, bump the version and add a `CHANGELOG.md` entry. A Stop hook (`.claude/hooks/check-docs.mjs`, registered in `.claude/settings.json`) blocks finishing a turn when `CLAUDE.md` or `CHANGELOG.md` is older than the latest change in `src/`, `scripts/`, `tests/` or the build configs, or when `CHANGELOG.md` has no `## <version>` entry for the version in `package.json`. Bump the version before writing the changelog entry.

## Docs

- `README.md` is the public GitHub landing page: user-facing, short, no internals (those belong here). Update it when a notable feature changes.
- `docs/screenshots/*.png` are shown in the README (1440×900, dark theme, demo data). Retake them when the UI changes visibly.
- `CHANGELOG.md` lists changes per version.

## Stack & commands

Electron 44 (bundles Node 24 → built-in `node:sqlite`, no native modules) · React 19 · TypeScript · Vite 8 (renderer) · esbuild (main/preload) · vitest · electron-builder (NSIS installer).

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + Electron, uses the `StudyPlanner-dev` data folder |
| `npm test` | vitest: business rules, trash, persistence, migrations (`tests/service.test.ts`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | bundle main/preload (`scripts/build-main.mjs`) + renderer → `dist/` |
| `npm run dist` | typecheck + test + build + installer → `release/Study Planner Setup <version>.exe`, then `scripts/clean-release.mjs` deletes installers of other versions |
| `npm run icon` | regenerate `build/icon.ico`/`icon.png` from `src/renderer/logo.svg` |

Launching Electron from tooling: unset `ELECTRON_RUN_AS_NODE` (the npm scripts do this; VS Code/Claude environments set it).

## Versioning (semver, in `package.json`)

Bump with `npm version <x.y.z> --no-git-tag-version` and add an entry at the top of `CHANGELOG.md`.
- **major** — changes the user must act on themselves (manual data steps, anything that can't migrate automatically) or removed features.
- **minor** — new features or visible UI changes, including automatic schema migrations.
- **patch** — bug fixes and small tweaks.
Several changes in one session share a single bump; pick the level of the largest change.
Changes that don't affect the installed app (build scripts, tests, docs, Claude config) get no bump: list them under `## Unreleased` at the top of `CHANGELOG.md`, and fold that section into the next release.

## Layout

```
src/shared/dates.ts        ISO-date ("YYYY-MM-DD") + "HH:MM" helpers, formatting, week math (Monday = 1)
src/shared/types.ts        domain types + StudyApi (the full UI↔data contract)
src/main/db/database.ts    open DB (WAL, integrity check), backups, migration runner
src/main/db/migrations.ts  versioned schema — append only
src/main/service.ts        ALL business rules + SQL (StudyService); throws UserError for user-facing messages
src/main/main.ts           Electron window, data-folder resolution, IPC allow-list (serviceMethods)
src/preload/preload.ts     exposes window.studyApi.call(method, args)
src/renderer/api.ts        typed proxy over the IPC call
src/renderer/ui.tsx        UiProvider: toasts, dialog(), run() (mutation + error toast + refresh), useLoad()
src/renderer/actions.tsx   shared delete flows (scope chooser, confirm, Undo toast)
src/renderer/dialogs.tsx   Semester/Subject/Lecture/Exercise dialogs, TimeInput, StatusPicker
src/renderer/views/        TimetableView, OutstandingView, SubjectsView, TrashView, DataView
src/renderer/styles.css    dark theme only; tokens on :root
tests/service.test.ts      service + database tests against a real temp SQLite file
```

## Data model

`semesters → subjects → lectures` (weekly pattern: weekday, start/end) `→ lecture_occurrences` (per-week state keyed by `week_start` Monday: `completed`, `removed` tombstone). Occurrences without a row are implicitly "not completed".
`subjects → exercise_series` (base title, interval weeks, `next_number`) `→ exercises` (one row per occurrence; `sequence_number`; `overrides` JSON list of fields changed individually). Standalone exercises have `series_id = NULL`.
`exercises → exercise_plan_dates` (schema v2): every day an exercise is planned to be worked on (≥1). `exercises.planned_date` is kept equal to the earliest one by `StudyService.writeExercise/insertExercise` — always write through those. In the API: `Exercise.plannedDates` (sorted) and `plannedDate` (= first); override field `'plannedDate'` covers all planned dates. Recurring series repeat the planned pattern per occurrence (shift = interval × 7 × sequence difference).
Status: `not_started | in_progress | completed` (one per exercise, not per planned day). All planned dates must be ≤ the deadline (service check on the latest; DB CHECK on `planned_date`).

Trash: rows get `deleted_at` + `trash_batch_id` (one batch per user action, listed in `trash_batches`). Children stay hidden while an ancestor is trashed (queries join ancestors — see `LIVE_*` fragments in service.ts). Restore is refused while a parent is still in the trash. Purge hard-deletes (FK cascades), except lecture occurrences which become `removed` tombstones.

## Rules that must hold

- **User data is sacred.** Real DB: `%APPDATA%\StudyPlanner\study-planner.db` (dev: `StudyPlanner-dev`, override `STUDY_PLANNER_DATA_DIR`). Never delete/reset it or create a fresh DB when one exists.
- **Schema change = new migration** appended to `migrations.ts` (never edit old ones); preserve data; add a test that old data survives. The runner backs up before migrating, runs each migration in a transaction, and refuses DBs from newer versions.
- New service method → add to `StudyApi` in `types.ts` and to `serviceMethods` in `main.ts`.
- Lecture completion is per week; every exercise planned date ≤ deadline (validated in the service; DB CHECK covers the earliest).
- Recurring scopes `this | future | all`. Series edits must never silently overwrite per-occurrence `overrides` (service returns `conflicts`; UI asks overwrite/keep). Series-scope edits: a changed deadline shifts each occurrence by the same number of days; a changed planned-days pattern is copied to each occurrence at its position in the series. Drag-and-drop (`moveExercise(id, from, to)`) moves one planned day of that occurrence only; moving onto an already planned day merges them.
- Deletes go to the trash first.
- Dates: use `src/shared/dates.ts`; never time-zone-dependent `Date` math.

## Outstanding view notes

- Lists every uncompleted exercise and every past/today lecture occurrence that isn't completed, grouped by date.
- The "open exercises" stat counts only uncompleted exercises planned for today or earlier, or due within the next 7 days (`counts` in `OutstandingView.tsx`).

## Timetable UI notes

- Default visible hours 07:00–21:00 (widened to fit lectures); `HOUR_PX = 64`.
- One scroll container (`.tt-scroll`) with a sticky block (header + "To do" + "Due" rows) so day columns align exactly.
- Day column widths come from `--days`: weight 1, 1.6 (two lectures side by side), 2.2 (three+), 0.7 for completely empty days.
- Lecture cards: top-aligned, check mark floated top right, text wraps (no mid-word breaks); hover expands a card to show all text. Past uncompleted lectures get a subtle amber outline (`.missed`).
- Deadline cards ("Due" row): the flag/check icon (`.due-check`) toggles completed ↔ in progress; the rest of the card opens the editor. Planned cards: the status circle cycles the three statuses.
- Saturday/Sunday share `--weekend` tint; today is marked only in the header.
- Before finishing UI work: `npm run typecheck && npm test`, then check visually (build + launch).
