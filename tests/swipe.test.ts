import { describe, expect, it } from 'vitest';
import { FLICK_SPEED, glideMs, landingWeek, swipeSpeed, swipeWindow, velocityAtRelease, withPending } from '../src/renderer/swipe';

describe('swiping between weeks', () => {
  it('lands on a week once more than a quarter of it is in view, in the direction of the swipe', () => {
    expect(landingWeek(0, 0, 0)).toBe(0);
    expect(landingWeek(0.2, 1, 0.1)).toBe(0);
    expect(landingWeek(0.3, 1, 0.1)).toBe(1);
    expect(landingWeek(-0.3, -1, -0.1)).toBe(-1);
    expect(landingWeek(-0.2, -1, 0)).toBe(0);
    // Measured from the week it is moving away from: 1.3 on the way on = the week after next.
    expect(landingWeek(1.3, 1, 0)).toBe(2);
    expect(landingWeek(0.9, -1, 0)).toBe(1);
    expect(landingWeek(0.7, -1, 0)).toBe(0);
    // Exactly on a week (e.g. a fast flick's momentum stopped at the next week): stays there.
    expect(landingWeek(1, 1, 0)).toBe(1);
  });

  it('goes on to the next week in the direction of a flick, but back after a flick back', () => {
    expect(landingWeek(0.05, 1, FLICK_SPEED)).toBe(1);
    expect(landingWeek(-0.05, -1, -3)).toBe(-1);
    expect(landingWeek(1.2, 1, 2)).toBe(2);
    // A flick that already reached its week goes no further.
    expect(landingWeek(1, 1, 3)).toBe(1);
    // Flicked back after moving on: back to where it came from.
    expect(landingWeek(0.7, 1, -2)).toBe(0);
    expect(landingWeek(-0.7, -1, 2)).toBe(0);
  });

  it('adds up quick swipes in the same direction and cancels on a reversed one', () => {
    // On its own.
    expect(withPending(1, null, 1, true)).toBe(1);
    // A second flick while the first is still gliding to the next week: two weeks, even if it only got to 0.7.
    expect(withPending(1, 1, 1, true)).toBe(2);
    expect(withPending(2, 1, 1, true)).toBe(2);
    expect(withPending(-1, -1, -1, true)).toBe(-2);
    // A small second swipe keeps the pending week.
    expect(withPending(0, 1, 1, false)).toBe(1);
    // Swiping back cancels it.
    expect(withPending(0, 1, -1, false)).toBe(0);
  });

  it('lets one swipe move at most one week boundary beyond where it started', () => {
    expect(swipeWindow(0, null)).toEqual([-1, 1]);
    expect(swipeWindow(0.6, null)).toEqual([-1, 2]);
    expect(swipeWindow(-0.6, null)).toEqual([-2, 1]);
    // Starting while a glide heads for the next week: one more beyond that.
    expect(swipeWindow(0.2, 1)).toEqual([-1, 2]);
  });

  it('lets go without speed when the fingers rested first', () => {
    expect(velocityAtRelease(3, 10)).toBe(3);
    expect(velocityAtRelease(3, 60)).toBe(3);
    expect(velocityAtRelease(3, 400)).toBe(0);
  });

  it('measures speed per ms, so a dropped frame (double delta) is not faster', () => {
    expect(swipeSpeed(40, 16)).toBe(2.5);
    expect(swipeSpeed(80, 33)).toBeCloseTo(2.42, 2);
    expect(swipeSpeed(10, 0)).toBe(2.5);
  });

  it('glides quicker the faster the swipe was', () => {
    expect(glideMs(900, 4)).toBe(225);
    expect(glideMs(900, 0.2)).toBe(240);
    expect(glideMs(50, 5)).toBe(100);
  });
});
