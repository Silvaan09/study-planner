import type { CSSProperties } from 'react';
import type { Subject } from '../../shared/types';
import { X } from './Icons';

/** "● Subject ×" in a view header while the sidebar focuses one subject; the × shows all subjects again. */
export function FocusPill({ subject, onClear }: { subject: Subject | null; onClear: () => void }) {
  if (!subject) return null;
  return (
    <span className="focus-pill" style={{ '--c': subject.color } as CSSProperties} title={`Showing only ${subject.name}`}>
      <span className="dot" />
      <span className="focus-pill-name">{subject.name}</span>
      <button className="icon-btn small" onClick={onClear} title="Show all subjects">
        <X size={13} />
      </button>
    </span>
  );
}
