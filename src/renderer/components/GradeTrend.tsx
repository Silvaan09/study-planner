import { useEffect, useRef, useState } from 'react';
import { formatAverage, formatNumber, PASS_GRADE } from '../../shared/grades';

export interface TrendPoint {
  id: number;
  label: string;
  average: number;
  credits: number;
}

const H = 210;
const PAD = { top: 18, right: 16, bottom: 34, left: 40 };

/** Line chart of the semester averages, oldest left. One series: no legend; the pass mark as a dashed reference line. */
export function GradeTrend({ points, onPick }: { points: TrendPoint[]; onPick?: (id: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the container's real width (text keeps its size).
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length === 0) return null;
  const values = points.map((p) => p.average);
  // Half-grade steps around the data, always showing the pass mark, within 1–6.
  const lo = Math.max(1, Math.floor((Math.min(...values, PASS_GRADE) - 0.25) * 2) / 2);
  const hi = Math.min(6, Math.ceil((Math.max(...values, PASS_GRADE) + 0.25) * 2) / 2);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += 0.5) ticks.push(t);
  // Room at the sides so the first and last semester names fit under their points.
  const side = points.length === 1 ? 0 : 70;
  const innerW = W - PAD.left - PAD.right - 2 * side;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + side + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * innerH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.average).toFixed(1)}`).join(' ');
  const h = hover === null ? null : points[hover];

  return (
    <div className="trend" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label="Average grade per semester">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === PASS_GRADE ? 'trend-pass' : 'trend-grid'} />
            <text x={PAD.left - 8} y={y(t)} className="trend-axis" textAnchor="end" dominantBaseline="middle">
              {formatNumber(t)}
            </text>
          </g>
        ))}
        {PASS_GRADE >= lo && PASS_GRADE <= hi && (
          <text x={W - PAD.right} y={y(PASS_GRADE) - 5} className="trend-axis" textAnchor="end">
            pass
          </text>
        )}
        {points.map((p, i) => (
          <text key={p.id} x={x(i)} y={H - 10} className="trend-axis trend-x" textAnchor="middle">
            {p.label.length > 24 ? `${p.label.slice(0, 23)}…` : p.label}
          </text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="trend-cross" />}
        <path d={path} className="trend-line" />
        {points.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(p.average)} r={hover === i ? 6 : 5} className="trend-dot" />
        ))}
        {/* The latest value as a direct label; the rest on hover. */}
        <text x={x(points.length - 1)} y={y(points[points.length - 1].average) - 12} className="trend-value" textAnchor="middle">
          {formatAverage(points[points.length - 1].average)}
        </text>
        {points.map((p, i) => (
          <rect
            key={p.id}
            x={x(i) - Math.max(18, innerW / Math.max(1, points.length - 1) / 2)}
            width={Math.max(36, innerW / Math.max(1, points.length - 1))}
            y={PAD.top}
            height={innerH}
            className="trend-hit"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onPick?.(p.id)}
          />
        ))}
      </svg>
      {h && hover !== null && (
        <div className="trend-tip" style={{ left: x(hover), top: y(h.average) }} role="tooltip">
          <strong>{h.label}</strong>
          <span>
            Average {formatAverage(h.average)} · {formatNumber(h.credits)} graded credits
          </span>
        </div>
      )}
    </div>
  );
}
