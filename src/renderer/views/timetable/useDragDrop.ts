import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { api } from '../../api';
import type { useUi } from '../../ui';
import { addDays, formatDate, type ISODate } from '../../../shared/dates';
import { deadlineOnly, type Exercise } from '../../../shared/types';

/** Width of the right-hand edge zone that switches to the next week while dragging. */
const EDGE_PX = 32;
/** How long a dragged card has to stay at an edge before the week switches (and again for each further week). */
const EDGE_DWELL_MS = 700;

/** The exercise being dragged: one of its planned dates (a "To do" card) or its deadline (a "Due" card). */
export type Dragging = { e: Exercise; from: ISODate; kind: 'planned' | 'deadline' };

/** Drag & drop of planned days and deadlines between days, and across weeks by holding a card at an edge. */
export function useDragDrop({
  ui,
  weekStart,
  setWeekStart,
  scrollRef,
}: {
  ui: ReturnType<typeof useUi>;
  weekStart: ISODate;
  setWeekStart: (w: ISODate) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [dropDay, setDropDay] = useState<ISODate | null>(null);

  /** Planned days can't go after the deadline, and the deadline can't go before the last planned day. */
  const canDrop = (day: ISODate) => {
    if (!dragging) return false;
    const { e, kind } = dragging;
    if (kind === 'planned') return e.deadlineDate === null || day <= e.deadlineDate;
    return deadlineOnly(e) || day >= e.plannedDates[e.plannedDates.length - 1];
  };
  const dropProps = (day: ISODate) => ({
    onDragOver: (ev: DragEvent) => {
      if (!dragging) return;
      if (canDrop(day)) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
      }
      if (dropDay !== day) setDropDay(day);
    },
    onDragLeave: (ev: DragEvent) => {
      if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) setDropDay((d) => (d === day ? null : d));
    },
    onDrop: (ev: DragEvent) => {
      ev.preventDefault();
      const drag = dragging;
      setDragging(null);
      setDropDay(null);
      if (!drag || drag.from === day) return;
      const ex = drag.e;
      if (drag.kind === 'deadline') {
        const last = ex.plannedDates[ex.plannedDates.length - 1];
        if (last !== undefined && day < last) {
          ui.toast(`"${ex.title}" is planned for ${formatDate(last, { weekday: true })} — the deadline can't be before that.`, { kind: 'error' });
          return;
        }
        const setDeadline = (d: ISODate) => api.updateExercise({ id: ex.id, scope: 'this', changes: { deadlineDate: d } });
        void ui.run(async () => {
          await setDeadline(day);
          ui.toast(`Moved the deadline of "${ex.title}" to ${formatDate(day, { weekday: true })}`, {
            kind: 'success',
            action: { label: 'Undo', run: () => void ui.run(() => setDeadline(drag.from)) },
          });
        });
        return;
      }
      if (ex.deadlineDate !== null && day > ex.deadlineDate) {
        ui.toast(`"${ex.title}" is due ${formatDate(ex.deadlineDate, { weekday: true })} — it can't be planned after its deadline.`, { kind: 'error' });
        return;
      }
      const merged = ex.plannedDates.includes(day);
      void ui.run(async () => {
        await api.moveExercise(ex.id, drag.from, day);
        if (merged) {
          ui.toast(`"${ex.title}" was already planned for ${formatDate(day, { weekday: true })} — the two sessions were combined`, { kind: 'success' });
        } else {
          ui.toast(`Planned "${ex.title}" for ${formatDate(day, { weekday: true })}`, {
            kind: 'success',
            action: { label: 'Undo', run: () => void ui.run(() => api.moveExercise(ex.id, day, drag.from)) },
          });
        }
      });
    },
  });

  // Holding a dragged card at the left or right edge (left of the day columns / the last EDGE_PX of the
  // timetable) switches to the previous / next week every EDGE_DWELL_MS, so a session can move across weeks.
  const timetableRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<-1 | 0 | 1>(0);
  const [flips, setFlips] = useState(0);
  const weekRef = useRef(weekStart);
  weekRef.current = weekStart;
  const lastOver = useRef(0);
  useEffect(() => {
    if (!dragging) {
      setEdge(0);
      return;
    }
    const onOver = (ev: globalThis.DragEvent) => {
      const box = timetableRef.current?.getBoundingClientRect();
      const firstDay = scrollRef.current?.querySelector('.tt-day-head')?.getBoundingClientRect();
      if (!box || !firstDay) return;
      lastOver.current = performance.now();
      setEdge(ev.clientX < firstDay.left ? -1 : ev.clientX > box.right - EDGE_PX ? 1 : 0);
    };
    // Leaving the window: dragover stops, so don't keep flipping.
    const onLeave = (ev: globalThis.DragEvent) => {
      if (!ev.relatedTarget) setEdge(0);
    };
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    return () => {
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
    };
  }, [dragging]);
  useEffect(() => {
    if (edge === 0) return;
    const timer = window.setInterval(() => {
      if (performance.now() - lastOver.current > 500) return setEdge(0);
      setWeekStart(addDays(weekRef.current, 7 * edge));
      setDropDay(null);
      setFlips((n) => n + 1);
    }, EDGE_DWELL_MS);
    return () => window.clearInterval(timer);
  }, [edge, setWeekStart]);
  // Once the week has changed, the dragged card is no longer in the page, so its dragend never arrives.
  // No mouse events fire during a drag, so the first mouse move afterwards means the drag is over.
  useEffect(() => {
    if (!dragging || flips === 0) return;
    const end = () => {
      setDragging(null);
      setDropDay(null);
    };
    window.addEventListener('mousemove', end, { once: true });
    window.addEventListener('mousedown', end, { once: true });
    return () => {
      window.removeEventListener('mousemove', end);
      window.removeEventListener('mousedown', end);
    };
  }, [dragging, flips]);
  useEffect(() => {
    if (!dragging) setFlips(0);
  }, [dragging]);

  return { dragging, setDragging, dropDay, setDropDay, canDrop, dropProps, timetableRef, edge, flips };
}
