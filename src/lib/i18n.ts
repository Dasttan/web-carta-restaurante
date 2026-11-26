import { signal } from '@preact/signals';
import textos from '../data/textos.json';
import type { Lang, Localized } from './menu';
import { scroller } from './scroll';

export type TextKey = keyof typeof textos;

const STORAGE_KEY = 'carta-lang';
const isLang = (v: unknown): v is Lang => v === 'es' || v === 'en';

export const lang = signal<Lang>('es');

/** Texto de interfaz en el idioma activo. Admite variables: t('servings', { n: 2 }). */
export function t(key: TextKey, vars?: Record<string, string | number>): string {
  let out: string = textos[key][lang.value];
  for (const name in vars) out = out.replace(`{${name}}`, String(vars[name]));
  return out;
}

/** Campo bilingüe de los datos en el idioma activo. */
export const tr = (value: Localized): string => value[lang.value];

export function formatPrice(value: number): string {
  // Se formatea a mano para que el HTML prerenderizado y el navegador coincidan siempre.
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return lang.value === 'en' ? `€${text}` : `${text.replace('.', ',')} €`;
}

/** Prioridad: enlace (?lang=) → elección guardada → idioma del navegador → castellano. */
export function detectLang(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* almacenamiento bloqueado: se sigue con el idioma del navegador */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l.slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return 'es';
}

export function applyLang(next: Lang): void {
  lang.value = next;
  document.documentElement.lang = next;
  document.title = textos.title[next];
  document.querySelector('meta[name="description"]')?.setAttribute('content', textos.metaDescription[next]);
}

/** Cambio de idioma pedido por el cliente: lo guarda y mantiene en su sitio lo que estaba leyendo. */
export function chooseLang(next: Lang): void {
  if (next === lang.value) return;
  const anchor = [...document.querySelectorAll<HTMLElement>('[data-anchor]')].find(
    (el) => el.getBoundingClientRect().bottom > 140,
  );
  const before = anchor?.getBoundingClientRect().top ?? 0;

  applyLang(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* sin almacenamiento: el cambio vale para esta visita */
  }
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', next);
    history.replaceState(history.state, '', url);
  }

  if (anchor && scroller().scrollTop > 0) {
    requestAnimationFrame(() => {
      scroller().scrollBy({ top: anchor.getBoundingClientRect().top - before, behavior: 'instant' });
    });
  }
}
