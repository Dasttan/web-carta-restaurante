import type { Product } from '../lib/menu';
import { allergenNames, restaurant } from '../lib/menu';
import { formatPrice, t, tr } from '../lib/i18n';
import { shareUrl } from '../lib/navigation';
import { share } from '../lib/share';
import { Media } from './Media';
import { IconShare } from './Icons';

export type Variant = 'grande' | 'compacta' | 'destacada';

const SIZES: Record<Variant, string> = {
  destacada: '(min-width: 820px) 480px, 100vw',
  grande: '(min-width: 820px) 400px, 100vw',
  compacta: '(min-width: 820px) 210px, 100vw',
};

interface Props {
  product: Product;
  variant: Variant;
  eager?: boolean;
}

/** Un único componente para todos los platos; `variant` solo cambia la composición. */
export function ProductCard({ product, variant, eager }: Props) {
  const name = tr(product.name);
  const titleId = `${product.slug}-nombre`;
  const isFeatured = variant === 'destacada';
  // Si el plato ya se llama «Burguer del mes», la etiqueta no lo repite.
  const badge = name === t('burgerOfMonth') ? t('specialEdition') : t('burgerOfMonth');

  return (
    <article
      id={product.slug}
      class={`product product--${variant}${product.available ? '' : ' is-unavailable'}`}
      aria-labelledby={titleId}
      data-anchor
    >
      <header class="product__head">
        {isFeatured && <p class="badge">{badge}</p>}
        <h3 id={titleId} class="product__name">
          {name}
        </h3>
        <p class="price">{formatPrice(product.price)}</p>
      </header>

      <Media product={product} sizes={SIZES[variant]} eager={eager} />

      <div class="product__info">
        <p class="product__text">{tr(product.description)}</p>
        <Facts product={product} />
        {product.modificationRestrictions && <p class="product__rule">{t('noChanges')}</p>}
        <Allergens product={product} />
      </div>

      <button
        type="button"
        class="text-button product__share"
        aria-label={`${t('share')}: ${name}`}
        onClick={() => share(`${name} · ${tr(restaurant.name)}`, shareUrl(product.slug))}
      >
        <IconShare />
        <span>{t('share')}</span>
      </button>
    </article>
  );
}

function Facts({ product }: { product: Product }) {
  const facts = [
    !product.available && t('unavailable'),
    product.includesFries && t('fries'),
    product.units && t('units', { n: product.units }),
    product.servings && t('servings', { n: product.servings }),
  ].filter((f): f is string => Boolean(f));
  if (!facts.length) return null;
  return (
    <ul class="facts">
      {facts.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
}

function Allergens({ product }: { product: Product }) {
  const { allergens, allergensPendingReview } = product;
  return (
    <div class="allergens">
      <h4>{t('allergens')}</h4>
      {allergens ? (
        <p>{allergens.map((id) => tr(allergenNames[id])).join(', ') || t('allergensNone')}</p>
      ) : (
        <p class="allergens__note">{t('allergensMissing')}</p>
      )}
      {allergens && allergensPendingReview && <p class="allergens__note">{t('allergensReview')}</p>}
    </div>
  );
}
