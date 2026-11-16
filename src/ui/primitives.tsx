'use client';

import { X } from '@phosphor-icons/react';
import { useEffect, useRef, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink font-semibold',
  secondary: 'bg-surface-2 text-text font-medium',
  ghost: 'text-text font-medium hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger font-medium',
};

export function Button({ variant = 'secondary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] px-4 text-[15px] transition-opacity active:opacity-70 disabled:opacity-40',
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-[16px] border border-line bg-surface p-4', className)}>{children}</section>;
}

export function Chip({ children, tone = 'neutral', onRemove }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'danger'; onRemove?: () => void }) {
  const tones = { neutral: 'bg-surface-2 text-muted', accent: 'bg-accent-soft text-accent', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger' };
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-medium', tones[tone])}>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Odebrat" className="-mr-1 grid size-6 place-items-center rounded-full">
          <X size={12} weight="bold" />
        </button>
      )}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass = 'min-h-11 w-full rounded-[8px] border border-line bg-surface px-3 text-base text-text placeholder:text-muted';

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-[8px] bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-10 flex-1 rounded-[6px] px-2 text-[14px] font-medium', o.value === value ? 'bg-surface text-text shadow-sm' : 'text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DayToggles({ value, onChange, label }: { value: number[]; onChange: (v: number[]) => void; label: string }) {
  const names = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {names.map((n, i) => {
        const on = value.includes(i);
        return (
          <button
            key={n}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((d) => d !== i) : [...value, i].sort())}
            className={cx('min-h-11 flex-1 rounded-[8px] text-[14px] font-medium', on ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted')}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** Spodní list nad nativním `<dialog>`: fokus, Escape i čtečky řeší prohlížeč. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
            <h2 className="text-[17px] font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Zavřít" className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
              <X size={20} />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <footer className="flex gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

// ---------- Toast s akcí (undo) ----------

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let counter = 0;

export function toast(text: string, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}) {
  const t: Toast = { id: ++counter, text, tone: opts.tone ?? 'info', action: opts.action };
  toasts = [...toasts.slice(-1), t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, opts.ms ?? (opts.action ? 8000 : 4000));
}

const EMPTY: Toast[] = [];
export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => EMPTY,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[12px] px-4 py-2 text-[15px] shadow-lg', t.tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-text text-bg')}>
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="min-h-11 rounded-[8px] px-3 font-semibold underline underline-offset-2"
              onClick={() => {
                t.action!.run();
                toasts = toasts.filter((x) => x.id !== t.id);
                emit();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="text-center">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-[15px] text-muted">{children}</div>
    </Card>
  );
}
