import { signal } from '@preact/signals';
import { t } from './i18n';

export const toast = signal('');
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string): void {
  toast.value = message;
  clearTimeout(timer);
  timer = setTimeout(() => (toast.value = ''), 2600);
}

async function copy(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Navegadores antiguos o páginas sin HTTPS.
    const field = document.createElement('textarea');
    field.value = url;
    field.style.cssText = 'position:fixed;opacity:0';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  }
}

/** Menú de compartir del móvil; si no existe, copia el enlace. */
export async function share(title: string, url: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return;
    }
  }
  showToast((await copy(url)) ? t('linkCopied') : t('copyFailed'));
}
