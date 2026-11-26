import { renderToString } from 'preact-render-to-string';
import { App } from './components/App';
import { categories, products, productsOf, restaurant, setMenu, type MenuData, type Product } from './lib/menu';
import { lang } from './lib/i18n';
import { ALL, category, query, searchOpen, sectionInView } from './lib/navigation';

const item = (p: Product) => ({
  '@type': 'MenuItem',
  name: p.name.es,
  description: p.description.es,
  offers: { '@type': 'Offer', price: p.price.toFixed(2), priceCurrency: 'EUR' },
});

/** Datos estructurados para buscadores, generados de la misma carta. */
const structuredData = () => ({
  '@context': 'https://schema.org',
  '@type': 'Restaurant',
  name: restaurant.name.es,
  telephone: restaurant.phone.href.replace('tel:', ''),
  address: {
    '@type': 'PostalAddress',
    streetAddress: restaurant.address,
  },
  sameAs: [restaurant.instagram, restaurant.facebook],
  hasMenu: {
    '@type': 'Menu',
    hasMenuSection: categories.value
      .filter((c) => c.type === 'productos')
      .map((c) => ({ '@type': 'MenuSection', name: c.name.es, hasMenuItem: productsOf(c.id).map(item) })),
  },
});

/**
 * Dibuja la carta en el servidor con los datos del momento: se ve al instante,
 * también sin JavaScript, y nunca incluye productos ocultos.
 */
export function render(menu: MenuData): { html: string; head: string } {
  setMenu(menu);
  lang.value = 'es';
  category.value = ALL;
  query.value = '';
  searchOpen.value = false;
  sectionInView.value = null;

  const first = products.value.find((p) => p.featured) ?? products.value[0];
  const image = first && (first.media.video ? first.media.poster : (first.media.photo ?? first.media.poster));
  const preload = image
    ? `<link rel="preload" as="image" fetchpriority="high" imagesrcset="${image.srcset}" imagesizes="(min-width: 820px) 480px, 100vw">`
    : '';
  const json = JSON.stringify(structuredData()).replaceAll('<', '\\u003c');
  return { html: renderToString(<App />), head: `${preload}<script type="application/ld+json">${json}</script>` };
}
