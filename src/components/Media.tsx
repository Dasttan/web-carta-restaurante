import { useEffect, useRef, useState } from 'preact/hooks';
import type { ImageAsset, Product } from '../lib/menu';
import { t, tr } from '../lib/i18n';
import { scroller } from '../lib/scroll';
import { register, toggle, type VideoState } from '../lib/video-manager';
import { IconPause, IconPlay } from './Icons';

interface Props {
  product: Product;
  sizes: string;
  /** Solo la primera imagen visible de la carta se carga con prioridad. */
  eager?: boolean;
}

/** Foto o vídeo de un plato. */
export function Media({ product, sizes, eager = false }: Props) {
  const { poster, photo, video } = product.media;
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<VideoState>('idle');
  const [showPhoto, setShowPhoto] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [near, setNear] = useState(false);
  const name = tr(product.name);

  useEffect(() => {
    const el = videoRef.current;
    if (el && video) return register(el, video, setState);
  }, [video]);

  // La carga diferida del navegador llega tarde dentro de un desplazamiento propio:
  // se adelantan las imágenes de los dos platos siguientes para que no haya huecos.
  useEffect(() => {
    const root = scroller();
    if (eager || !frameRef.current || root === document.documentElement) return;
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), {
      root,
      rootMargin: '200% 0px',
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [eager]);

  const still = video ? poster : (photo ?? poster);
  const size = still ?? (video ? { width: 720, height: 1280 } : null);

  if (!size || (imageFailed && !video)) {
    return (
      <div class="media media--type" aria-hidden="true">
        <div class="media__frame" ref={frameRef}>
          <span>{name}</span>
        </div>
      </div>
    );
  }

  const playing = state === 'playing' || state === 'loading';

  return (
    <div class="media" data-state={state} data-photo={showPhoto || undefined} style={{ '--w': size.width, '--h': size.height }}>
      <div class="media__frame" ref={frameRef}>
        {still && (
          <Picture
            asset={still}
            alt={t('photoOf', { name })}
            sizes={sizes}
            eager={eager || near}
            first={eager}
            onError={() => setImageFailed(true)}
          />
        )}
        {video && (
          <video
            ref={videoRef}
            muted
            loop
            playsInline
            preload="none"
            disablePictureInPicture
            width={size.width}
            height={size.height}
            aria-label={t('videoOf', { name })}
          />
        )}
        {showPhoto && photo && (
          <Picture asset={photo} alt={t('photoOf', { name })} sizes={sizes} eager extra="media__photo" />
        )}
        {state === 'error' && <p class="media__error">{t('videoError')}</p>}
      </div>
      {video && (
        <div class="media__controls">
          {photo && (
            <button type="button" class="media__switch" onClick={() => setShowPhoto(!showPhoto)}>
              {t(showPhoto ? 'showVideo' : 'showPhoto')}
            </button>
          )}
          {state !== 'error' && !showPhoto && (
            <button
              type="button"
              class="media__play"
              aria-label={t(playing ? 'pause' : 'play', { name })}
              onClick={() => videoRef.current && toggle(videoRef.current)}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface PictureProps {
  asset: ImageAsset;
  alt: string;
  sizes: string;
  eager: boolean;
  first?: boolean;
  extra?: string;
  onError?: () => void;
}

function Picture({ asset, alt, sizes, eager, first, extra, onError }: PictureProps) {
  return (
    <img
      class={extra}
      loading={eager ? 'eager' : 'lazy'}
      src={asset.src}
      srcset={asset.srcset}
      sizes={sizes}
      width={asset.width}
      height={asset.height}
      alt={alt}
      fetchpriority={first ? 'high' : 'auto'}
      decoding="async"
      onError={onError}
    />
  );
}
