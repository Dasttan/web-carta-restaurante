import { useEffect, useRef, useState } from 'preact/hooks';
import { categories, restaurant, type Lang } from '../lib/menu';
import { chooseLang, lang, t, tr } from '../lib/i18n';
import { ALL, category, categoryHref, chooseCategory, query, searchOpen, sectionInView, shareUrl } from '../lib/navigation';
import { scrollToTop } from '../lib/scroll';
import { share } from '../lib/share';
import { IconClose, IconSearch, IconShare } from './Icons';

const LANGS: [Lang, string][] = [
  ['es', 'Español'],
  ['en', 'English'],
];

export function TopBar() {
  const [hidden, setHidden] = useState(false);

  // Al bajar se esconde la cabecera (quedan las categorías); al subir, vuelve.
  useEffect(() => {
    let last = scrollY;
    const onScroll = () => {
      const y = Math.max(0, scrollY);
      if (Math.abs(y - last) < 8) return;
      setHidden(y > last && y > 140);
      last = y;
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div class={`topbar${hidden ? ' is-condensed' : ''}`}>
      <header class="masthead" onFocusCapture={() => setHidden(false)}>
        <a
          class="masthead__brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            chooseCategory(ALL);
            scrollToTop(true);
          }}
        >
          <img src="/brand/logotipo.svg" width="44" height="44" alt="" />
          <h1 class="visually-hidden">
            {tr(restaurant.name)}. {t('menu')}
          </h1>
          <span class="masthead__name" aria-hidden="true">
            {restaurant.nameLines[lang.value].map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </a>
        <div class="lang" role="group" aria-label={t('language')}>
          {LANGS.map(([code, label]) => (
            <button
              key={code}
              type="button"
              lang={code}
              aria-label={label}
              aria-pressed={lang.value === code}
              onClick={() => chooseLang(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label={t('shareMenu')}
          onClick={() => share(tr(restaurant.name), shareUrl())}
        >
          <IconShare />
        </button>
      </header>
      <CategoryNav />
      {searchOpen.value && <SearchBox />}
    </div>
  );
}

function CategoryNav() {
  const listRef = useRef<HTMLUListElement>(null);
  const items = [{ id: ALL, label: t('all') }, ...categories.value.map((c) => ({ id: c.id, label: tr(c.name) }))];
  const current = category.value;
  const inView = current === ALL ? sectionInView.value : null;

  // La categoría activa (o la sección que se está leyendo) siempre queda a la vista en la barra.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('.is-in-view') ?? list?.querySelector<HTMLElement>('[aria-current]');
    if (!list || !el) return;
    // Con la primera sección a la vista se deja «Toda la carta» entera.
    const atStart = inView === categories.value[0]?.id;
    list.scrollTo({ left: atStart ? 0 : el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
  }, [current, inView, lang.value]);

  return (
    <nav class="tabs" aria-label={t('categories')}>
      <ul class="tabs__list" ref={listRef}>
        {items.map(({ id, label }) => (
          <li key={id}>
            <a
              href={categoryHref(id)}
              class={`tab${inView === id ? ' is-in-view' : ''}`}
              aria-current={current === id ? 'true' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                chooseCategory(id);
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
      <button
        type="button"
        class="icon-button"
        aria-label={t(searchOpen.value ? 'closeSearch' : 'search')}
        aria-expanded={searchOpen.value}
        onClick={() => {
          searchOpen.value = !searchOpen.value;
          if (!searchOpen.value) query.value = '';
        }}
      >
        {searchOpen.value ? <IconClose /> : <IconSearch />}
      </button>
    </nav>
  );
}

function SearchBox() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <form class="search" role="search" onSubmit={(e) => { e.preventDefault(); ref.current?.blur(); }}>
      <input
        ref={ref}
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        aria-label={t('search')}
        placeholder={t('searchPlaceholder')}
        value={query.value}
        onInput={(e) => {
          query.value = e.currentTarget.value;
          scrollToTop(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          query.value = '';
          searchOpen.value = false;
        }}
      />
    </form>
  );
}
