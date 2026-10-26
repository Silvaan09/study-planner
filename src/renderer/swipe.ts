// Trackpad swipes between timetable weeks: which week a let-go swipe lands on. Positions are in weeks relative to
// the current week (0 = it, 1 = the next, 0.3 = 30% of the way to the next).

/** Moving at least this fast (px per ms) when let go is a flick: it goes on to the week it's moving towards. */
export const FLICK_SPEED = 0.8;
/** Showing this much of a neighbouring week (fraction of the width) is enough to switch to it. */
export const SWITCH_FRACTION = 1 / 4;

const EPS = 1e-3;
const weekAbove = (pos: number) => Math.ceil(pos - EPS) + 0; // + 0: no -0
const weekBelow = (pos: number) => Math.floor(pos + EPS) + 0;

/**
 * The week a swipe let go at `pos` lands on (`direction`: the sign of how it moved; `velocity`: px per ms when let
 * go, positive = towards later weeks). A flick goes on to the next week boundary in its direction (a flick back goes
 * back to the week it came from); otherwise a week the swipe is moving into wins once more than a quarter of it shows.
 */
export function landingWeek(pos: number, direction: number, velocity: number): number {
  if (Math.abs(velocity) >= FLICK_SPEED) {
    const flick = Math.sign(velocity);
    if (direction !== 0 && flick !== direction) return direction > 0 ? weekBelow(pos) : weekAbove(pos);
    return flick > 0 ? weekAbove(pos) : weekBelow(pos);
  }
  if (direction === 0) return Math.round(pos);
  const from = direction > 0 ? weekBelow(pos) : weekAbove(pos);
  return Math.abs(pos - from) > SWITCH_FRACTION ? from + direction : from;
}

/**
 * Where a swipe lands when it started while the previous one was still gliding to week `pending` (null: it wasn't).
 * Swiping on in the same direction adds a week to that one (two quick flicks = two weeks), a small swipe keeps it,
 * one in the other direction cancels it. `moving`: this swipe on its own would switch weeks (a flick, or moved more
 * than a quarter of a week).
 */
export function withPending(target: number, pending: number | null, direction: number, moving: boolean): number {
  if (pending === null || pending === 0 || Math.sign(pending) !== direction) return target;
  const goal = moving ? pending + direction : pending;
  return direction > 0 ? Math.max(target, goal) : Math.min(target, goal);
}

/**
 * The weeks one swipe may move between: one week boundary beyond where it started in either direction (so the
 * momentum of a fast flick can't carry it on for several), widened to reach one past a pending glide's week.
 */
export function swipeWindow(pos: number, pending: number | null): [number, number] {
  let lo = weekBelow(pos) - 1;
  let hi = weekAbove(pos) + 1;
  if (pending !== null) {
    lo = Math.min(lo, pending - 1);
    hi = Math.max(hi, pending + 1);
  }
  return [lo, hi];
}

/**
 * The speed a swipe is let go with: its last speed, unless the fingers rested before lifting (no movement for
 * `restingMs` ≥ 100 ms; lifting right after moving takes less), which is no flick at all.
 */
export function velocityAtRelease(velocity: number, restingMs: number): number {
  return restingMs >= 100 ? 0 : velocity;
}

/**
 * The speed (px per ms) of a scroll by `delta` px that took `dt` ms. Speeds, not raw deltas, because a dropped frame
 * makes the next delta twice as big without anything speeding up.
 */
export function swipeSpeed(delta: number, dt: number): number {
  return delta / Math.min(Math.max(dt, 4), 100);
}

/** How long a glide to a week takes: quicker the faster the swipe was going, 100–240 ms. */
export function glideMs(distance: number, speed: number): number {
  return Math.min(240, Math.max(100, Math.abs(distance) / Math.max(Math.abs(speed), 1.5)));
}
