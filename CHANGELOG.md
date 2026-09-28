# Changelog

Versions follow [semantic versioning](https://semver.org): **major** for changes you have to act on yourself or that remove features, **minor** for new features and visible UI changes (including automatic database migrations), **patch** for bug fixes and small tweaks.

## Unreleased
- README: all screenshots retaken with the new sidebar and date picker, plus a new one of the subject focus (`docs/screenshots/subject-focus.png`); features list mentions subject focus and the check-off sound.
- Development: `npm run seed-demo -- <empty folder>` fills a test data folder with a realistic demo semester (4 subjects, 12 weekly lectures, recurring and one-off exercises, completion matching the current date, a few missed and overdue items). Refuses the real data folders and folders that already contain a database.

## 1.4.0 — 2026-09-28
- Subjects: every exercise is now listed on its subject card and opens the exercise editor when clicked. Click an exercise series to expand it and see its occurrences; standalone exercises are listed directly below the series. Each row shows the exercise's status and deadline.
- New date picker in the app's own style, replacing the standard Windows one everywhere: semester start/end, the exercise's planned days and deadline, and the timetable's "Go to date" button. Dates read like "Fri 2 Oct 2026". The calendar scrolls freely, one week per mouse-wheel notch (the month title follows along and the 1st of each month is labelled); the ↑ ↓ buttons glide exactly one month, with the week of the 1st at the top, and clicking the month title jumps to any month or year; days you can't pick (e.g. after the deadline) are greyed out; "Today" / "This week" scrolls back to today without closing the calendar. In the exercise editor the calendar shows the other planned days (blue dots) and the deadline (red dot). The timetable's calendar highlights the week you're looking at and tints the semester's days. Keyboard: arrow keys, Page Up/Down for months, Enter to pick, Esc to close.
- Small icon buttons (arrows, edit/delete pencils, close crosses) now have their icon exactly centred.
- A soft "ding" plays whenever you check off a lecture or exercise (timetable and Outstanding list); finishing all lectures, all exercises or the whole week adds a short rising chime to the celebration. Turn it off in Settings.
- Redesigned sidebar: **Planning** (Timetable, Outstanding), **Subjects** (your subjects, then "Manage subjects"), and Trash and Settings at the bottom. "Data & backups" moved into the new **Settings** page, next to the sound switch.
- Click a subject in the sidebar to focus on it: the timetable greys out everything from other subjects, the Outstanding list shows only that subject, and "Manage subjects" fades the other cards. Click it again, or the × on the subject pill in the page header, to show everything (switching semesters also shows everything again).
- The timetable legend (lecture, completed, missed, to do, deadline) is now behind the ⓘ button in the timetable's top-left corner.

## 1.3.1 — 2026-09-28
- Timetable: when you switch weeks, it scrolls so that as many lectures as possible are fully visible, instead of always starting at 08:00. If everything fits from 08:00 on, it still starts there, so similar weeks keep the same position. Checking off a lecture no longer moves the view.

## 1.3.0 — 2026-09-28
- Celebrations: completing the last lecture of a week shows "All lectures done" with a burst of confetti, completing the last exercise planned in a week shows "All exercises done", and when nothing in the week is left the whole week gets a bigger "Week complete!" confetti shower. A week without exercises (or without lectures) counts as complete as soon as the other part is done. Works from the timetable (clicks and right-click menus) and the Outstanding list; the overlay disappears after a few seconds and never blocks clicks. With reduced motion enabled in Windows, only the message is shown.
- The timetable header's lecture/exercise counters and the celebrations share one definition: exercises count toward the weeks they are planned in.
- Week dropdown in the timetable header: each week shows whether it is completed, in progress or not started (hover for the numbers). It opens with the mouse or the keyboard (↑ ↓ Enter, Esc to close).
- The calendar button next to it is now a regular button: the icon is centred and clicking anywhere on the button opens the date picker.
- Fix: after switching weeks, the timetable could open scrolled too far down, hiding early lectures under the header rows.
- README: all screenshots retaken with the current version, plus a new one of the "Week complete!" celebration (`docs/screenshots/week-complete.png`).

## 1.2.1 — 2026-09-28
- Timetable: clicking the flag on a deadline card checks the exercise off (with Undo); clicking the check mark again reopens it as "In progress". Clicking elsewhere on the card still opens the editor.
- Licensed under MIT (`LICENSE`).
- README rewritten as a GitHub landing page with screenshots (`docs/screenshots/`); technical details live in CLAUDE.md.
- `.gitignore` extended (local env files, personal Claude settings, editor/OS files, stray database backups).
- Claude docs hook: also checks that `CHANGELOG.md` has an entry for the current version (and no longer treats a version bump as outdated docs).

## 1.2.0 — 2026-09-27
- Exercises can be planned on several days. In the exercise dialog, add or remove days, or use "Every <weekday> until the deadline". For recurring exercises the pattern repeats in every occurrence (e.g. due every second Friday, planned every Thursday).
- The timetable shows the exercise on each planned day ("Session 1 of 2"). Dragging a card moves only that session; dropping it on a day that is already planned combines the two.
- Series edits apply a changed planned-days pattern to each affected occurrence at the same place in its cycle.
- The Outstanding list shows all planned days of an exercise.
- Database schema v2 (new table `exercise_plan_dates`). Existing exercises keep their planned date; a backup is made automatically before the upgrade. After updating, older app versions can no longer open the database.

## 1.1.1 — 2026-09-27
- Outstanding: the "open exercises" count only includes exercises planned for today or earlier, or due within the next 7 days. The list itself still shows every uncompleted exercise.
- Build: `npm run dist` removes installers of older versions from `release/` after a successful build.

## 1.1.0 — 2026-09-27
- Dark theme throughout, including the window title bar and dropdowns.
- Exercise and deadline cards in the timetable show the subject name.
- Long titles wrap instead of being cut off. Days with lectures side by side get extra width, and hovering a lecture shows all its text.
- Lecture cards are top-aligned, with the completion check mark in the top-right corner.
- Day columns line up exactly between the header, the exercise rows and the lecture grid; the header stays pinned while scrolling.
- Saturday and Sunday share a weekend tint. Today is marked in the header instead of tinting the whole column.
- Removed the "Not completed" label from lectures.
- The timetable shows the hours up to 20:00 (grid runs until 21:00) by default.

## 1.0.0 — 2026-09-27
- First release: semesters, subjects, weekly lectures with per-week completion, exercises with planned dates and deadlines, recurring exercise series with per-occurrence edits, outstanding list, trash, local SQLite database with migrations and automatic backups.
