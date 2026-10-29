/**
 * The main window reopens the way it was closed: maximized (the default), full screen,
 * or as a normal window with its last size and position. Stored as JSON in the app-state folder.
 * Pure helpers only (no Electron imports), so they can be tested.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  /** Size and position of the normal (not maximized) window; undefined = default size, centred. */
  bounds?: Rect;
  maximized: boolean;
  fullScreen: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = { maximized: true, fullScreen: false };

/** How much of a saved window must lie on a display for its position to be reused. */
const MIN_VISIBLE = { width: 120, height: 60 };

function isRect(v: unknown): v is Rect {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
}

function overlap(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.min(a.x + a.width, b.x + b.width) - x, height: Math.min(a.y + a.height, b.y + b.height) - y };
}

/**
 * Reads the saved state. Anything unreadable gives the default (maximized). Saved bounds are
 * dropped when they no longer sit on any display (e.g. a monitor was unplugged), and grown to
 * the window's minimum size.
 */
export function parseWindowState(json: string | null, workAreas: Rect[], minSize: { width: number; height: number }): WindowState {
  let raw: unknown;
  try {
    raw = json == null ? null : JSON.parse(json);
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WINDOW_STATE };
  const r = raw as Record<string, unknown>;
  const state: WindowState = {
    maximized: typeof r.maximized === 'boolean' ? r.maximized : DEFAULT_WINDOW_STATE.maximized,
    fullScreen: r.fullScreen === true,
  };
  if (isRect(r.bounds)) {
    const bounds = {
      x: Math.round(r.bounds.x),
      y: Math.round(r.bounds.y),
      width: Math.max(minSize.width, Math.round(r.bounds.width)),
      height: Math.max(minSize.height, Math.round(r.bounds.height)),
    };
    const visible = workAreas.some((area) => {
      const o = overlap(bounds, area);
      return o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height;
    });
    if (visible) state.bounds = bounds;
  }
  return state;
}
