import { useMemo, type CSSProperties } from 'react';
import { addDays, formatWeekRange, startOfWeek, todayISO, type ISODate } from '../../shared/dates';
import type { CelebrationKind } from '../../shared/progress';
import { Book, Check, ListTodo } from './Icons';

/** How long the overlay stays, in ms (the CSS fade-out starts shortly before). */
export const CELEBRATION_MS: Record<CelebrationKind, number> = { lectures: 2600, exercises: 2600, everything: 4200 };

const TEXT: Record<CelebrationKind, { title: string; sub: string; icon: React.ReactNode }> = {
  lectures: { title: 'All lectures done', sub: 'Every lecture is checked off', icon: <Book size={22} /> },
  exercises: { title: 'All exercises done', sub: 'Every planned exercise is completed', icon: <ListTodo size={22} /> },
  everything: { title: 'Week complete!', sub: 'Everything is checked off', icon: <Check size={24} strokeWidth={3} /> },
};

const COLORS = ['var(--accent)', 'var(--success)', 'var(--warn)', 'var(--danger)', '#c58cff', '#4fd1e8'];

function weekLabel(weekStart: ISODate): string {
  const current = startOfWeek(todayISO());
  if (weekStart === current) return 'This week';
  if (weekStart === addDays(current, -7)) return 'Last week';
  return formatWeekRange(weekStart);
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Confetti overlay shown when a week's lectures and/or exercises are all completed. Click-through; removed by the caller. */
export function Celebration({ kind, weekStart }: { kind: CelebrationKind; weekStart: ISODate }) {
  const big = kind === 'everything';
  const pieces = useMemo(() => {
    const burst = Array.from({ length: big ? 90 : 50 }, () => {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(90, big ? 380 : 280);
      return {
        rain: false,
        dx: `${Math.cos(angle) * dist}px`,
        dy: `${Math.sin(angle) * dist * 0.7 - 70}px`,
        delay: `${rand(0, 0.12)}s`,
        dur: `${rand(1.3, 2)}s`,
      };
    });
    const rain = big
      ? Array.from({ length: 110 }, () => ({
          rain: true,
          x: `${rand(0, 100)}vw`,
          dx: `${rand(-120, 120)}px`,
          delay: `${rand(0.1, 1.4)}s`,
          dur: `${rand(2, 3)}s`,
        }))
      : [];
    return [...burst, ...rain].map((p, i) => ({
      ...p,
      rot: `${rand(-720, 720)}deg`,
      color: COLORS[i % COLORS.length],
      shape: i % 3,
    }));
  }, [big]);
  const text = TEXT[kind];

  return (
    <div className={`celebration ${kind}`} style={{ '--stay': `${CELEBRATION_MS[kind] - 450}ms` } as CSSProperties} role="status">
      <div className="celebration-card">
        <span className="celebration-icon">{text.icon}</span>
        <span className="celebration-text">
          <strong>{text.title}</strong>
          <small>
            {weekLabel(weekStart)} · {text.sub}
          </small>
        </span>
      </div>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`confetti shape-${p.shape} ${p.rain ? 'rain' : 'burst'}`}
          style={
            {
              '--c': p.color,
              '--x': 'x' in p ? p.x : undefined,
              '--dx': p.dx,
              '--dy': 'dy' in p ? p.dy : undefined,
              '--rot': p.rot,
              animationDelay: p.delay,
              animationDuration: p.dur,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
