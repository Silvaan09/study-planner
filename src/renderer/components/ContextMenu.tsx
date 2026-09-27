import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuItem | 'separator';

export interface MenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {menu.items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="menu-icon">{item.icon}</span>
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
