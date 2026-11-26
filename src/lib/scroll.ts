/**
 * En el móvil la carta se desplaza dentro de `.page`, plato a plato; en pantallas
 * grandes se desplaza la página. El resto del código no necesita saber cuál es.
 */
export function scroller(): HTMLElement {
  const page = document.querySelector<HTMLElement>('.page');
  return page && getComputedStyle(page).overflowY === 'auto' ? page : document.documentElement;
}

export function scrollToTop(smooth: boolean): void {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  scroller().scrollTo({ top: 0, behavior: smooth && !calm ? 'smooth' : 'instant' });
}

/**
 * Con el dedo, el navegador ya engancha de plato en plato. Una rueda de ratón avanza
 * tan poco que volvería atrás, así que cada gesto de rueda equivale a un plato.
 */
export function stepWithWheel(page: HTMLElement): () => void {
  let busyUntil = 0;
  let lastEvent = 0;

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (scroller() !== page || page.dataset.view !== 'carta') return;

    const direction = Math.sign(e.deltaY);
    const stops = [...page.querySelectorAll<HTMLElement>('.product, .section--extras, .footer')];
    const box = page.getBoundingClientRect().top;
    const topOf = (el: HTMLElement) => el.getBoundingClientRect().top - box;
    let index = 0;
    stops.forEach((el, i) => {
      if (topOf(el) <= 4) index = i;
    });

    // Una sección más alta que la pantalla se lee entera antes de pasar a la siguiente.
    const current = stops[index];
    const top = topOf(current);
    const hiddenBelow = top + current.offsetHeight - page.clientHeight;
    if (direction > 0 ? hiddenBelow > 4 : top < -4) return;

    e.preventDefault();
    const now = performance.now();
    const sameGesture = now - lastEvent < 140; // inercia de un panel táctil
    lastEvent = now;
    if (now < busyUntil || (sameGesture && busyUntil && now < busyUntil + 400)) return;

    const next = stops[index + direction];
    if (!next) return;
    busyUntil = now + 550;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    next.scrollIntoView({ block: direction > 0 ? 'start' : 'nearest', behavior: calm ? 'instant' : 'smooth' });
  };

  page.addEventListener('wheel', onWheel, { passive: false });
  return () => page.removeEventListener('wheel', onWheel);
}
