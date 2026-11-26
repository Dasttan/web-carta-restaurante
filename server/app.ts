/** Rutas: carta pública, API pública, API de administración y panel. */
import compression from 'compression';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { Auth, type Session } from './auth.ts';
import { config, ROOT } from './config.ts';
import { backupDb, stamp, type Db } from './db.ts';
import { deleteFiles, receive } from './media.ts';
import { sendNotFound } from './not-found.ts';
import { allergenNames, LANGS, Repo, restaurant } from './repo.ts';
import { HttpError, parseImport, parseProduct } from './validate.ts';

type Renderer = (menu: unknown) => { html: string; head: string };

interface Parts {
  db: Db;
  repo: Repo;
  auth: Auth;
  vite?: ViteDevServer;
}

const ADMIN_PATH = '/superuser';

export async function createApp({ db, repo, auth, vite }: Parts) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const template = vite ? '' : readFileSync(join(config.distDir, 'client/index.html'), 'utf8');
  const adminTemplate = vite ? '' : readFileSync(join(config.distDir, 'client/superuser.html'), 'utf8');
  const prodRender: Renderer | null = vite
    ? null
    : (await import(new URL(`file:///${join(config.distDir, 'server/entry-server.js').replaceAll('\\', '/')}`).href)).render;

  /* ---------- Cabeceras de seguridad ---------- */

  const inlineHashes = [...template.matchAll(/<script(?![^>]*\b(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${createHash('sha256').update(m[1].replace(/\r\n/g, '\n')).digest('base64')}'`)
    .join(' ');
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${inlineHashes}`.trim(),
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'", // proporciones de cada foto (style="--w:…")
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (!vite) res.setHeader('Content-Security-Policy', csp);
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(compression());

  /* ---------- API pública: solo productos publicados ---------- */

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache');
    next();
  });
  api.get('/products', (_req, res) => void res.json(repo.publicMenu()));
  api.get('/products/:slug', (req, res) => {
    const product = repo.publicBySlug(req.params.slug);
    if (!product) throw new HttpError(404, 'Ese producto no está en la carta.');
    res.json(product);
  });

  /* ---------- API de administración ---------- */

  const admin = express.Router();
  const json = express.json({ limit: '100kb', strict: true });

  admin.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const expected = config.publicOrigin || `${req.protocol}://${req.get('host')}`;
      const origin = req.get('origin');
      const site = req.get('sec-fetch-site');
      if ((origin && origin !== expected) || (site && site !== 'same-origin'))
        throw new HttpError(403, 'La petición no viene del panel.');
    }
    next();
  });

  const sessionView = (s: Session) => ({ username: s.username, csrf: s.csrf, mustChange: s.mustChange });

  admin.post('/login', json, async (req, res) => void res.json(sessionView(await auth.login(req, res))));
  admin.get('/session', (req, res) => {
    const session = auth.session(req);
    res.json({ session: session ? sessionView(session) : null, restaurant: restaurant.name });
  });

  // A partir de aquí, todo exige sesión; y los cambios, además, el código CSRF.
  admin.use((req, res, next) => {
    const session = auth.session(req);
    if (!session) throw new HttpError(401, 'Tu sesión ha caducado. Vuelve a entrar.');
    if (req.method !== 'GET' && req.method !== 'HEAD' && !auth.csrfOk(session, req.headers['x-csrf-token']))
      throw new HttpError(403, 'La petición no se ha podido verificar. Recarga la página.');
    res.locals.session = session;
    next();
  });

  admin.post('/logout', (_req, res) => {
    auth.logout(res.locals.session, res);
    res.json({ ok: true });
  });
  admin.post('/change-password', json, async (req, res) => {
    res.json(sessionView(await auth.changePassword(res.locals.session, req.body, req, res)));
  });

  admin.get('/options', (_req, res) => void res.json({ languages: LANGS, categories: repo.categories(), allergens: allergenNames,
    limits: { imageMb: config.maxImageBytes / 1048576, videoMb: config.maxVideoBytes / 1048576 } }));

  admin.get('/products', (_req, res) => void res.json({ products: repo.adminList() }));
  admin.get('/products/:id', (req, res) => void res.json(repo.adminGet(req.params.id)));
  admin.post('/products', json, (req, res) => {
    const { input } = parseProduct(req.body, 'create');
    res.status(201).json(repo.adminGet(repo.create(input)));
  });
  admin.patch('/products/:id', json, (req, res) => {
    const { input, version } = parseProduct(req.body, 'update');
    repo.update(req.params.id as string, input, version);
    res.json(repo.adminGet(req.params.id as string));
  });
  admin.patch('/products/:id/status', json, (req, res) => {
    if (typeof req.body?.isPublished !== 'boolean') throw new HttpError(422, 'Indica si el producto se publica o se oculta.');
    repo.update(req.params.id as string, { isPublished: req.body.isPublished }, undefined);
    res.json(repo.adminGet(req.params.id as string));
  });
  admin.post('/products/:id/move', json, (req, res) => {
    if (req.body?.direction !== 'up' && req.body?.direction !== 'down') throw new HttpError(422, 'Indica hacia dónde mover el producto.');
    repo.move(req.params.id as string, req.body.direction);
    res.json({ products: repo.adminList() });
  });
  admin.delete('/products/:id', (req, res) => {
    repo.adminGet(req.params.id); // 404 antes de copiar nada
    snapshot('antes-de-borrar', repo);
    res.json({ name: repo.remove(req.params.id) });
  });

  admin.get('/media', (req, res) => {
    const kind = req.query.kind === 'image' || req.query.kind === 'video' ? req.query.kind : undefined;
    res.json({ media: repo.mediaList(kind) });
  });
  admin.get('/media/:id', (req, res) => {
    const m = repo.media(req.params.id);
    if (!m) throw new HttpError(404, 'Ese archivo ya no existe.');
    res.json(repo.mediaView(m));
  });
  admin.post('/media', async (req, res) => {
    const id = await receive(req, repo);
    const view = repo.mediaView(repo.media(id)!);
    res.status(view.status === 'ready' ? 201 : 202).json(view);
  });
  admin.delete('/media/:id', async (req, res) => {
    const removed = repo.removeMedia(req.params.id);
    await deleteFiles(removed.files);
    res.json({ ok: true });
  });

  admin.get('/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="carta-${stamp()}.json"`);
    res.type('application/json').send(JSON.stringify(repo.export(), null, 2));
  });
  admin.post('/import', express.json({ limit: '20mb', strict: true }), (req, res) => {
    const data = parseImport(req.body);
    const published = data.products.filter((p) => p.is_published).length;
    const summary = { products: data.products.length, published, hidden: data.products.length - published, current: repo.adminList().length };
    if (req.query.confirmar !== 'si') return void res.json({ applied: false, ...summary });
    const file = `antes-de-restaurar-${stamp()}.db`;
    backupDb(db, join(config.backupDir, file));
    repo.import(data);
    res.json({ applied: true, backup: file, ...summary });
  });

  api.use('/admin', admin);
  app.use('/api', api);
  app.use('/api', () => {
    throw new HttpError(404, 'No existe.');
  });

  /* ---------- Archivos ---------- */

  app.use(
    '/media',
    express.static(config.mediaDir, { index: false, dotfiles: 'deny', maxAge: '1d' }),
    ((_req, res) => void res.status(404).type('text/plain').send('No encontrado')) as RequestHandler,
  );

  /* ---------- Panel ---------- */

  app.get(/^\/superuser(?:\/.*)?$/, async (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const logged = Boolean(auth.session(req));
    const atLogin = req.path.replace(/\/$/, '') === `${ADMIN_PATH}/login`;
    if (!logged && !atLogin) return void res.redirect(302, `${ADMIN_PATH}/login`);
    if (logged && atLogin) return void res.redirect(302, ADMIN_PATH);
    const html = vite
      ? await vite.transformIndexHtml(req.originalUrl, readFileSync(join(ROOT, 'superuser.html'), 'utf8'))
      : adminTemplate;
    res.type('html').send(html);
  });

  /* ---------- Carta pública, ya dibujada con los datos actuales ---------- */

  let cached = { revision: '', html: '' };
  const page = async (url: string): Promise<string> => {
    if (!vite && cached.revision === repo.revision) return cached.html;
    const revision = repo.revision;
    const menu = repo.publicMenu();
    const source = vite ? await vite.transformIndexHtml(url, readFileSync(join(ROOT, 'index.html'), 'utf8')) : template;
    const render = prodRender ?? ((await vite!.ssrLoadModule('/src/entry-server.tsx')).render as Renderer);
    const { html, head } = render(menu);
    const data = JSON.stringify(menu).replaceAll('<', '\\u003c');
    const result = source
      .replace('<!--head-->', () => head)
      .replace('<!--app-->', () => html)
      .replace('<!--data-->', () => `<script type="application/json" id="carta-data">${data}</script>`);
    if (!vite) cached = { revision, html: result };
    return result;
  };
  app.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(await page(req.originalUrl));
  });

  if (vite) app.use(vite.middlewares);
  else {
    app.use((req, res, next) => (req.path.endsWith('.html') ? sendNotFound(req, res) : next()));
    app.use('/assets', express.static(join(config.distDir, 'client/assets'), { index: false, immutable: true, maxAge: '1y' }));
    app.use(express.static(join(config.distDir, 'client'), { index: false, dotfiles: 'deny', maxAge: '1d' }));
  }
  app.use(sendNotFound);

  /* ---------- Errores: claros para quien usa el panel, sin detalles internos ---------- */

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return void res.destroy();
    let status = 500;
    let message = 'Algo ha fallado. Inténtalo de nuevo.';
    let fields: Record<string, string> | undefined;
    if (err instanceof HttpError) ({ status, message, fields } = err);
    else if (err?.type === 'entity.too.large') [status, message] = [413, 'Has enviado demasiados datos.'];
    else if (err?.type === 'entity.parse.failed') [status, message] = [400, 'La petición no es válida.'];
    else if (err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || err?.code === 'ECONNRESET') return void res.destroy();
    else if (typeof err?.status === 'number' && err.status < 500) [status, message] = [err.status, 'La petición no es válida.'];
    else console.error(`${req.method} ${req.path}:`, err);
    if (!req.readableEnded && status >= 400 && req.method === 'POST') res.setHeader('Connection', 'close');
    if (req.path.startsWith('/api')) res.status(status).json({ error: message, fields });
    else if (status < 500) sendNotFound(req, res); // direcciones mal escritas
    else res.status(status).type('text/plain').send(message);
  });

  return app;
}

/** Copia en JSON antes de una operación definitiva. Se guardan las 30 últimas. */
function snapshot(reason: string, repo: Repo): void {
  writeFileSync(join(config.backupDir, `${reason}-${stamp()}.json`), JSON.stringify(repo.export(), null, 2));
  const old = readdirSync(config.backupDir).filter((f) => f.startsWith(reason)).sort().slice(0, -30);
  for (const f of old) rmSync(join(config.backupDir, f), { force: true });
}
