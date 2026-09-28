import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import { X } from './components/Icons';
import { Celebration, CELEBRATION_MS } from './components/Celebration';
import type { ISODate } from '../shared/dates';
import type { CelebrationKind } from '../shared/progress';

// ------------------------------------------------------------------ toasts

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

// ------------------------------------------------------------------ context

interface UiContext {
  /** Incremented after every data change; views reload when it changes. */
  dataVersion: number;
  refresh(): void;
  toast(message: string, opts?: { kind?: Toast['kind']; action?: Toast['action'] }): void;
  /** Shows a modal. `render` receives `close(result)`. Resolves with the result (undefined if dismissed). */
  dialog<T>(render: (close: (result?: T) => void) => ReactNode): Promise<T | undefined>;
  /** Runs a mutation: reports errors as toasts and refreshes views on success. */
  run<T>(fn: () => Promise<T>): Promise<T | undefined>;
  /** Plays the confetti overlay for a week whose lectures and/or exercises were just all completed. */
  celebrate(kind: CelebrationKind, weekStart: ISODate): void;
}

const Ctx = createContext<UiContext | null>(null);

export function useUi(): UiContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUi outside UiProvider');
  return c;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [dataVersion, setDataVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialogs, setDialogs] = useState<{ id: number; node: ReactNode }[]>([]);
  const [celebration, setCelebration] = useState<{ id: number; kind: CelebrationKind; weekStart: ISODate } | null>(null);
  const nextId = useRef(1);

  const refresh = useCallback(() => setDataVersion((v) => v + 1), []);

  const toast = useCallback<UiContext['toast']>((message, opts = {}) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, message, kind: opts.kind ?? 'info', action: opts.action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.action ? 8000 : opts.kind === 'error' ? 7000 : 3500);
  }, []);

  const dialog = useCallback<UiContext['dialog']>((render) => {
    return new Promise((resolve) => {
      const id = nextId.current++;
      const close = (result?: any) => {
        setDialogs((d) => d.filter((x) => x.id !== id));
        resolve(result);
      };
      setDialogs((d) => [...d, { id, node: render(close) }]);
    });
  }, []);

  const run = useCallback<UiContext['run']>(
    async (fn) => {
      try {
        const result = await fn();
        refresh();
        return result;
      } catch (err) {
        const msg = err instanceof ApiError && err.userError ? err.message : `Something went wrong: ${(err as Error).message}`;
        toast(msg, { kind: 'error' });
        refresh();
        return undefined;
      }
    },
    [refresh, toast],
  );

  const celebrate = useCallback<UiContext['celebrate']>((kind, weekStart) => {
    const id = nextId.current++;
    setCelebration({ id, kind, weekStart });
    setTimeout(() => setCelebration((c) => (c?.id === id ? null : c)), CELEBRATION_MS[kind]);
  }, []);

  return (
    <Ctx.Provider value={{ dataVersion, refresh, toast, dialog, run, celebrate }}>
      {children}
      {dialogs.map((d) => (
        <div key={d.id}>{d.node}</div>
      ))}
      {celebration && <Celebration key={celebration.id} kind={celebration.kind} weekStart={celebration.weekStart} />}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------------ data loading

/** Loads data and reloads whenever `deps` or the global data version change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null } {
  const { dataVersion } = useUi();
  const [state, setState] = useState<{ data: T | undefined; error: string | null }>({ data: undefined, error: null });
  useEffect(() => {
    let cancelled = false;
    fn().then(
      (data) => !cancelled && setState({ data, error: null }),
      (err) => !cancelled && setState((s) => ({ data: s.data, error: (err as Error).message })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, dataVersion]);
  return state;
}

// ------------------------------------------------------------------ modal shell

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm({
  title,
  message,
  confirmLabel,
  danger,
  close,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  close: (ok?: boolean) => void;
}) {
  return (
    <Modal
      title={title}
      onClose={() => close(false)}
      width={420}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
    </Modal>
  );
}

/** Asks which occurrences an action applies to. */
export function ScopeChooser({
  title,
  action,
  danger,
  options,
  close,
}: {
  title: string;
  action: string;
  danger?: boolean;
  options: { value: 'this' | 'future' | 'all'; label: string; hint: string }[];
  close: (scope?: 'this' | 'future' | 'all') => void;
}) {
  const [scope, setScope] = useState(options[0].value);
  return (
    <Modal
      title={title}
      onClose={() => close()}
      width={440}
      footer={
        <>
          <button className="btn" onClick={() => close()}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(scope)} autoFocus>
            {action}
          </button>
        </>
      }
    >
      <div className="scope-options">
        {options.map((o) => (
          <label key={o.value} className={`scope-option ${scope === o.value ? 'selected' : ''}`}>
            <input type="radio" name="scope" checked={scope === o.value} onChange={() => setScope(o.value)} />
            <span>
              <strong>{o.label}</strong>
              <small>{o.hint}</small>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
