import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/* ---------- Avisos ---------- */

interface Notice {
  id: number;
  text: string;
  error: boolean;
}
const notices = signal<Notice[]>([]);
let counter = 0;

export function notify(text: string, error = false): void {
  const id = ++counter;
  notices.value = [...notices.value.slice(-2), { id, text, error }];
  setTimeout(() => dismiss(id), error ? 8000 : 4000);
}
const dismiss = (id: number) => (notices.value = notices.value.filter((n) => n.id !== id));

export function Notices() {
  return (
    <div class="notices" role="status" aria-live="polite">
      {notices.value.map((n) => (
        <div key={n.id} class={`notice${n.error ? ' notice--error' : ''}`}>
          {n.error ? <Icon name="alert" /> : <Icon name="check" />}
          <span>{n.text}</span>
          <button type="button" class="icon-btn" aria-label="Cerrar aviso" onClick={() => dismiss(n.id)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Confirmaciones ---------- */

interface Question {
  title: string;
  message: ComponentChildren;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}
const question = signal<(Question & { answer: (ok: boolean) => void }) | null>(null);

export const confirmDialog = (q: Question) =>
  new Promise<boolean>((resolve) => {
    question.value = { ...q, answer: resolve };
  });

export function ConfirmHost() {
  const q = question.value;
  if (!q) return null;
  const answer = (ok: boolean) => {
    question.value = null;
    q.answer(ok);
  };
  return (
    <Dialog title={q.title} onClose={() => answer(false)} narrow>
      <div class="dialog__text">{q.message}</div>
      <div class="dialog__actions">
        <button type="button" class="btn" onClick={() => answer(false)}>
          {q.cancelLabel ?? 'Cancelar'}
        </button>
        <button type="button" class={`btn ${q.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => answer(true)}>
          {q.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

interface DialogProps {
  title: string;
  onClose: () => void;
  narrow?: boolean;
  children: ComponentChildren;
}
export function Dialog({ title, onClose, narrow, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const back = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => back?.focus?.();
  }, []);
  return (
    <dialog
      ref={ref}
      class={`dialog${narrow ? ' dialog--narrow' : ''}`}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header class="dialog__head">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" class="icon-btn" aria-label="Cerrar" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

/**
 * Cerrojo inmediato: aunque se pulse dos veces antes de que el botón se desactive,
 * la operación se ejecuta una sola vez.
 */
export function useLock() {
  const locked = useRef(false);
  return async (job: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    try {
      await job();
    } finally {
      locked.current = false;
    }
  };
}

/* ---------- Piezas ---------- */

interface FieldProps {
  id: string;
  label: string;
  hint?: ComponentChildren;
  error?: string;
  optional?: boolean;
  children: ComponentChildren;
}
export function Field({ id, label, hint, error, optional, children }: FieldProps) {
  return (
    <div class={`field${error ? ' field--error' : ''}`}>
      <label for={id}>
        {label}
        {optional && <span class="field__optional"> (opcional)</span>}
      </label>
      {children}
      {hint && (
        <p class="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p class="field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p class="loading" role="status">
      <span class="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function PasswordInput(props: { id: string; value: string; autocomplete: string; invalid?: boolean; onInput: (v: string) => void }) {
  const visible = useRef(signal(false)).current;
  return (
    <div class="password">
      <input
        id={props.id}
        type={(visible.value ? 'text' : 'password') as 'text'}
        autocomplete={props.autocomplete}
        autocapitalize="off"
        spellcheck={false}
        maxLength={128}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.invalid ? `${props.id}-error` : undefined}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
      <button
        type="button"
        class="icon-btn"
        aria-label={visible.value ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible.value}
        onClick={() => (visible.value = !visible.value)}
      >
        <Icon name={visible.value ? 'eye-off' : 'eye'} />
      </button>
    </div>
  );
}

const PATHS = {
  list: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.500 20a7.500 7.500 0 0 1 15 0',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  exit: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.500 6.500l4 4',
  eye: 'M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off': 'M4 4l16 16M9.900 5.800A9 9 0 0 1 12 5.500c6 0 9.500 6.500 9.500 6.500a16 16 0 0 1-3 3.700M6.300 7.600A16 16 0 0 0 2.500 12S6 18.500 12 18.500a9 9 0 0 0 4-.900M10 10a3 3 0 0 0 4 4',
  trash: 'M4 7h16M9 7V4h6v3M6.500 7l1 13h9l1-13M10 11v5M14 11v5',
  up: 'M12 19V6M6 11.500 12 5.500l6 6',
  down: 'M12 5v13M6 12.500l6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.500l4.500 4.500L19 7.500',
  alert: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.500v5.500M12 16.500h.010',
  search: 'M10.500 17a6.500 6.500 0 1 0 0-13 6.500 6.500 0 0 0 0 13ZM15.500 15.500l5 5',
  star: 'M12 3.500l2.600 5.400 5.900.800-4.300 4.100 1 5.900L12 16.900l-5.200 2.800 1-5.900L3.500 9.700l5.900-.800L12 3.500Z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.500h.010',
  video: 'M4 6h11v12H4zM15 10.500l5-3v9l-5-3',
  back: 'M19 12H6M11 6l-6 6 6 6',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const money = (cents: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);

/** «12,5» o «12.50» → 1250. Devuelve null si no es un precio. */
export function parsePrice(text: string): number | null {
  const m = text.trim().replace(/\s*€$/, '').match(/^(\d{1,5})(?:[.,](\d{1,2}))?$/);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null;
}
export const priceText = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

const names = new Intl.DisplayNames('es', { type: 'language' });
export const languageName = (code: string) => {
  const n = names.of(code) ?? code;
  return n[0].toUpperCase() + n.slice(1);
};

export const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
