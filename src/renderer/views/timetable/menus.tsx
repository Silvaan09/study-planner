import { api } from '../../api';
import type { useUi } from '../../ui';
import type { useActions, useExerciseProgress } from '../../actions';
import { formatDate, type ISODate } from '../../../shared/dates';
import {
  breakOn,
  breakTitle,
  EXERCISE_STAGE_LABEL,
  EXERCISE_STATUS_LABEL,
  EXERCISE_STATUSES,
  exerciseStage,
  exerciseStages,
  sessionStatus,
  type Exam,
  type Exercise,
  type LectureOccurrence,
  type Semester,
  type Subject,
  type WeekData,
} from '../../../shared/types';
import { BreaksDialog, LectureDialog } from '../../dialogs';
import type { MenuEntry, MenuState } from '../../components/ContextMenu';
import { Calendar, Check, Palm, Pencil, StatusIcon, Trash } from '../../components/Icons';

/** The timetable's right-click menus: lecture cards, exercise cards, exams and day headers. */
export function timetableMenus({
  setMenu,
  ui,
  actions,
  progress,
  semester,
  subjects,
  isTask,
  toggleLecture,
  openExercise,
  openExam,
}: {
  setMenu: (menu: MenuState | null) => void;
  ui: ReturnType<typeof useUi>;
  actions: ReturnType<typeof useActions>;
  progress: ReturnType<typeof useExerciseProgress>;
  semester: Semester;
  subjects: Subject[];
  isTask: (e: Exercise) => boolean;
  toggleLecture: (o: LectureOccurrence) => unknown;
  openExercise: (id: number) => unknown;
  openExam: (id: number) => unknown;
}) {
  const lectureMenu = (ev: React.MouseEvent, o: LectureOccurrence) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { label: o.completed ? 'Mark as not completed' : 'Mark as completed', icon: <Check size={14} />, onSelect: () => toggleLecture(o) },
        {
          label: 'Edit lecture…',
          icon: <Pencil size={14} />,
          onSelect: () => ui.dialog((close) => <LectureDialog semester={semester} subjects={subjects} lectureId={o.lectureId} weekStart={o.weekStart} close={close} />),
        },
        'separator',
        {
          label: 'Delete…',
          icon: <Trash size={14} />,
          danger: true,
          onSelect: async () => actions.deleteLecture(await api.getLecture(o.lectureId), o.weekStart),
        },
      ],
    });
  };

  /** On a planned card of an exercise with several sessions (`day`), the menu sets that session or the whole exercise. */
  const exerciseMenu = (ev: React.MouseEvent, e: Exercise, day?: ISODate) => {
    ev.preventDefault();
    ev.stopPropagation();
    const session: MenuEntry[] =
      day && e.plannedDates.length > 1
        ? [
            { heading: `This session · ${formatDate(day, { weekday: true })}` },
            ...EXERCISE_STATUSES.map((s) => ({
              label: EXERCISE_STATUS_LABEL[s],
              icon: <StatusIcon status={s} size={14} />,
              disabled: sessionStatus(e, day) === s,
              onSelect: () => void progress.setSession(e, day, s),
            })),
            'separator',
            { heading: isTask(e) ? 'Whole task' : 'Whole exercise' },
          ]
        : [];
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        ...session,
        ...exerciseStages(e).map((s) => ({
          label: EXERCISE_STAGE_LABEL[s],
          icon: <StatusIcon status={s} size={14} />,
          disabled: exerciseStage(e) === s,
          onSelect: () => void progress.setStage(e, s),
        })),
        'separator' as const,
        { label: 'Edit…', icon: <Pencil size={14} />, onSelect: () => openExercise(e.id) },
        { label: 'Delete…', icon: <Trash size={14} />, danger: true, onSelect: () => actions.deleteExercise(e) },
      ],
    });
  };

  const examMenu = (ev: React.MouseEvent, x: Exam) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { label: 'Edit exam…', icon: <Pencil size={14} />, onSelect: () => openExam(x.id) },
        { label: 'Delete…', icon: <Trash size={14} />, danger: true, onSelect: () => actions.deleteExam(x) },
      ],
    });
  };

  /** Right-click on a day header: add a break or holiday from that day, or edit / remove the one it is in. */
  const dayMenu = (ev: React.MouseEvent, day: ISODate, week: WeekData | undefined) => {
    ev.preventDefault();
    const b = breakOn(week?.breaks ?? [], day);
    const breaksDialog = (opts: { date?: ISODate; editId?: number }) =>
      ui.dialog((close) => <BreaksDialog semester={semester} {...opts} close={close} />);
    setMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { heading: formatDate(day, { weekday: true }) },
        ...(b
          ? [
              { label: `Edit "${breakTitle(b)}"…`, icon: <Pencil size={14} />, onSelect: () => breaksDialog({ editId: b.id }) },
              { label: 'Remove break', icon: <Trash size={14} />, danger: true, onSelect: () => actions.deleteBreak(b) },
            ]
          : [{ label: 'Add a break or holiday…', icon: <Palm size={14} />, onSelect: () => breaksDialog({ date: day }) }]),
        'separator' as const,
        { label: 'All breaks & holidays…', icon: <Calendar size={14} />, onSelect: () => breaksDialog({}) },
      ],
    });
  };

  return { lectureMenu, exerciseMenu, examMenu, dayMenu };
}
