import { useEffect } from 'preact/hooks';
import { categories, extras, products, productsOf, type Category, type ExtraItem, type Product } from '../lib/menu';
import { formatPrice, lang, t, tr } from '../lib/i18n';
import { ALL, category, query, searchOpen, sectionInView } from '../lib/navigation';
import { ProductCard, type Variant } from './ProductCard';

export function Menu() {
  const q = normalise(query.value);
  return (
    <main id="carta" class="menu" tabIndex={-1}>
      {q ? <SearchResults q={q} /> : <Sections />}
    </main>
  );
}

function Sections() {
  const current = category.value;
  const visible = current === ALL ? categories.value : categories.value.filter((c) => c.id === current);

  useEffect(() => {
    sectionInView.value = null;
    if (current !== ALL) return;
    const observer = new IntersectionObserver(
      (changes) => {
        for (const c of changes) if (c.isIntersecting) sectionInView.value = c.target.id.replace('seccion-', '');
      },
      { rootMargin: '-35% 0px -64% 0px' },
    );
    document.querySelectorAll('.section').forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [current]);

  return (
    <>
      {visible.map((c, i) => (
        <Section key={c.id} category={c} first={i === 0} />
      ))}
    </>
  );
}

function Section({ category: c, first }: { category: Category; first: boolean }) {
  const titleId = `titulo-${c.id}`;
  return (
    <section id={`seccion-${c.id}`} class={`section section--${c.type}`} aria-labelledby={titleId}>
      <h2 id={titleId} class="section__title">
        <span>{tr(c.name)}</span>
      </h2>
      {c.type === 'extras' ? <ExtrasSheet /> : <ProductList list={productsOf(c.id)} first={first} />}
    </section>
  );
}

const variantOf = (p: Product): Variant => (p.featured ? 'destacada' : p.layout);

function ProductList({ list, first }: { list: Product[]; first: boolean }) {
  return (
    <div class="products">
      {list.map((p, i) => (
        <ProductCard key={p.slug} product={p} variant={variantOf(p)} eager={first && i === 0} />
      ))}
    </div>
  );
}

function ExtrasSheet() {
  return (
    <div class="sheet" data-anchor>
      <h3 class="sheet__title">{tr(extras.value.title)}</h3>
      <div class="sheet__groups">
        {extras.value.groups.map((g) => (
          <section key={g.id} class="sheet__group">
            <h4>{tr(g.name)}</h4>
            <ExtraRows items={g.items} />
          </section>
        ))}
      </div>
    </div>
  );
}

function ExtraRows({ items }: { items: ExtraItem[] }) {
  return (
    <ul class="rows">
      {items.map((x) => (
        <li key={x.id} class={x.available ? undefined : 'is-unavailable'}>
          <span>{tr(x.name)}</span>
          <span class="rows__price">{x.available ? formatPrice(x.price) : t('unavailable')}</span>
        </li>
      ))}
    </ul>
  );
}

const normalise = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

function SearchResults({ q }: { q: string }) {
  const words = q.split(/\s+/);
  const matches = (...fields: string[]) => {
    const text = normalise(fields.join(' '));
    return words.every((w) => text.includes(w));
  };
  const l = lang.value;
  const foundProducts = products.value.filter((p) => matches(p.name[l], p.description[l]));
  const foundExtras = extras.value.groups.flatMap((g) => g.items).filter((x) => matches(x.name[l]));
  const total = foundProducts.length + foundExtras.length;

  return (
    <section class="section results">
      <p class="results__count" role="status">
        {total === 0
          ? t('noResults', { q: query.value.trim() })
          : total === 1
            ? t('oneResult')
            : t('results', { n: total })}
      </p>
      {total === 0 && (
        <button
          type="button"
          class="solid-button"
          onClick={() => {
            query.value = '';
            searchOpen.value = false;
          }}
        >
          {t('clearSearch')}
        </button>
      )}
      <div class="products">
        {foundProducts.map((p) => (
          <ProductCard key={p.slug} product={p} variant="compacta" />
        ))}
      </div>
      {foundExtras.length > 0 && (
        <div class="sheet">
          <h3 class="sheet__title">{tr(extras.value.title)}</h3>
          <ExtraRows items={foundExtras} />
        </div>
      )}
    </section>
  );
}
