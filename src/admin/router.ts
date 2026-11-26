/** Navegación del panel, con aviso si hay cambios sin guardar. */
import { signal } from '@preact/signals';
import { confirmDialog } from './ui';

export const BASE = '/superuser';
export const path = signal(location.pathname);
/** Lo activa el formulario mientras haya algo sin guardar. */
export const dirty = signal(false);

const leaveOk = () =>
  confirmDialog({
    title: 'Hay cambios sin guardar',
    message: 'Si sales ahora, se perderán.',
    confirmLabel: 'Salir sin guardar',
    cancelLabel: 'Seguir editando',
    danger: true,
  });

export async function go(to: string, force = false): Promise<void> {
  if (!force && dirty.value && !(await leaveOk())) return;
  dirty.value = false;
  if (to !== location.pathname) history.pushState(null, '', to);
  path.value = to;
  scrollTo(0, 0);
}

addEventListener('popstate', async () => {
  const target = location.pathname;
  if (dirty.value) {
    history.pushState(null, '', path.value);
    if (!(await leaveOk())) return;
    dirty.value = false;
    history.pushState(null, '', target);
  }
  path.value = target;
});

addEventListener('beforeunload', (e) => {
  if (dirty.value) e.preventDefault();
});

/** Enlaces del panel: funcionan como enlaces normales y también sin recargar. */
export const linkTo = (to: string) => ({
  href: to,
  onClick: (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    void go(to);
  },
});
