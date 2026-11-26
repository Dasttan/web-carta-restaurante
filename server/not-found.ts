/** Página 404 con la marca: avisa y, a los pocos segundos, lleva sola a la carta. */
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.ts';
import { LANGS, restaurant } from './repo.ts';

type Key = 'notFoundTitle' | 'notFoundText' | 'notFoundRedirect' | 'notFoundButton';
const texts: Record<Key, Record<string, string>> = JSON.parse(readFileSync(join(ROOT, 'src/data/textos.json'), 'utf8'));

const SECONDS = 6;
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

export function sendNotFound(req: Request, res: Response): void {
  res.status(404);
  // Fotos, scripts o programas reciben un aviso corto; las personas, la página.
  if (req.method !== 'GET' || !req.get('accept')?.includes('text/html')) return void res.type('text/plain').send('No encontrado');

  const lang = req.acceptsLanguages(...LANGS) || 'es';
  const t = (key: Key) => escape(texts[key][lang]);
  const name = escape(restaurant.name[lang as 'es']);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.vary('Accept-Language');
  res.type('html').send(`<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta http-equiv="refresh" content="${SECONDS};url=/" />
    <title>404 | ${name}</title>
    <link rel="icon" href="/brand/icono-48.png" sizes="48x48" type="image/png" />
    <link rel="stylesheet" href="/404.css" />
  </head>
  <body>
    <main>
      <img src="/brand/logotipo.svg" width="112" height="112" alt="${name}" />
      <p class="code">404</p>
      <h1>${t('notFoundTitle')}</h1>
      <p>${t('notFoundText')}</p>
      <a href="/">${t('notFoundButton')}</a>
      <p class="note">${t('notFoundRedirect').replace('{n}', String(SECONDS))}</p>
    </main>
  </body>
</html>
`);
}
