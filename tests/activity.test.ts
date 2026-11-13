import { describe, expect, it } from 'vitest';
import { activityCell } from '../src/renderer/activity';

const day = (date: string, ...counts: [number, number][]) => ({
  date,
  subjects: counts.map(([done, total], i) => ({ subjectId: i + 1, done, total })),
});
const today = '2026-10-14';

describe('activity grid cells', () => {
  it('fills by the share done, so 1 of 1 is as full as 6 of 6', () => {
    expect(activityCell(day('2026-10-12', [1, 1]), today)).toMatchObject({ level: 4, label: 'All 1 done' });
    expect(activityCell(day('2026-10-12', [4, 4], [2, 2]), today)).toMatchObject({ level: 4, label: 'All 6 done' });
    expect(activityCell(day('2026-10-12', [2, 3]), today).level).toBe(3);
    expect(activityCell(day('2026-10-12', [1, 2]), today).level).toBe(2);
    expect(activityCell(day('2026-10-12', [1, 4]), today).level).toBe(1);
    expect(activityCell(day('2026-10-12', [0, 2], [0, 1]), today)).toMatchObject({ level: 0, label: '0 of 3 done', future: false });
  });

  it('counts a past day or today with nothing planned as complete', () => {
    expect(activityCell(day('2026-10-11'), today)).toMatchObject({ level: 4, label: 'Nothing planned' });
    expect(activityCell(day(today), today).level).toBe(4);
  });

  it('shows today live and later days as outlines until something on them is done', () => {
    expect(activityCell(day(today, [1, 4]), today)).toMatchObject({ level: 1, future: false });
    expect(activityCell(day('2026-10-15', [0, 2]), today)).toMatchObject({ level: 0, future: true, label: '2 planned' });
    expect(activityCell(day('2026-10-15'), today)).toMatchObject({ future: true, label: 'Nothing planned' });
    expect(activityCell(day('2026-10-15', [2, 2]), today)).toMatchObject({ level: 4, future: false });
  });
});
