import './styles/main.css';
import './styles/slides.css';
import { render } from 'preact';
import { App } from './components/App';
import { applyLang, detectLang } from './lib/i18n';
import { refreshMenu, setMenu } from './lib/menu';
import { readLocation, revealHash } from './lib/navigation';

setMenu(JSON.parse(document.getElementById('carta-data')!.textContent!));
applyLang(detectLang());
readLocation();
render(<App />, document.getElementById('app')!);
document.documentElement.classList.remove('is-booting');
revealHash();

// Al volver a la pestaña (p. ej. el móvil sobre la mesa) se comprueba si la carta ha cambiado.
let checkedAt = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden || Date.now() - checkedAt < 30_000) return;
  checkedAt = Date.now();
  void refreshMenu();
});

addEventListener('popstate', () => {
  readLocation();
  revealHash();
});
