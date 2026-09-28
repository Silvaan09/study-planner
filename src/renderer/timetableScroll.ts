/** A lecture's time span in minutes since midnight. */
export interface Span {
  start: number;
  end: number;
}

export interface ScrollWindow {
  /** First and last minute of the time grid. */
  gridStart: number;
  gridEnd: number;
  /** How many minutes fit below the sticky header rows. */
  visible: number;
  /** Where the view starts when that's as good as anything else (keeps similar weeks at the same position). */
  preferred: number;
  /** Breathing room kept above/below a lecture that sits at the edge of the view. */
  pad: number;
}

/**
 * The minute of the day to show at the top of the timetable: the position where the most lectures are
 * fully visible, then the most lecture time is visible, then the one closest to `preferred`.
 */
export function bestTopMinute(lectures: Span[], w: ScrollWindow): number {
  const maxTop = Math.max(w.gridStart, w.gridEnd - w.visible);
  const clamp = (t: number) => Math.min(maxTop, Math.max(w.gridStart, t));
  // The best window always either stays at the preferred position or has a lecture at its top or bottom edge.
  const candidates = [w.preferred, ...lectures.flatMap((l) => [l.start - w.pad, l.end + w.pad - w.visible])].map(clamp);
  const score = (top: number) => {
    const bottom = top + w.visible;
    let full = 0;
    let minutes = 0;
    for (const l of lectures) {
      if (l.start >= top && l.end <= bottom) full++;
      minutes += Math.max(0, Math.min(l.end, bottom) - Math.max(l.start, top));
    }
    return [full, minutes, -Math.abs(top - w.preferred)];
  };
  let best = candidates[0];
  let bestScore = score(best);
  for (const top of candidates.slice(1)) {
    const s = score(top);
    const i = s.findIndex((v, k) => v !== bestScore[k]);
    if (i !== -1 && s[i] > bestScore[i]) {
      best = top;
      bestScore = s;
    }
  }
  return best;
}
