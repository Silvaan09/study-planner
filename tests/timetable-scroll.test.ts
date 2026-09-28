import { describe, expect, it } from 'vitest';
import { bestTopMinute, type Span } from '../src/renderer/timetableScroll';

const h = (hh: number, mm = 0) => hh * 60 + mm;
const lec = (from: [number, number], to: [number, number]): Span => ({ start: h(...from), end: h(...to) });
// Grid 07:00–21:00, 8 hours visible, prefers 07:45, 15 min padding.
const W = { gridStart: h(7), gridEnd: h(21), visible: 8 * 60, preferred: h(7, 45), pad: 15 };

describe('timetable scroll position', () => {
  it('stays at the preferred position when every lecture fits there', () => {
    expect(bestTopMinute([lec([8, 15], [10, 0]), lec([13, 15], [15, 0])], W)).toBe(h(7, 45));
    expect(bestTopMinute([], W)).toBe(h(7, 45));
  });

  it('moves just far enough to show all lectures when they fit in the window', () => {
    // 10:15–17:00 doesn't fit from 07:45 (ends 15:45), but does from 09:15 (ends 17:15).
    expect(bestTopMinute([lec([10, 15], [12, 0]), lec([16, 15], [17, 0])], W)).toBe(h(9, 15));
  });

  it('shows as many lectures as possible when not all fit', () => {
    const week = [
      lec([8, 15], [10, 0]),
      lec([10, 15], [12, 0]),
      lec([13, 15], [15, 0]),
      lec([14, 15], [16, 0]),
      lec([13, 15], [17, 0]),
      lec([16, 15], [17, 0]),
    ];
    // From 09:15 (bottom 17:15) five of six are fully visible; from 07:45 only three.
    expect(bestTopMinute(week, W)).toBe(h(9, 15));
  });

  it('stays inside the grid', () => {
    expect(bestTopMinute([lec([7, 0], [8, 0])], W)).toBe(h(7));
    expect(bestTopMinute([lec([19, 0], [21, 0])], W)).toBe(h(13));
  });
});
