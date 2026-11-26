import { useEffect, useRef, useState } from 'preact/hooks';
import { legalPages, restaurant } from '../lib/menu';
import { lang, t, tr } from '../lib/i18n';
import { scrollToTop } from '../lib/scroll';
import { toast } from '../lib/share';
import { IconAlert, IconClose, IconFacebook, IconInstagram, IconPhone, IconPin, IconUp } from './Icons';

interface Partner {
  name: string;
  logo: string;
  width: number;
  height: number;
}
const partners: Partner[] = restaurant.partners;

export function Footer() {
  const [openId, setOpenId] = useState<string | null>(null);
  const external = { target: '_blank', rel: 'noopener' };

  return (
    <footer class="footer">
      <p class="notice">
        <IconAlert />
        <span>
          <strong>{t('allergyTitle')}</strong> {t('allergyNotice')}
        </span>
      </p>

      <div class="footer__main">
        <img class="footer__logo" src="/brand/logotipo.svg" width="112" height="112" alt={tr(restaurant.name)} loading="lazy" />
        <address class="footer__contact">
          <h2 class="visually-hidden">{t('contact')}</h2>
          <a href={restaurant.phone.href}>
            <IconPhone />
            <span class="visually-hidden">{t('call')}: </span>
            {restaurant.phone.display}
          </a>
          <a href={restaurant.maps} {...external}>
            <IconPin />
            <span>{restaurant.address}</span>
            <span class="visually-hidden">
              , {t('map')} ({t('newTab')})
            </span>
          </a>
          <a href={restaurant.instagram} {...external}>
            <IconInstagram />
            Instagram
            <span class="visually-hidden"> ({t('newTab')})</span>
          </a>
          <a href={restaurant.facebook} {...external}>
            <IconFacebook />
            Facebook
            <span class="visually-hidden"> ({t('newTab')})</span>
          </a>
        </address>
        <p class="footer__slogan">{tr(restaurant.name)}</p>
      </div>

      {partners.length > 0 && (
        <ul class="footer__partners">
          {partners.map((p) => (
            <li key={p.name}>
              <img src={p.logo} width={p.width} height={p.height} alt={p.name} loading="lazy" />
            </li>
          ))}
        </ul>
      )}

      <p class="footer__sample">{t('sample')}</p>

      <ul class="footer__legal">
        <li>© {tr(restaurant.name)}</li>
        {legalPages.map((page) => (
          <li key={page.id}>
            <button type="button" onClick={() => setOpenId(page.id)}>
              {tr(page.title)}
            </button>
          </li>
        ))}
      </ul>

      <LegalDialog id={openId} onClose={() => setOpenId(null)} />
    </footer>
  );
}

function LegalDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const page = legalPages.find((p) => p.id === id);

  useEffect(() => {
    if (page && !ref.current?.open) ref.current?.showModal();
  }, [page]);

  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby="titulo-legal"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
    >
      {page && (
        <div class="dialog__body">
          <div class="dialog__head">
            <h2 id="titulo-legal">{tr(page.title)}</h2>
            <button type="button" class="icon-button" aria-label={t('close')} onClick={() => ref.current?.close()}>
              <IconClose />
            </button>
          </div>
          {page.paragraphs[lang.value].map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      )}
    </dialog>
  );
}

export function Toast() {
  return (
    <p class={`toast${toast.value ? ' is-visible' : ''}`} role="status">
      {toast.value}
    </p>
  );
}

export function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // Solo al subir: mientras se lee hacia abajo no tapa precios ni textos.
    let last = scrollY;
    const onScroll = () => {
      const y = scrollY;
      if (Math.abs(y - last) < 8) return;
      setVisible(y < last && y > innerHeight * 1.5);
      last = y;
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);
  return (
    <button
      type="button"
      class={`to-top${visible ? ' is-visible' : ''}`}
      aria-label={t('backToTop')}
      tabIndex={visible ? 0 : -1}
      onClick={() => scrollToTop(true)}
    >
      <IconUp />
    </button>
  );
}
