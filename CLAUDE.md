# Study Planner — overview for Claude

Windows desktop app for planning a university semester around a weekly timetable. Single user, offline, local SQLite database. Written in English; UI uses Monday-first weeks and 24-hour time.

**Keep this file current.** After any change to code, scripts, tests or config, update the relevant sections here, bump the version and add a `CHANGELOG.md` entry. A Stop hook (`.claude/hooks/check-docs.mjs`, registered in `.claude/settings.json`) blocks finishing a turn when `CLAUDE.md` or `CHANGELOG.md` is older than the latest change in `src/`, `scripts/`, `tests/` or the build configs, or when `CHANGELOG.md` has no `## <version>` entry for the version in `package.json`. Bump the version before writing the changelog entry.

**Always build the installer.** After every change (once the docs and version are updated), run `npm run dist` so `release/` holds a fresh `Study Planner Setup <version>.exe` for the current version. Do this even for small or unreleased changes (it rebuilds the same version's installer), and report the path of the new `.exe`, or the error if the build failed.

## Docs

- `README.md` is the public GitHub landing page: user-facing, short, no internals (those belong here). Update it when a notable feature changes.
- `docs/screenshots/*.png` are shown in the README (1440×900, dark theme, `npm run seed-demo` data as of 2026-09-28, timetable shows week 2): `timetable`, `exercise-dialog` (new recurring "Lab Report", deadline date picker open), `outstanding`, `subject-focus` (Mathematics focused), `subjects` ("Problem Set" series expanded), `week-complete` (last open lecture of week 2 clicked; celebration captured ~1 s later). Capture them all in ONE CDP session so the viewport override isn't reset between shots. Retake them when the UI changes visibly — seed an empty throwaway folder with `npm run seed-demo -- <folder>`, launch with `STUDY_PLANNER_DATA_DIR=<folder>` and `--remote-debugging-port`, then capture over CDP (`Emulation.setDeviceMetricsOverride` 1440×900, `Page.captureScreenshot`; the override resizes the window on connect/disconnect, which closes open popups such as the date picker).

## Demo / test data

- **Always test the UI against the demo data**, not an empty or hand-seeded DB: `npm run seed-demo -- <empty folder> [--today=YYYY-MM-DD]` (`scripts/seed-demo.mjs` bundles `src/main/demoData.ts` with esbuild and runs it through `StudyService`). It refuses `%APPDATA%\StudyPlanner(-dev)` and any folder that already has a database.
- Content (`src/main/demoData.ts`): "Autumn Semester 2026" (14 Sep – 18 Dec), Chemistry/Computer Science/Mathematics/Physics, 12 weekly lectures, recurring series (Problem Set, Linear Algebra Sheet, Coding Assignment, Lab Report every 2 weeks, Mechanics Problems, Worksheet every 2 weeks) and standalone exercises (essay, quiz, project proposal, midterm prep, presentation). Completion follows `today`: past lectures done except `MISSED_LECTURES`; exercises due before today completed except `OVERDUE_EXERCISES`, started ones in progress. Tested in `tests/demo-data.test.ts`; keep that test in sync when changing the data.
- `CHANGELOG.md` lists changes per version.

## Stack & commands

Electron 44 (bundles Node 24 → built-in `node:sqlite`, no native modules) · React 19 · TypeScript · Vite 8 (renderer) · esbuild (main/preload) · vitest · electron-builder (NSIS installer).

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + Electron, uses the `StudyPlanner-dev` data folder |
| `npm test` | vitest: business rules, subject overview, trash, persistence, migrations (`tests/service.test.ts`), timetable scroll position (`tests/timetable-scroll.test.ts`), month helpers (`tests/dates.test.ts`), demo data (`tests/demo-data.test.ts`) |
| `npm run seed-demo -- <folder>` | fill an empty data folder with the demo semester (see "Demo / test data") |
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
src/shared/dates.ts        ISO-date ("YYYY-MM-DD") + "HH:MM" helpers, formatting, week + month math (Monday = 1)
src/shared/types.ts        domain types + StudyApi (the full UI↔data contract)
src/shared/progress.ts     week completion counts (weekProgress), week state (weekStatus), which celebration a change earns (celebrationFor)
src/main/db/database.ts    open DB (WAL, integrity check), backups, migration runner
src/main/db/migrations.ts  versioned schema — append only
src/main/service.ts        ALL business rules + SQL (StudyService); throws UserError for user-facing messages
src/main/main.ts           Electron window, data-folder resolution, IPC allow-list (serviceMethods)
src/main/demoData.ts       demo semester for testing/screenshots (seedDemo; not used by the app)
src/preload/preload.ts     exposes window.studyApi.call(method, args)
src/renderer/api.ts        typed proxy over the IPC call
src/renderer/ui.tsx        UiProvider: toasts, dialog(), run() (mutation + error toast + refresh), celebrate(), useLoad()
src/renderer/actions.tsx   shared delete flows (scope chooser, confirm, Undo toast); useWeekCompletion (ding + celebration check)
src/renderer/sound.ts      check-off ding and celebration chime (Web Audio), mute preference
src/renderer/components/Celebration.tsx  confetti overlay (click-through, auto-removed)
src/renderer/components/WeekPicker.tsx   custom week dropdown with per-week status icons (getSemesterProgress)
src/renderer/components/DatePicker.tsx   custom calendar: DateField (replaces <input type="date">), DatePopover (portal popup)
src/renderer/dialogs.tsx   Semester/Subject/Lecture/Exercise dialogs, TimeInput, StatusPicker
src/renderer/App.tsx       sidebar (see "Sidebar"), view switching, subject focus state
src/renderer/components/FocusPill.tsx    "Only <subject> ×" pill shown in view headers while a subject is focused
src/renderer/views/        TimetableView, OutstandingView, SubjectsView ("Manage subjects"), TrashView, SettingsView (sound + data & backups)
src/renderer/styles.css    dark theme only; tokens on :root
src/renderer/timetableScroll.ts  initial timetable scroll position (pure, tested)
tests/service.test.ts      service + database tests against a real temp SQLite file
tests/timetable-scroll.test.ts   bestTopMinute
tests/dates.test.ts        month helpers (addMonths clamping, daysInMonth, formatMonth)
tests/demo-data.test.ts    seedDemo produces a semester in progress
scripts/seed-demo.mjs      npm run seed-demo
```

## Date picker

- Never use `<input type="date">` (its popup can't be styled): use `DateField` (form fields) or `DatePopover` (custom trigger, e.g. the timetable's "Go to date" button). Both live in `components/DatePicker.tsx`.
- Options: `min`/`max` (days outside are disabled, like the native picker), `marks` (dots: `planned` accent, `deadline` danger, with legend), `range` (tinted days, e.g. the semester), `weeks` (week selection: whole-row hover/selection, no week-number column; used by the timetable jump).
- The popup is portaled into `<body>` (`position: fixed`, flips above when there's no room) so modal scroll areas don't clip it. It closes on outside mousedown, window blur/resize, Tab out, Esc (months view → days view first). All keydowns stop at the popup, so Esc doesn't close the surrounding dialog and ← → don't switch timetable weeks.
- The days view is one continuous, freely scrollable list of weeks (±`SPAN_WEEKS` ≈ 10 years around the initial day), virtualized: rows are absolutely placed at `r × ROW_PX` inside `.dp-track`, only the visible ones ± `OVERSCAN` are rendered; `.dp-scroll` shows `VISIBLE_WEEKS` rows. All scrolling goes through `animateTo` and always rests on a whole row (no CSS scroll-snap: it mis-snaps when the target row isn't rendered yet). The wheel is handled by a non-passive listener: one week per mouse-wheel notch (|delta| ≥ 50px), smaller trackpad deltas accumulate to one week per `ROW_PX`. `pending` holds the target of a running smooth scroll so quick repeated notches/clicks continue from the target (cleared on arrival/`scrollend`).
- The "active" month (title, brighter days, base for the ↑/↓ buttons) is the month with the most of the 42 visible days (earlier on a tie), so with a month's first week at the top it is that month. The 1st of each month shows its short name (absolutely placed, so the number stays aligned). It opens with the value's month at the top. ↑/↓ and PageUp/PageDown smooth-scroll exactly one month (`stepMonth`/`showMonth`): the week containing the 1st becomes the top row; the month/year view jumps there. "Today"/"This week" only scrolls to today's month and highlights today (doesn't select or close).
- Keyboard: arrows move by day/week (scrolling just enough to keep the focus visible), PageUp/PageDown by month (Shift: year), Home/End week start/end, Enter or Space selects (Space on key-up, so the refocused field doesn't reopen), ↓ on a closed field opens it. Before it is positioned the popup is `opacity: 0` (not `visibility: hidden`) so the grid can take focus on mount.
- The exercise dialog marks the other planned days and the deadline in each planned-day picker, and the planned days in the deadline picker.

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

## Celebrations

- A week's progress = its lecture occurrences + the exercises with a planned date in it (`weekProgress`, also used for the timetable header counters). Exercises only *due* in a week don't count there.
- Kinds: `lectures` / `exercises` when that category just became fully completed; `everything` instead when afterwards nothing in the week is left (the other category is complete or empty — e.g. finishing the lectures of a week without exercises). An empty category never triggers a celebration by itself.
- Completion actions go through `useWeekCompletion(semesterId)(weeks, change)`: it snapshots those weeks via `getWeek` before and after the change, so deleting unfinished items never celebrates. Lecture → its `weekStart`; exercise → `exerciseWeeks(plannedDates)`. Pass `[]` when un-completing. Wired into TimetableView (lecture click/menu, status circle, deadline flag, status menu) and OutstandingView; status changes saved from the exercise dialog don't celebrate.
- `ui.celebrate(kind, weekStart)` shows `Celebration` for `CELEBRATION_MS`; `prefers-reduced-motion` hides the confetti.
- Sound (`src/renderer/sound.ts`, Web Audio, synthesized — no audio files): `useWeekCompletion` plays `playDing()` (one bell note, E6) whenever it gets weeks, i.e. whenever something is checked off (never on un-completing); `ui.celebrate` adds `playCelebration(kind)` (C–E–G arpeggio, + C7 for `everything`) just after the ding. Mute toggle = switch in Settings (localStorage key `sound`; turning it on plays a preview ding).

## Sidebar

- Order: brand · Semester (picker, edit/new, dates) · **Planning** (Timetable, Outstanding + open/overdue badge) · **Subjects** (one row per subject, then "Manage subjects" = SubjectsView) · pinned to the bottom above a divider: **Trash** (muted count badge) and **Settings**. Views: `timetable | outstanding | subjects | trash | settings` (remembered in localStorage; the old `data` value maps to `settings`).
- Subject focus (`focusId` in `App`, not persisted, cleared on semester switch; the sidebar and views use the resolved `focus` subject, so a deleted/trashed subject simply ends the focus): clicking a subject row focuses it, clicking again unfocuses; other rows fade. TimetableView adds `.dimmed` (faded + greyscale, clearer on hover) to lectures and exercise cards of other subjects; OutstandingView lists and counts only that subject; SubjectsView dims the other cards. Each shows `FocusPill` in its header to clear it. Focusing from Trash/Settings switches to the timetable.
- The timetable legend (Lecture / Completed / Missed / To do / Deadline) lives in the top-left corner cell of the timetable: `Info` button, popover on hover or keyboard focus.

## Subjects view notes

- Each card lists weekly lectures and exercises. `subjectOverview` returns the subject's live `exercises` (ordered by deadline); series rows expand (chevron; collapsed by default, component state only) to show their occurrences, standalone exercises are listed below. Every exercise row opens `ExerciseDialog`.

## Outstanding view notes

- Lists every uncompleted exercise and every past/today lecture occurrence that isn't completed, grouped by date.
- The "open exercises" stat counts only uncompleted exercises planned for today or earlier, or due within the next 7 days (`counts` in `OutstandingView.tsx`).

## Timetable UI notes

- Default visible hours 07:00–21:00 (widened to fit lectures); `HOUR_PX = 64`.
- One scroll container (`.tt-scroll`) with a sticky block (header + "To do" + "Due" rows) so day columns align exactly. It has `overflow-anchor: none`: the view sets its own scroll position on week change, and scroll anchoring would shift that when the sticky rows change height.
- Initial scroll per week (`bestTopMinute` in `src/renderer/timetableScroll.ts`, tested in `tests/timetable-scroll.test.ts`): once that week's data has loaded (`data.weekStart === weekStart`, once per semester+week), pick the top that shows the most lectures fully, then the most lecture minutes, then closest to 07:45 (08:00 minus 15 min padding). Visible height = `.tt-scroll` height minus the sticky block. Data refreshes within the same week don't re-scroll.
- Day column widths come from `--days`: weight 1, 1.6 (two lectures side by side), 2.2 (three+), 0.7 for completely empty days.
- Lecture cards: top-aligned, check mark floated top right, text wraps (no mid-word breaks); hover expands a card to show all text. Past uncompleted lectures get a subtle amber outline (`.missed`).
- Deadline cards ("Due" row): the flag/check icon (`.due-check`) toggles completed ↔ in progress; the rest of the card opens the editor. Planned cards: the status circle cycles the three statuses.
- Week dropdown (`WeekPicker`, custom listbox since native `<option>`s can't show icons): per-week `StatusIcon` from `weekStatus` — completed (everything done), in progress (anything done or an exercise started), not started; no icon for empty weeks. While open it swallows ↑ ↓ Enter Esc so the timetable's ← → shortcuts don't fire.
- Date jump: an `.icon-btn` that opens a `DatePopover` in `weeks` mode (shown week selected, semester tinted); picking any day shows its week; "This week" scrolls the calendar to today.
- Saturday/Sunday share `--weekend` tint; today is marked only in the header.
- Before finishing UI work: `npm run typecheck && npm test`, then check visually (build + launch), then `npm run dist` (see "Always build the installer").
