# Changelog

Versions follow [semantic versioning](https://semver.org): **major** for changes you have to act on yourself or that remove features, **minor** for new features and visible UI changes (including automatic database migrations), **patch** for bug fixes and small tweaks.

## 1.7.0 — 2026-09-30
- Timetable: drag an exercise from the "To do" row and hold it at the left or right edge of the timetable to switch to the previous or next week, then drop it on a day there. Keep holding to go further, one week every 0.7 s. While you drag, the edges show an arrow that fills up until the week switches.
- Timetable: with nothing planned or due, the "To do" and "Due" rows are now the same height.
- Tests: a new test checks that an unfinished today (nothing done yet, or only part of it) keeps your streak, and that only unfinished earlier days break it.

## 1.6.0 — 2026-09-30
- **Done and handed in are now separate.** Ticking off an exercise on a day you planned to work on it (the "To do" row, the Today page's "To do today") only marks the work as **Done**; its deadline card in the "Due" row stays open, turns green and says "Done · ready to hand in". Click the flag on the deadline card when you've actually submitted it: that marks it **Handed in** (with Undo), and clicking the check mark again takes the hand-in back while keeping the work done. Handing in also marks the work done.
- The exercise editor, the right-click menu on exercise cards and the Outstanding list offer four states: Not started, In progress, Done, Handed in. "Completed" is now called "Done".
- Overdue, "Due in the next 7 days" and the Outstanding list go by handing in: an exercise stays there until it's handed in. On the Today page, the circle in "Due in the next 7 days" goes one step further (Done → Handed in), and the check in "Overdue" hands the exercise in. Week progress, celebrations and the streak still go by the work (Done), since they're about the days you planned.
- Manage subjects: handed-in exercises show a flag icon and are struck through; done ones show a check.
- Database schema v4 (new column `exercises.handed_in`). Exercises you had already completed count as handed in, so nothing reappears as outstanding. A backup is made automatically before the upgrade; after updating, older app versions can no longer open the database.
- README: all screenshots retaken (the demo essay is now done but not handed in yet).

## 1.5.0 — 2026-09-29
- New **Today** page (first entry under Planning): your streak, how much of today is done, overdue exercises and missed lectures, and the countdown to your next exam at the top; below it the lecture happening now or coming up next, today's schedule (check lectures off right there), the exercises planned for today (with their checklists), everything due in the next 7 days, and all upcoming exams. Focusing a subject in the sidebar filters it too.
- **Streak**: the number of days in a row on which you completed every lecture and every exercise planned for that day. Days with nothing scheduled are skipped, and today only counts once it's done, so an unfinished today never breaks it.
- **Exams**: every subject card in Manage subjects has an Exams section for midterms, endterms, finals and other exams, with date, optional time and room, notes, and a countdown ("in 5 weeks, 1 day", amber in the last week, red on the day). Exams also appear in the timetable's "Due" row and on the Today page. Deleted exams go to the trash like everything else.
- **Checklists**: split an exercise into steps in the exercise editor (Enter adds the next step). Planned timetable cards show the progress (e.g. 2/5); click it to tick steps without opening the editor. The Today page shows the steps of today's exercises, and ticking a step starts a not-started exercise. When every step is done, a toast offers to mark the exercise completed. In a recurring series every occurrence gets the steps; editing them for "This & following" or the whole series keeps each occurrence's ticks and asks before replacing steps you changed on single occurrences.
- Fix: switching weeks in the timetable no longer flashes an empty grid before the new week appears.
- Database schema v3 (new tables `exams` and `exercise_checklist_items`). Existing data is kept; a backup is made automatically before the upgrade. After updating, older app versions can no longer open the database.
- README: all screenshots retaken, plus new ones of the Today page (`docs/screenshots/today.png`) and the subject focus (`docs/screenshots/subject-focus.png`); the features list mentions the Today page, exams, checklists, subject focus and the check-off sound.
- Development: `npm run seed-demo -- <empty folder>` fills a test data folder with a realistic demo semester (4 subjects, 12 weekly lectures, recurring and one-off exercises, some with checklists, 5 exams, completion matching the current date, a few missed and overdue items). Refuses the real data folders and folders that already contain a database.

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
