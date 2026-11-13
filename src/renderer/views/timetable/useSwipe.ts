import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { addDays, type ISODate } from '../../../shared/dates';
import { FLICK_SPEED, SWITCH_FRACTION, glideMs, landingWeek, swipeSpeed, swipeWindow, velocityAtRelease, withPending } from '../../swipe';
import { reducedMotion, scrollToMinute, topMinute } from './layout';

/**
 * Swiping between weeks, the side panes' alignment and the slide-in of a week picked otherwise.
 * `swipedTo` / `swipedMinute` are shared with the initial scroll of a week (set when a swipe lands on a neighbour).
 */
export function useSwipe({
  shownWeek,
  setWeekStart,
  scrollRef,
  swipedTo,
  swipedMinute,
}: {
  shownWeek: ISODate;
  setWeekStart: (w: ISODate) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  swipedTo: RefObject<ISODate | null>;
  swipedMinute: RefObject<number | null>;
}) {
  // Swiping. The previous, this and the next week sit side by side on a track (`.tt-track`), moved only with a GPU
  // transform (scrolling it would repaint every frame). The track sits in a sticky viewport inside `.tt-carousel`,
  // which itself scrolls natively over a wide invisible area: two-finger swipes scroll that, and its scroll positions
  // are the input. That way the browser tells when the fingers are lifted (`scrollend`: resting them on the trackpad
  // doesn't end the swipe), while vertical scrolling stays native in each week.
  // The strip follows 1:1 for as long as the fingers are on the trackpad; only when they are let go (scrollend) it
  // glides quickly to the week it lands on (see landingWeek). The trackpad's momentum after the lift belongs to the
  // gesture (scrollend comes after it); a swipe moves at most one week boundary on (see swipeWindow), so a fast
  // flick's momentum carries the strip to the next week and stops there. Reaching a neighbour
  // makes it the current week: rendered synchronously (flushSync) with the strip re-centred and moved by the same
  // amount, so nothing jumps. A swipe that starts during a glide goes on from the week it was heading for (see
  // withPending), so quick swipes add up, and a glide over several weeks lands on each in turn.
  const carouselRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  /** The strip's position relative to the current week (px, positive = towards the next one). */
  const stripPos = useRef(0);
  const placeStrip = useCallback((at: number) => {
    stripPos.current = at;
    const width = carouselRef.current?.clientWidth ?? 0;
    if (trackRef.current) trackRef.current.style.transform = `translate3d(${-(width + at)}px, 0, 0)`;
  }, []);
  const prevScrollRef = useRef<HTMLDivElement>(null);
  const nextScrollRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(shownWeek);
  shownRef.current = shownWeek;
  useLayoutEffect(() => placeStrip(0), [shownWeek, placeStrip]);
  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    /** 'swipe' = following the fingers (and their momentum) until the gesture ends. */
    let mode: 'idle' | 'swipe' = 'idle';
    let samples = 0; // movements of this swipe
    let velocity = 0; // px per ms, positive = towards the next week (smoothed)
    let travel = 0; // px this swipe has moved the strip
    // Weeks below are relative to the current week and shift whenever a week is landed on.
    let bounds: [number, number] = [-1, 1]; // the weeks the swipe may move between (see swipeWindow)
    let pendingAtStart: number | null = null; // the week a glide was heading for when this swipe started
    let last = 0; // the scroll position last seen
    let lastAt = 0; // when it last changed
    let frame = 0;
    let pending = 0; // the week the running glide heads for

    /** Puts the native scroll position back in the middle of its room (only while nothing is swiping). */
    const recentre = () => {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
      last = el.scrollLeft;
    };
    const width = () => el.clientWidth;
    /** The strip's position in weeks (0 = the current week, 0.3 = 30% of the way to the next). */
    const weeks = () => stripPos.current / width();
    /** Makes the neighbour `dir` the current week; true once it is shown (it may still be loading). */
    const land = (dir: -1 | 1) => {
      const target = addDays(shownRef.current, 7 * dir);
      swipedTo.current = target;
      swipedMinute.current = topMinute(scrollRef.current);
      flushSync(() => setWeekStart(target));
      return shownRef.current === target;
    };
    /** Places the strip at `at` px, landing on every neighbour it reaches (so it can move on to the week after). */
    const place = (at: number) => {
      const w = width();
      while (at >= w - 0.5 || at <= 0.5 - w) {
        const dir = at > 0 ? 1 : -1;
        if (!land(dir)) {
          // That week isn't loaded yet: rest on it; it becomes current (and centred) once it is.
          placeStrip(dir * w);
          pending = 0;
          pendingAtStart = null;
          return;
        }
        at -= dir * w;
        // Everything counted in weeks moves along with the current week.
        bounds = [bounds[0] - dir, bounds[1] - dir];
        if (pendingAtStart !== null) pendingAtStart -= dir;
        pending -= dir;
      }
      placeStrip(at);
    };
    const stopGlide = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    /** Glides to week `target` (0 = back to the current one), landing on each week it passes. */
    const glide = (target: number, speed: number) => {
      stopGlide();
      const from = stripPos.current;
      const distance = target * width() - from;
      const ms = reducedMotion() ? 0 : glideMs(distance, speed) * Math.max(1, Math.abs(target) * 0.75);
      const t0 = performance.now();
      let done = 0; // px of `distance` covered so far
      pending = target;
      const step = (now: number) => {
        const t = ms === 0 ? 1 : Math.min(1, (now - t0) / ms);
        const covered = distance * (1 - (1 - t) ** 3);
        place(stripPos.current + covered - done);
        done = covered;
        if (t < 1) frame = requestAnimationFrame(step);
        else frame = 0;
      };
      frame = requestAnimationFrame(step);
    };
    /** The gesture ended (fingers lifted, momentum done): glide to the week it lands on. */
    const release = () => {
      const v = velocityAtRelease(velocity, performance.now() - lastAt);
      const direction = Math.sign(travel);
      const own = landingWeek(weeks(), direction, v);
      const moving = Math.abs(v) >= FLICK_SPEED || Math.abs(travel) > width() * SWITCH_FRACTION;
      const target = withPending(own, pendingAtStart, direction, moving);
      glide(Math.min(bounds[1], Math.max(bounds[0], target)), v);
    };
    /** A new gesture: from here the swipe may move one week boundary on in either direction. */
    const startSwipe = () => {
      pendingAtStart = frame ? pending : null;
      stopGlide();
      mode = 'swipe';
      samples = 0;
      velocity = 0;
      travel = 0;
      bounds = swipeWindow(weeks(), pendingAtStart);
    };

    const onScroll = () => {
      const x = el.scrollLeft;
      const dx = x - last;
      last = x;
      if (dx === 0) return;
      const now = performance.now();
      const dt = now - lastAt;
      lastAt = now;
      if (mode === 'idle') startSwipe(); // a new gesture
      const speed = swipeSpeed(dx, dt);
      // The first movement has no meaningful time to measure its speed against. (A new touch ends the momentum's
      // gesture first, so every movement until scrollend belongs to this swipe; its momentum can even be faster than
      // the fingers were, so speed says nothing about whether new fingers came in.)
      if (samples++ > 0) velocity = samples === 2 ? speed : velocity * 0.5 + speed * 0.5;
      const w = width();
      const at = Math.min(bounds[1] * w, Math.max(bounds[0] * w, stripPos.current + dx));
      travel += at - stripPos.current;
      if (at !== stripPos.current) place(at);
    };
    // The gesture is over (fingers lifted, plus any momentum): settle, and make room for the next swipe.
    const onScrollEnd = () => {
      if (mode === 'swipe') release();
      mode = 'idle';
      recentre();
    };
    // A resized window keeps the current week in place.
    const resized = new ResizeObserver(() => {
      placeStrip(stripPos.current);
      if (mode === 'idle') recentre();
    });
    recentre();
    el.addEventListener('scroll', onScroll);
    el.addEventListener('scrollend', onScrollEnd);
    resized.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onScrollEnd);
      stopGlide();
      resized.disconnect();
    };
  }, [setWeekStart, placeStrip]);

  // The weeks beside the current one show the same hours, so swiping doesn't jump up or down. Aligned by the time at
  // the top of the grid, not by pixels: the weeks' first hours and the heights of their "To do"/"Due" rows differ.
  const alignPanes = useCallback(() => {
    const minute = topMinute(scrollRef.current);
    if (minute === null) return;
    for (const r of [prevScrollRef, nextScrollRef]) if (r.current) scrollToMinute(r.current, minute);
  }, []);
  useLayoutEffect(alignPanes);

  // A week picked with the buttons, keys or week picker slides in from the side it comes from (a swiped-to week is
  // already in place).
  const prevShown = useRef(shownWeek);
  useLayoutEffect(() => {
    const prev = prevShown.current;
    prevShown.current = shownWeek;
    const el = scrollRef.current;
    const swiped = swipedTo.current === shownWeek;
    if (swiped) swipedTo.current = null;
    if (!el || prev === shownWeek || swiped || reducedMotion()) return;
    const from = shownWeek > prev ? 40 : -40;
    el.animate([{ transform: `translateX(${from}px)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], {
      duration: 220,
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    });
  }, [shownWeek]);

  return { carouselRef, trackRef, prevScrollRef, nextScrollRef, alignPanes };
}
