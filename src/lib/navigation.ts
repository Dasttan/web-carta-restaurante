import { signal } from '@preact/signals';
import { categories, products } from './menu';
import { lang } from './i18n';
import { scroller } from './scroll';

export const ALL = 'todo';

/** Categoría elegida: ALL o el id de una categoría. */
export const category = signal<string>(ALL);
/** En «Toda la carta», la sección que el cliente tiene delante. */
export const sectionInView = signal<string | null>(null);
export const query = signal('');
export const searchOpen = signal(false);

const isCategory = (id: string | null): id is string => categories.value.some((c) => c.id === id);

export function categoryHref(id: string): string {
  return id === ALL ? '/' : `/?categoria=${id}`;
}

function scrollToMenu(): void {
  const box = scroller();
  if (box !== document.documentElement) {
    box.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }
  const menu = document.getElementById('carta');
  if (!menu) return;
  const bar = document.querySelector<HTMLElement>('.topbar')?.offsetHeight ?? 0;
  const top = menu.getBoundingClientRect().top + scrollY - bar;
  if (scrollY > top) scrollTo({ top: Math.max(0, top), behavior: 'instant' });
}

export function chooseCategory(id: string): void {
  query.value = '';
  searchOpen.value = false;
  if (id !== category.value) {
    category.value = id;
    const url = new URL(location.href);
    if (id === ALL) url.searchParams.delete('categoria');
    else url.searchParams.set('categoria', id);
    url.hash = '';
    history.pushState(null, '', url);
  }
  requestAnimationFrame(scrollToMenu);
}

export function readLocation(): void {
  const id = new URLSearchParams(location.search).get('categoria');
  category.value = isCategory(id) ? id : ALL;
}

/** Si el enlace apunta a un plato (#slug), se muestra y se resalta. */
export function revealHash(): void {
  const slug = decodeURIComponent(location.hash.slice(1));
  const product = products.value.find((p) => p.slug === slug);
  if (!product) return;
  if (category.value !== ALL && category.value !== product.category) category.value = ALL;
  requestAnimationFrame(() => {
    const el = document.getElementById(slug);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    el.classList.add('is-target');
    setTimeout(() => el.classList.remove('is-target'), 2400);
  });
}

export function shareUrl(slug?: string): string {
  const url = new URL('/', location.origin);
  if (!slug && category.value !== ALL) url.searchParams.set('categoria', category.value);
  url.searchParams.set('lang', lang.value);
  if (slug) url.hash = slug;
  return url.href;
}
