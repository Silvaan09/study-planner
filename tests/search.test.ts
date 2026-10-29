import { describe, expect, it } from 'vitest';
import { groupResults, search, type SearchEntry } from '../src/renderer/search';

const entry = (kind: SearchEntry['kind'], title: string, extra: string[] = [], order?: number): SearchEntry<string> => ({
  kind,
  key: `${kind}:${title}`,
  title,
  extra,
  order,
  item: title,
});

const entries = [
  entry('view', 'Today'),
  entry('view', 'Timetable'),
  entry('subject', 'Mathematics'),
  entry('subject', 'Physics'),
  entry('exercise', 'Problem Set 03', ['Mathematics', 'due Fri 2 Oct'], 3),
  entry('exercise', 'Problem Set 01', ['Mathematics', 'due Fri 18 Sep'], -11),
  entry('exercise', 'Lab Report 02', ['Physics', 'Measure the pendulum period'], 5),
  entry('lecture', 'Linear Algebra', ['Mathematics', 'Mon 10:00–12:00']),
  entry('exam', 'Midterm', ['Physics', 'Room HG E 7']),
  entry('exercise', 'Résumé for the job fair', ['Personal']),
];
const titles = (q: string) => search(entries, q).map((e) => e.title);

describe('search', () => {
  it('shows the views and subjects for an empty query', () => {
    expect(titles('  ')).toEqual(['Today', 'Timetable', 'Mathematics', 'Physics']);
  });

  it('needs every word to match somewhere', () => {
    expect(titles('lab pendulum')).toEqual(['Lab Report 02']);
    expect(titles('lab chemistry')).toEqual([]);
  });

  it('ranks title starts above word starts above other fields', () => {
    // "Mathematics" (title) before the items that only mention it.
    expect(titles('math')[0]).toBe('Mathematics');
    expect(titles('math')).toContain('Linear Algebra');
    // A title starting with the word beats one that only contains a word starting with it.
    expect(titles('set')).toEqual(['Problem Set 01', 'Problem Set 03']);
  });

  it('breaks ties by order (e.g. how far away)', () => {
    expect(titles('problem')).toEqual(['Problem Set 01', 'Problem Set 03']);
  });

  it('ignores case, accents and leading zeros', () => {
    expect(titles('resume')).toEqual(['Résumé for the job fair']);
    expect(titles('set 3')).toEqual(['Problem Set 03']);
    // Numbers match whole numbers only, not digits inside dates or times.
    expect(titles('3')).toEqual(['Problem Set 03']);
    expect(titles('1')).toEqual(['Problem Set 01']);
    expect(titles('lab 2')).toEqual(['Lab Report 02']);
    expect(titles('HG e')).toEqual(['Midterm']);
  });

  it('groups results by kind in the order of their best hit', () => {
    const groups = groupResults(search(entries, 'physics'));
    expect(groups.map((g) => g.kind)).toEqual(['subject', 'exam', 'exercise']);
    expect(groups[2].entries.map((e) => e.title)).toEqual(['Lab Report 02']);
  });
});
