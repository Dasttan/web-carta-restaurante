import { useEffect, useRef } from 'preact/hooks';
import { t } from '../lib/i18n';
import { ALL, category, query, sectionInView } from '../lib/navigation';
import { stepWithWheel } from '../lib/scroll';
import { TopBar } from './TopBar';
import { Menu } from './Menu';
import { BackToTop, Footer, Toast } from './Footer';

export function App() {
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => stepWithWheel(pageRef.current!), []);

  // En móvil la carta va plato a plato; los resultados de búsqueda son una lista normal.
  const view = query.value.trim() ? 'lista' : 'carta';
  // Sobre la hoja de extras la cabecera es opaca: ahí se mezclarían los textos.
  const section = category.value === ALL ? sectionInView.value : category.value;
  return (
    <div class="page" data-view={view} data-section={section ?? undefined} ref={pageRef}>
      <a class="skip" href="#carta">
        {t('skip')}
      </a>
      <TopBar />
      <Menu />
      <Footer />
      <BackToTop />
      <Toast />
    </div>
  );
}
