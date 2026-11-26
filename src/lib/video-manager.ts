/**
 * Decide qué vídeo se reproduce. Reglas:
 *  - Nunca más de uno a la vez: gana el más visible y, a igualdad, el más centrado.
 *  - Nada se descarga hasta que al vídeo le toca reproducirse.
 *  - Con ahorro de datos, conexión 2G o movimiento reducido no arranca nada solo.
 *  - Si el cliente pausa un vídeo, se respeta hasta que salga de la pantalla.
 *  - Si el navegador bloquea la reproducción automática, queda el botón de reproducir.
 */
export type VideoState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface Entry {
  video: HTMLVideoElement;
  sources: { high: string; low: string };
  ratio: number;
  pausedByUser: boolean;
  failed: boolean;
  onState: (state: VideoState) => void;
}

interface NetworkInfo {
  saveData?: boolean;
  effectiveType?: string;
}

const VISIBLE_ENOUGH = 0.55;

const entries = new Map<Element, Entry>();
let observer: IntersectionObserver | undefined;
let active: Entry | undefined;
let autoplayBlocked = false;
let scheduled = false;

const network = (): NetworkInfo => (navigator as Navigator & { connection?: NetworkInfo }).connection ?? {};

export function autoplayAllowed(): boolean {
  const { saveData, effectiveType = '' } = network();
  if (saveData || effectiveType.includes('2g')) return false;
  return (
    !matchMedia('(prefers-reduced-motion: reduce)').matches && !matchMedia('(prefers-reduced-data: reduce)').matches
  );
}

function blockAutoplay(blocked: boolean): void {
  autoplayBlocked = blocked;
  document.documentElement.classList.toggle('no-autoplay', blocked || !autoplayAllowed());
}

/** La versión ligera basta para marcos pequeños, conexiones 3G o ahorro de datos. */
function pickSource({ video, sources }: Entry): string {
  const { saveData, effectiveType } = network();
  const slow = saveData || /2g|3g/.test(effectiveType ?? '');
  const pixels = video.clientWidth * Math.min(devicePixelRatio, 2);
  return slow || pixels <= 520 ? sources.low : sources.high;
}

function stop(entry: Entry): void {
  if (!entry.video.paused) entry.video.pause();
  if (active === entry) active = undefined;
}

async function start(entry: Entry, byUser: boolean): Promise<void> {
  if (active && active !== entry) stop(active);
  active = entry;
  const { video } = entry;
  if (!video.getAttribute('src')) {
    video.src = pickSource(entry);
    entry.onState('loading');
  }
  try {
    video.muted = true; // imprescindible para que iOS permita la reproducción automática
    await video.play();
  } catch (error) {
    // AbortError: otro vídeo tomó el turno antes de arrancar. No es un fallo.
    if ((error as DOMException).name === 'NotAllowedError' && !byUser) blockAutoplay(true);
    if (active === entry) active = undefined;
    if (!entry.failed) entry.onState('paused');
  }
}

function choose(): void {
  scheduled = false;
  if (document.hidden) return;
  const centre = innerHeight / 2;
  const distance = (e: Entry) => {
    const box = e.video.getBoundingClientRect();
    return Math.abs(box.top + box.height / 2 - centre);
  };
  const best = [...entries.values()]
    .filter((e) => e.ratio >= VISIBLE_ENOUGH && !e.pausedByUser && !e.failed)
    .sort((a, b) => Math.round(b.ratio * 10) - Math.round(a.ratio * 10) || distance(a) - distance(b))[0];

  // Un vídeo puesto en marcha a mano sigue mientras siga a la vista.
  if (active && active.ratio >= VISIBLE_ENOUGH && (!best || best === active || !autoplayAllowed())) return;
  if (active && active !== best) stop(active);
  if (best && best !== active && autoplayAllowed() && !autoplayBlocked) void start(best, false);
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(choose);
}

function onIntersect(changes: IntersectionObserverEntry[]): void {
  for (const change of changes) {
    const entry = entries.get(change.target);
    if (!entry) continue;
    entry.ratio = change.isIntersecting ? change.intersectionRatio : 0;
    if (entry.ratio === 0) {
      entry.pausedByUser = false;
      stop(entry);
    }
  }
  schedule();
}

export function register(
  video: HTMLVideoElement,
  sources: Entry['sources'],
  onState: Entry['onState'],
): () => void {
  if (!observer) {
    // Margen superior: la barra fija tapa esa franja y no cuenta como visible.
    observer = new IntersectionObserver(onIntersect, {
      rootMargin: '-64px 0px 0px 0px',
      threshold: [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1],
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && active) stop(active);
      else schedule();
    });
    addEventListener('scrollend', schedule, { passive: true });
    blockAutoplay(false);
  }

  const entry: Entry = { video, sources, ratio: 0, pausedByUser: false, failed: false, onState };
  const listeners: [string, () => void][] = [
    ['playing', () => onState('playing')],
    ['waiting', () => onState('loading')],
    ['pause', () => onState('paused')],
    ['error', () => {
      if (!video.getAttribute('src')) return;
      entry.failed = true;
      stop(entry);
      onState('error');
      schedule();
    }],
  ];
  for (const [name, fn] of listeners) video.addEventListener(name, fn);
  entries.set(video, entry);
  observer.observe(video);

  return () => {
    stop(entry);
    for (const [name, fn] of listeners) video.removeEventListener(name, fn);
    observer?.unobserve(video);
    entries.delete(video);
  };
}

/** Botón de reproducir / pausar. */
export function toggle(video: HTMLVideoElement): void {
  const entry = entries.get(video);
  if (!entry) return;
  if (video.paused) {
    blockAutoplay(false);
    entry.pausedByUser = false;
    void start(entry, true);
  } else {
    entry.pausedByUser = true;
    stop(entry);
  }
}
