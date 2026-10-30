# Study Planner — overview for Claude

Windows desktop app for planning a university semester around a weekly timetable. Single user, offline (except update checks), local SQLite database. English UI, Monday-first weeks, 24-hour time.

## Working rules

- **Keep this file current.** After any change to code, scripts, tests or config: update the relevant sections here, bump the version (see Versioning), then add the `CHANGELOG.md` entry. A Stop hook (`.claude/hooks/check-docs.mjs`) blocks finishing a turn while `CLAUDE.md`/`CHANGELOG.md` are older than the newest file in `src/`, `scripts/`, `tests/` or the build configs, or `CHANGELOG.md` lacks `## <package.json version>`.
- **Always build the installer.** After every change (docs and version updated), run `npm run dist` so `release/` holds `Study-Planner-Setup-<version>.exe` (rebuilds the same version for unreleased changes). Report its path, or the build error.
- **Test UI against the demo data** (see Demo data), then check visually (build + launch over CDP, see Screenshots), before `npm run dist`.
- `README.md` = public GitHub page: user-facing, short, no internals. Update it when a notable feature changes.
- Publishing a GitHub release (`npm run release`) is outward-facing: only when the user asks.
- **GitHub release text = the in-app "What's new" dialog.** The release description is what installed apps show after updating (see App shell → What's new), so when asked for release text, write it to read well in BOTH places:
  - user-facing, from the version's CHANGELOG entry without development/test/README/Claude-config points; short bold lead-ins, then a sentence or two;
  - only the Markdown the app renders: `##`/`###` headings, `-` bullets (one nested level), `1.` lists, `**bold**`, `*italic*`, `` `code` ``, `[links](https://…)`. No images, tables, HTML, block quotes or code blocks (shown as plain text);
  - an opening `## Study Planner <version>` heading is fine (the app drops a first heading containing the version, the dialog title already says it);
  - download/install instructions go in a final `### Updating` (or `### Installing` / `### Download`) section: the app hides sections whose heading starts with Install/Updating/Download, so they only appear on GitHub. Nothing else may rely on being GitHub-only.
  - ALWAYS end the reply (outside the text block) with what to attach for a manual release, since auto-update depends on it: tag `v<version>`, and from `release/` all three of `Study-Planner-Setup-<version>.exe`, `Study-Planner-Setup-<version>.exe.blockmap`, `latest.yml` (from the same `npm run dist` build; a missing or stale `latest.yml` = installed apps never see the update). Mention that `npm run release` does all of it after `gh auth login` (it uses the CHANGELOG entry minus project-only points as text). If `release/` doesn't hold that version's build yet, say to run `npm run dist` first.

## Stack & commands

Electron 44 (Node 24 → built-in `node:sqlite`, no native modules) · React 19 · TypeScript · Vite 8 (renderer) · esbuild (main/preload, bundles `electron-updater`) · vitest · electron-builder (NSIS).

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + Electron, `StudyPlanner-dev` data folder |
| `npm test` | vitest (see Tests) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | main/preload (`scripts/build-main.mjs`) + renderer → `dist/` |
| `npm run dist` | typecheck + test + build + installer (`--publish never`) → `release/Study-Planner-Setup-<version>.exe` + `.blockmap` + `latest.yml`; `scripts/clean-release.mjs` deletes other versions' installers |
| `npm run release` | `scripts/publish-release.mjs`: `gh release create v<version>` with exe + blockmap + `latest.yml`, notes = the version's CHANGELOG entry (needs `gh auth login`) |
| `npm run seed-demo -- <folder> [--today=YYYY-MM-DD]` | fill an empty data folder with the demo semester |
| `npm run icon` | regenerate `build/icon.ico`/`icon.png` from `src/renderer/logo.svg` |

Launching Electron from tooling: unset `ELECTRON_RUN_AS_NODE` (npm scripts do; VS Code/Claude environments set it). `STUDY_PLANNER_DATA_DIR` overrides the data folder.

## Versioning (semver, `package.json`)

Bump with `npm version <x.y.z> --no-git-tag-version`; entry at the top of `CHANGELOG.md`.
- **major**: the user must act themselves (manual data steps, non-migratable changes) or features removed.
- **minor**: new features or visible UI changes, incl. automatic schema migrations.
- **patch**: bug fixes, small tweaks.
One bump per session (level of the largest change); later changes in the same session extend that entry. Changes not affecting the installed app (build scripts, tests, docs, Claude config) get no bump: list them under `## Unreleased`, folded into the next release.

## Layout

```
src/shared/dates.ts        ISO dates ("YYYY-MM-DD") + "HH:MM": math, week/month helpers (Monday = 1), formatDate/formatDateRange/formatCountdown
src/shared/types.ts        domain types + StudyApi (the whole UI↔data contract); helpers: examTitle, sessionStatus, exercise stage helpers, breakTitle/breakOn
src/shared/progress.ts     weekProgress, weekStatus, celebrationFor, computeStreak
src/shared/releaseNotes.ts ReleaseNotes; changelogEntry, userFacingChangelog, parseMarkdown/parseInline (safe Markdown subset), inAppBlocks (pure)
src/main/db/database.ts    open DB (WAL, integrity check), backups, migration runner
src/main/db/migrations.ts  versioned schema, append only (v8)
src/main/service.ts        ALL business rules + SQL (StudyService); UserError = message shown to the user
src/main/main.ts           window (+ window state), data folder, IPC allow-list (serviceMethods / appMethods)
src/main/windowState.ts    parseWindowState (pure)
src/main/updater.ts        auto-updater (electron-updater, GitHub)
src/main/whatsNew.ts       "What's new": release text fetch/cache, seen version; imports CHANGELOG.md as text (markdown.d.ts, esbuild `.md` loader)
src/main/demoData.ts       demo semester (seedDemo; not used by the app)
src/preload/preload.ts     window.studyApi: call(method, args), onUpdateStatus(listener)
src/renderer/api.ts        typed proxy over the IPC call
src/renderer/ui.tsx        UiProvider: toasts, dialog(), run() (mutation + error toast + refresh), celebrate(), useLoad(), useNow(); Modal, Confirm, ScopeChooser
src/renderer/actions.tsx   delete flows (scope chooser, confirm, Undo toast), useWeekCompletion, useExerciseProgress, useChecklistToggle
src/renderer/search.ts     search matching/ranking (pure)
src/renderer/updates.ts    useUpdateStatus()
src/renderer/sound.ts      ding + celebration chime (Web Audio, synthesized), mute preference
src/renderer/dialogs.tsx   Semester (+ breaks row), Breaks, Subject, Lecture, Exercise, Exam dialogs; ChecklistEditor, TimeInput, StatusPicker
src/renderer/App.tsx       sidebar, view switching, subject focus, search (Ctrl+K) + opening its results
src/renderer/components/   Celebration, WeekPicker, DatePicker (DateField/DatePopover), Checklist, ExamRow, ContextMenu, FocusPill, SearchPalette, WhatsNew (dialog + Markdown rendering), Icons
src/renderer/views/        TodayView, TimetableView, OutstandingView, SubjectsView ("Manage subjects"), TrashView, SettingsView
src/renderer/timetableScroll.ts, swipe.ts   pure timetable rules (tested)
src/renderer/styles.css    dark theme only; tokens on :root
```

## Rules that must hold

- **User data is sacred.** Real DB: `%APPDATA%\StudyPlanner\study-planner.db` (dev: `StudyPlanner-dev`). Never delete/reset it or create a fresh DB when one exists.
- **Schema change = new migration** appended to `migrations.ts` (never edit old ones), preserving data, plus a test that old data survives. The runner backs up first, runs each migration in a transaction, refuses DBs from newer versions.
- New service method → `StudyApi` in `types.ts` + `serviceMethods` in `main.ts` (Electron-side methods: `appMethods`).
- Deletes go to the trash first. Change statuses only through the service methods/helpers in "Sessions & status".
- Recurring scopes `this | future | all`. Series edits never silently overwrite per-occurrence `overrides` (service returns `conflicts`; UI asks overwrite/keep).
- Every planned date ≤ the deadline, if there is one (service check; DB CHECK on the earliest).
- Dates: use `src/shared/dates.ts`; never time-zone-dependent `Date` math.
- Never `<input type="date">` (unstylable popup): use `DateField` / `DatePopover`.

## Data model

`semesters → subjects → lectures → lecture_occurrences`; `semesters → semester_breaks`; `subjects → exercise_series → exercises → exercise_plan_dates / exercise_checklist_items`; `subjects → exams`.

- **Lectures**: weekly pattern (weekday, start/end time) plus optional `start_date`/`end_date` (v8; API `Lecture.startDate/endDate`, `null` = the semester's start/end, so it follows later semester changes; the dialog stores the semester's own dates as `null`). Validation (`lectureInput`): within the semester, first ≤ last, at least one of its weekdays in range. An occurrence exists on its weekday when `takesPlace`: inside `lectureRange` (own dates clipped to the semester) and not on a break. `lecture_occurrences` holds per-week state keyed by `week_start` (`completed`, `removed` tombstone); no row = not completed. State outside the range or on a break is kept and reappears when the range/break changes. `setLectureCompleted` refuses days without an occurrence.
- **Breaks** (v8, `semester_breaks`, API `SemesterBreak`, `listBreaks/createBreak/updateBreak/deleteBreak`): `name` (optional; `breakTitle` = name, else "Holiday" for one day / "Break"), `startDate ≤ endDate`, must overlap the semester (may run past its end). No lecture occurrences on their days (timetable, Outstanding, missed lectures, streak, week progress); exercises, tasks and exams are unaffected. Trashable (batch kind `break`, child of the semester). Returned by `getWeek` (`breaks` overlapping the week), `getSemesterProgress` (`breaks`: titles per week), `getToday` (`todayBreak`).
- **Exercises**: one row per occurrence (`sequence_number`, `overrides` JSON list); standalone = `series_id NULL`. `exercise_series`: base title, interval weeks, `next_number`. Planned days in `exercise_plan_dates` (≥1; API `plannedDates` sorted, `plannedDate` = first; `exercises.planned_date` kept = earliest by `writeExercise/insertExercise`, always write through those). Override `'plannedDate'` covers all planned dates. Series repeat the planned pattern per occurrence (shift = interval × 7 × sequence difference).
- **Deadline** (v5) nullable. Without one: shows only on planned days ("To do", never "Due"), can't be handed in (`setExerciseHandedIn(true)` throws; pickers offer three statuses via `exerciseStages`), finished once `completed`, overdue after its last planned day. Helpers: `exerciseSettled`, `exerciseDueBy`, `exerciseStages`. `ExerciseChanges.deadlineDate: null` removes it; series-scope edits shift deadlines by the same days, adding one places it at the same offset everywhere (`newDeadline`).
- **Personal tasks** (v6): each semester has exactly one `subjects.personal = 1` (unique partial index; default "Personal", `#64748b`). Its exercises are "tasks". Listed last, renamable, not deletable (`deleteSubject` refuses), no lectures/exams (`courseSubject`); trashed only with its semester. UI: "No subject · <name>" in the exercise dialog; sidebar, Manage subjects and search show the name exactly as entered (no " tasks" suffix).
- **Checklists** (v3): ordered steps (`position`, `text`, `done`); saved as a whole list (`saveChecklist` re-inserts, so ids change) or one step via `setChecklistItemDone`. Completing an exercise doesn't tick steps; `ChecklistProgress` hidden on completed exercises.
- **Exams** (v3): `kind` (`midterm | endterm | final | other`), optional `title` (`examTitle`), `date`, optional start/end (end needs start), `location`, `notes`. Trashable. In `subjectOverview`, `getWeek`, `getToday` (from today on).
- **Trash** (`TRASH_TABLES`, child → parent: exams, exercises, exercise_series, lecture_occurrences, lectures, subjects, semester_breaks, semesters): rows get `deleted_at` + `trash_batch_id` (one batch per user action, `trash_batches`). Children stay hidden while an ancestor is trashed (queries join ancestors, `LIVE_*` fragments). Restore refused while a parent is trashed (`blockedByParent`). Purge hard-deletes (FK cascades), except lecture occurrences → `removed` tombstones.

### Sessions & status

Each planned day is a session with its own status (`exercise_plan_dates.status`, v6/v7; API `Exercise.sessions` in plannedDates order, `sessionStatus(e, date)`). `exercises.status` is the exercise's OWN status (`not_started | in_progress | completed`, UI "Done"), moved by events:
- `setSessionStatus` → `statusAfterSession`: all sessions done → done; a done exercise stays done while a session is checked off; else in progress if any session/step started, else not started.
- `setChecklistItemDone` → `statusAfterStep`: all steps (non-empty) or all sessions done → done, else as above.
- Editor, drag & drop, series edits, creation: `promoted` only moves status UP to what sessions/steps show. A status set by hand (`setExerciseStatus`, `ExerciseChanges.status`, `applyProgress`) wins via `withStatus`: done ticks every session, not started clears them, in progress leaves them.
- One planned day: the session is the exercise (`singleFollows`).
- `writeExercise` aligns sessions to `plannedDates` (`alignSessions`: kept days keep status, new days take removed days' statuses in order, extra days not started, or done if the exercise is done) and drops `handed_in` unless completed. `moveExercise` carries the session's status (merging two different ones → in progress).
- `handed_in` (v4) = deadline dealt with; invariant handed in ⇒ completed (`setExerciseStatus` to anything else clears it; `setExerciseHandedIn(true)` = done + all sessions ticked). Per occurrence, never an override. UI combines both into `ExerciseStage` (+ `handed_in`, `exerciseStage`, `EXERCISE_STAGE_LABEL`).
- Overdue, due soon, Outstanding use `exerciseSettled`; week progress, celebrations, streak, "done today" use session status.

### Recurring edits

Series-scope edits: a changed deadline shifts each occurrence by the same days; a changed planned-days pattern is copied to each occurrence at its position. Drag & drop (`moveExercise(id, from, to)`) moves one planned day of that occurrence only (onto another planned day = merge). Dragging a deadline card = `updateExercise` scope `this` + `deadlineDate` (override `'deadlineDate'`). Checklists: only a changed list of step texts is an individual change (override `'checklist'`); ticking is progress. Series-scope checklist edits copy steps, keeping done state of same-text steps; new occurrences (`createExercise` recurrence, `extendSeries`) get them unticked.

## App shell (main process)

- **Window state**: `<dataDir>/app-state/window-state.json` = `{ maximized, fullScreen, bounds }` (`bounds` = `getNormalBounds()`). Missing/invalid → maximized, normal size 1400×900 centred. Flags tracked via window events (a minimized window can't tell it was maximized), bounds on `resize`/`move`/`close`; written on `closed` (renderer `window.close()` skips `close`). Closed while minimized → reopens as before minimizing. `parseWindowState` drops bounds overlapping no work area by ≥ 120×60 px and grows them to the minimum 960×640. Over CDP close with `window.close()` so it's saved.
- **Auto-update** (`updater.ts`): packaged builds only (`app.isPackaged`; dev = `disabled`). Checks on start + every 4 h, `autoDownload`, `autoInstallOnAppQuit`; `installUpdate()` ("Restart & update", after the renderer shows `UpdatingOverlay` via `useRestartToUpdate`) = `quitAndInstall(isSilent false, run after)` 1.2 s later; closing the app normally installs silently (`autoInstallOnAppQuit`). The visible update is shaped by `build/installer.nsh` (electron-builder picks it up): with `--updated`, `customInstallMode` keeps the previous install mode (no "who to install for" page) and `customFinishPage` skips the finish page and starts the app, so only the progress page shows; fresh installs keep all pages. It only takes effect when both the running app (passes non-silent) and the new installer (contains the .nsh) are ≥ 1.11.1. A silent install used to show nothing for seconds while the installer kills `Study Planner.exe`, so opening the app meanwhile failed. Feed: `build.publish` (GitHub `Silvaan09/study-planner`, releases) → `app-update.yml`; a release must contain `latest.yml` + the installer named as in it (`nsis.artifactName` `Study-Planner-Setup-${version}.${ext}`, no spaces since GitHub turns spaces into dots) + blockmap: use `npm run release`. State `UpdateStatus` (`idle | disabled | checking | up-to-date | downloading | ready | error`) via `getUpdateStatus`, pushed on IPC channel `update-status`; errors only shown in Settings. `STUDY_PLANNER_UPDATE_URL` (testing) = generic feed URL (a folder served over HTTP with `latest.yml` + installer).
- **What's new** (`whatsNew.ts`, `components/WhatsNew.tsx`): on the first start of a version (`whats-new.json`: `seenVersion`, cached `notes` by version, last 5) App shows `WhatsNewDialog` once, only when there is a semester (a fresh start marks it seen silently); Settings → Updates → "What's new in <version>" reopens it. Text: the GitHub release body of tag `v<version>` (Markdown, via `api.github.com/repos/…/releases/tags/v<version>`, 6 s timeout), fetched when an update is downloaded (`rememberReleaseNotes`, so it's there offline) or on first start; fallback = the bundled CHANGELOG entry minus project-only points (`userFacingChangelog`). Rendered by `parseMarkdown` → React elements (never HTML); `inAppBlocks` drops a leading version heading and Install/Updating/Download sections. Links open via `openExternalLink` (https only). The IPC handler awaits app methods (they may be async).

## UI

### Sidebar & search

- Order: brand · Search button (shows Ctrl F) · Semester (picker, edit/new, dates) · **Planning** (Today, Timetable, Outstanding + open/overdue badge) · **Subjects** (one row per subject, "No subjects yet.", the personal subject by its name, "Manage subjects") · bottom: "Restart to update" (only when an update is `ready`), Trash (count), Settings. Views `today | timetable | outstanding | subjects | trash | settings` (localStorage, default `timetable`; old `data` → `settings`).
- Subject focus (`focusId` in App, not persisted, cleared on semester switch; resolved `focus` subject, so a deleted subject ends it): click focuses / unfocuses; other rows fade; Timetable `.dimmed` other subjects' cards; Outstanding/Today list only that subject (streak stays global); Subjects dims other cards; `FocusPill` in headers clears it. Focusing from Trash/Settings switches to the timetable.
- **Search** (`SearchPalette`, opened by Ctrl+K / Ctrl+F / the sidebar button, never on top of another `.modal`): loads `listSubjects` + `subjectOverview` + `listBreaks` of the semester; entries = views (+ "Breaks & holidays"), subjects, exercises/tasks (also by description, steps, dates), lectures, exams, breaks. Ranking in `search.ts`: every query word must match; title start > title word start > title substring > extra word start > extra substring; numbers match whole numbers only, ignoring leading zeros; ties by `order` (days from today, settled/past last). Empty query = views + subjects. Results grouped by kind in order of best hit. Enter opens (dialog, view, or focuses a subject); Shift+Enter = `targetWeek` in the timetable. Esc closes.

### Date picker (`components/DatePicker.tsx`)

- `DateField` (form field; optional × via `onClear`) and `DatePopover` (custom trigger). Options: `min`/`max`, `marks` (`planned` accent / `deadline` danger dots + legend), `range` (tinted days), `weeks` (whole-week selection).
- Popup portaled into `<body>` (`position: fixed`, flips above), closes on outside mousedown, blur/resize, Tab out, Esc. All keydowns stop at the popup (Esc doesn't close the dialog, ← → don't switch weeks). `opacity: 0` (not `visibility: hidden`) until positioned so the grid can take focus.
- Days view: one virtualized, freely scrollable list of weeks (±`SPAN_WEEKS` ≈ 10 years; rows at `r × ROW_PX` in `.dp-track`, visible ± `OVERSCAN` rendered, `VISIBLE_WEEKS` rows). All scrolling via `animateTo`, always resting on a whole row (no CSS scroll-snap). Non-passive wheel: one week per notch (|delta| ≥ 50), trackpad deltas accumulate per `ROW_PX`; `pending` = target of a running scroll so repeated input continues from it.
- Active month = month with most of the 42 visible days (earlier on tie); opens with the value's month on top; ↑/↓, PageUp/PageDown scroll exactly one month (`stepMonth`/`showMonth`). "Today"/"This week" only scrolls there. Keys: arrows day/week, PageUp/Down month (Shift: year), Home/End, Enter/Space select (Space on key-up), ↓ opens a closed field.
- The exercise dialog marks other planned days + the deadline in planned-day pickers, and planned days in the deadline picker.

### Timetable (`TimetableView`)

- Default hours 07:00–21:00, widened to fit lectures; `HOUR_PX = 64`. Day widths via `--days`: 1, 1.6 (two lectures side by side), 2.2 (three+), 0.7 for empty days. Weekend `--weekend` tint; today marked only in the header; days outside the semester hatched.
- Header: week nav · title (+ break names) · WeekPicker + date jump · FocusPill · counters ("x/y lectures", "x/y exercises" = sessions) · + Lecture · + Exercise.
- Structure: one vertical `.tt-scroll` per week with a sticky block (day headers + "To do" + "Due" rows; equal `min-height: 44px` cells) so columns align; `overflow-anchor: none`. Legend = `Info` button in the top-left corner cell.
- **Breaks**: break days get `.break` (teal hatch in the grid) and a `.day-break` pill (palm + name) on its own line in the day header. Right-click a day header (`dayMenu`): "Add a break or holiday…" (prefilled with that day), or "Edit "<name>"…" / "Remove break", plus "All breaks & holidays…".
- Initial scroll per week (`bestTopMinute`, `timetableScroll.ts`): once that week's data is loaded (once per semester+week): most lectures fully visible, then most lecture minutes, then closest to 07:45. Refreshes don't re-scroll.
- No flash on week change: render from `shownWeek = data?.weekStart ?? weekStart` (keep the previous week until the new one loads); navigation steps from `weekStart`.
- Week data: `useWeekData` loads the week + both neighbours into a cache (`WEEK_CACHE` = 12); unchanged weeks (JSON compare) keep their object.
- **Swipe** (`swipe.ts` pure rules, tested): `.tt-track` with three `.tt-pane`s (prev/current/next, `contain: strict`, side panes `inert`), moved only with `translate3d` via `placeStrip` (scrolling it repainted every frame). Input: `.tt-carousel` scrolls natively over invisible `.tt-swipe-room`; its scroll deltas drive the strip 1:1 and `scrollend` is the only reliable "fingers lifted" signal (don't go back to wheel handlers with timeouts or momentum/speed heuristics — they misfired). Re-centred at every scrollend. `startSwipe`: `bounds = swipeWindow(pos, pendingAtStart)` (one week boundary beyond the start). `release()` → `landingWeek` (flick ≥ `FLICK_SPEED` 0.8 px/ms → next boundary in its direction; else the week shown more than `SWITCH_FRACTION` ¼ wins; resting ≥ 100 ms = no flick) → `withPending` (a swipe during a glide adds a week; reversed cancels) → `glide` (ease-out, `glideMs` 100–240 ms). `place()` lands on every week passed (`flushSync(setWeekStart)`); unloaded weeks are waited on. Side panes show the same time (`alignPanes`, `topMinute`/`scrollToMinute`, `data-first-hour`); swiped-to weeks keep it. Weeks picked by buttons/keys/picker slide in (`el.animate`, 220 ms; not with reduced motion). Test with CDP touch events (`Input.dispatchTouchEvent`), not synthetic wheel events.
- **Lecture cards**: top-aligned, check top right, wrap, hover expands; past uncompleted = `.missed` (amber outline). Click toggles completion; right-click menu.
- **Planned cards** ("To do"): show/cycle their own session's status (`progress.setSession`); right-click: multi-session → "This session · <day>" (three statuses) + "Whole exercise/task" (four stages), else the stages; checklist → `ChecklistProgress` button opening `ChecklistPopover` (portaled, ticks save at once, "Edit steps…"). Without a deadline: "No deadline" / "Overdue · was planned …".
- **Deadline cards** ("Due"): flag toggles handed in (`.handed-in`); done but not handed in = `.ready`. Ticking a planned card never hands in. Exams first in the row (`.ex-chip.exam`, click/Enter opens `ExamDialog`, right-click Edit/Delete) and count for day width.
- **Drag & drop**: `dragging = { e, from, kind: 'planned' | 'deadline' }`; planned → `moveExercise`, deadline → `updateExercise` (scope `this`, Undo toast). `canDrop`: planned day ≤ deadline, deadline ≥ last planned day; refused cells show `.drop-note`. Cross-week: `.tt-edge` strips (`pointer-events: none`) switch the week every `EDGE_DWELL_MS` while held (document `dragover` sets `edge`; nothing if no dragover for 500 ms); after a switch the dragged card's `dragend` never arrives, so the first `mousemove`/`mousedown` clears the drag; drop uses `from` of the original week.
- `WeekPicker`: custom listbox with `StatusIcon` per week (`weekStatus`; none for empty weeks) and break names; swallows ↑ ↓ Enter Esc while open. Date jump = `DatePopover` in `weeks` mode.
- Keys: ← → weeks, T today (ignored in inputs and while a `.modal` is open).

### Dialogs

- `ui.dialog()` stacks modals; Esc closes only the topmost `Modal` (module-level `openModals` stack).
- `LectureDialog` (needs `semester`): subject, title, day, times, "First lecture" / "Last lecture" (`DateField`s limited to the semester, default its start/end; hint counts occurrences via `weekdayCount`).
- `SemesterDialog`: name, dates; when editing, a "Breaks & holidays" row with chips + "Add…/Manage…" → `BreaksDialog` (list with edit/delete, add/edit form; every change saved at once, delete with Undo via `actions.deleteBreak`; `date` prefills, `editId` opens one).
- `ExerciseDialog`, `ExamDialog`, `SubjectDialog` (personal subject: rename/recolour only).

### Celebrations & sound

- Week progress = lecture occurrences + exercise sessions in the week (`weekProgress`; also header counters and week picker); an exercise planned twice counts twice; only-due exercises don't count.
- Kinds: `lectures` / `exercises` when that category just became complete; `everything` when nothing in the week is left. An empty category never triggers by itself.
- Completion actions go through `useWeekCompletion(semesterId)(weeks, change)` (snapshots weeks via `getWeek` before/after, so deleting unfinished items never celebrates; pass `[]` when un-completing). Lecture → its `weekStart`; session → `startOfWeek(date)`; whole exercise → `exerciseWeeks(plannedDates)`. Exercise changes go through `useExerciseProgress(semesterId)` (`setStatus`, `setSession` with "Session i of n …" toast + Undo, `setHandedIn` + Undo, `setStage`, `settle` = hand in or, without a deadline, done). `useChecklistToggle()`: ticking the last step finishes the exercise (ding + toast + Undo). Exercise-dialog status changes don't celebrate.
- `ui.celebrate(kind, weekStart)` shows `Celebration` for `CELEBRATION_MS` (no confetti with reduced motion). Sound: `playDing()` (E6) whenever `useWeekCompletion` gets weeks; `playCelebration(kind)` (C–E–G, + C7 for `everything`) after it. Mute switch in Settings (localStorage `sound`; enabling plays a preview).

### Today view

- One call `getToday(semesterId, today)`: today's lectures, next 7 days' lectures (`upcomingLectures`), exercises planned today, unsettled ones due within 7 days (`dueSoon`) or overdue, missed past lectures, exams from today, `todayBreak`, streak. Reloads on date change (`useNow`, 30 s).
- Stat row: streak · done today · overdue + missed (opens Outstanding) · days until next exam ("Today" + name on the day). Left: Up next (running lecture with progress, next today with "Starts in …", else first upcoming), Today's schedule (exams + lectures; on a break "<name> until …: no lectures."), To do today (today's session circle, inline checklist). Right: Overdue (or "Catch up" with only missed lectures; check = `settle`), Due in the next 7 days (stage circle), Exams (tiles + `ExamCountdown`).
- Streak (`computeStreak`): consecutive days up to today on which every lecture occurrence and every planned session was completed; empty days skipped; today counts once complete and never breaks the streak while open. Also `best` and `today` (`done | open | empty`). Derived from current state.

### Outstanding & Subjects views

- Outstanding: every unsettled exercise (incl. done but not handed in) and every past/today uncompleted lecture occurrence, by date; tasks tagged "Task", multi-session ones "(k of n sessions done)"; select with four stages; handing in removes the row (Undo). "Open exercises" stat = unsettled ones planned today or earlier or due within 7 days.
- Subjects: cards with exams first (`ExamRow`, `ExamCountdown`: accent, amber ≤ 7 days, red on the day, muted past), lectures (own dates as a line under the title when set), exercises (series rows expand to occurrences, collapsed by default; standalone below; rows open `ExerciseDialog`). Personal-subject card last (titled with its name) (Tasks section only). Empty state while there are no real subjects.

## Demo data

- `npm run seed-demo -- <empty folder> [--today=…]` (`scripts/seed-demo.mjs` bundles `src/main/demoData.ts` with esbuild, runs it through `StudyService`; refuses `%APPDATA%\StudyPlanner(-dev)` and folders with a DB).
- Content: "Autumn Semester 2026" (14 Sep – 18 Dec), Chemistry / Computer Science / Mathematics / Physics; 13 lectures (12 all semester + "Exam Revision" Fri from 20 Nov); "Autumn break" 26–30 Oct (week 7); series (Problem Set, Linear Algebra Sheet, Coding Assignment, Lab Report every 2 weeks, Mechanics Problems, Worksheet every 2 weeks) + standalone exercises (essay, quiz, project proposal, midterm prep, presentation, three "Reading:" without a deadline); three personal tasks; checklists on Lab Report, the essay, the project proposal; 5 exams.
- Completion follows `today`: past lectures done (skipping out-of-range and break days) except `MISSED_LECTURES`; exercises due before today handed in, no-deadline ones with past planned days done, except `OVERDUE_EXERCISES`; `DONE_NOT_HANDED_IN` (essay) done, not handed in; started ones: first half of steps ticked, past sessions done, later ones not started, the last stays in progress when all are past. Tested in `tests/demo-data.test.ts`; keep in sync.

## Screenshots (`docs/screenshots/*.png`, shown in the README)

1440×900, demo data seeded with `--today=2026-09-29`, renderer clock at 29 Sep 2026 10:40 (before reload, `Page.addScriptToEvaluateOnNewDocument` replaces `window.Date` with a subclass shifted by a fixed offset). Shots: `today`, `timetable` (week 2), `exercise-dialog` (new recurring Physics "Lab Report" planned Thu 17 + 24 Sep, three steps, every 2 weeks, deadline picker open), `outstanding`, `subject-focus` (Mathematics), `subjects` ("Problem Set" expanded), `week-complete` (week 2's open sessions completed via `window.studyApi.call('setSessionStatus', …)`, then its last open lecture clicked, captured ~1 s later). Retake when the UI changes visibly: launch with `STUDY_PLANNER_DATA_DIR=<folder>` and `--remote-debugging-port`, `Emulation.setDeviceMetricsOverride`, `Page.captureScreenshot`, all in ONE CDP session (the override resizes the window on connect/disconnect, closing popups). Fill fields with the native value setter + `input`/`change`; a `DateField` via the `onChange` prop found by walking its React fiber (`__reactFiber$…` on `.date-field-wrap`).

## Tests (`npm test`)

`tests/service.test.ts` (against a real temp SQLite file: business rules, lecture dates, breaks, exams, checklists, handing in, deadlines, sessions, personal tasks, Today + streak, subject overview, trash, persistence, every migration), `timetable-scroll`, `swipe`, `dates` (month helpers, countdown), `search` (ranking), `release-notes` (changelog extraction, Markdown subset, in-app filtering), `window-state`, `demo-data`.
