/**
 * Pruebas de extremo a extremo sobre el servidor real, con datos en una carpeta temporal:
 * nunca tocan la carta del restaurante.   npm test
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'carta-pruebas-'));
const DATA = join(work, 'data');
const DEV_PASSWORD = 'admin'; // la de desarrollo: solo existe en este entorno temporal
const NEW_PASSWORD = 'pruebas-Muy-Largas-42';

let port = 0;
let base = '';
let server: ChildProcess | undefined;
let log = '';

const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, 'localhost', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

function launch(env: Record<string, string>, file = 'server/index.ts') {
  return spawn(process.execPath, ['--disable-warning=ExperimentalWarning', file], {
    cwd: ROOT,
    env: { ...process.env, CARTA_IGNORAR_ENV: '1', NODE_ENV: '', DATA_DIR: DATA, PORT: String(port), ADMIN_USER: 'admin', ADMIN_PASSWORD: DEV_PASSWORD, ...env },
  });
}
async function start() {
  log = '';
  server = launch({});
  server.stdout!.on('data', (d) => (log += d));
  server.stderr!.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/api/products`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`El servidor no arranca: ${log}`);
}
async function stop() {
  const p = server!;
  if (p.exitCode !== null) return;
  await new Promise((ok) => {
    p.once('exit', ok);
    p.kill('SIGTERM');
  });
}
/** Arranca en modo producción y devuelve lo que dice al negarse (o null si sigue en marcha). */
async function refusal(env: Record<string, string>): Promise<string | null> {
  const p = launch(env, 'server/produccion.ts');
  let out = '';
  p.stdout!.on('data', (d) => (out += d));
  p.stderr!.on('data', (d) => (out += d));
  const code = await Promise.race([new Promise((ok) => p.once('exit', ok)), new Promise((ok) => setTimeout(() => ok('vivo'), 6000))]);
  if (code === 'vivo') {
    p.kill('SIGTERM');
    await new Promise((ok) => p.once('exit', ok));
    return null;
  }
  return out;
}

/** Un navegador sencillo: guarda la cookie y el código CSRF. */
class Client {
  cookie = '';
  csrf = '';
  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const raw = body instanceof Uint8Array;
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie()[0];
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* no es JSON */
    }
    if (data?.csrf) this.csrf = data.csrf;
    return { status: res.status, data, headers: res.headers, setCookie: set ?? '' };
  }
  login = (password: string, username = 'admin') => this.call('POST', '/api/admin/login', { username, password });
  async upload(name: string, type: string, bytes: Uint8Array) {
    let r = await this.call('POST', `/api/admin/media?name=${encodeURIComponent(name)}`, bytes, { 'Content-Type': type });
    for (let i = 0; r.status < 300 && r.data.status === 'processing' && i < 200; i++) {
      await new Promise((ok) => setTimeout(ok, 300));
      r = await this.call('GET', `/api/admin/media/${r.data.id}`);
    }
    return r;
  }
}

const admin = new Client();
const visitor = new Client();
const menu = async () => (await visitor.call('GET', '/api/products')).data;
const inMenu = async (slug: string) => (await menu()).products.find((p: any) => p.slug === slug);
const page = async () => (await visitor.call('GET', '/')).data as string;
const readSeed = (n: string) => JSON.parse(readFileSync(join(ROOT, 'seed', `${n}.json`), 'utf8'));

function makeVideo(name: string, seconds: number, args: string[] = []): Promise<Buffer> {
  const file = join(work, name);
  return new Promise((ok, bad) => {
    spawn(ffmpegPath as unknown as string, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=360x640:rate=15:duration=${seconds}`, ...args, file])
      .once('exit', (c) => (c === 0 ? ok(readFileSync(file)) : bad(new Error('ffmpeg'))));
  });
}
const jpeg = (color: string) => sharp({ create: { width: 900, height: 1200, channels: 3, background: color } }).jpeg().toBuffer();

const PRODUCT = {
  categoryId: 'hamburguesas',
  priceCents: 1234,
  translations: { es: { name: 'Prueba Ñandú', description: 'Texto de prueba' }, en: { name: 'Test Rhea', description: 'Test text' } },
};
const id = 'prueba-nandu';

before(async () => {
  port = await freePort();
  base = `http://localhost:${port}`;
  await start();
});
after(async () => {
  await stop();
  rmSync(work, { recursive: true, force: true });
});

describe('Migración y carta pública', () => {
  test('39-40. Los productos originales llegan intactos (textos, precios, recursos, alérgenos y orden)', async () => {
    const { products, extras, categories } = await menu();
    const original = readSeed('productos');
    const medios = readSeed('medios');
    assert.equal(products.length, original.length);
    const ids = (list: any[], c: string) => list.filter((p) => p.category === c).map((p) => p.id);
    for (const c of readSeed('categorias')) {
      const expected = original.filter((p: any) => p.category === c.id).sort((a: any, b: any) => +b.featured - +a.featured || a.sortOrder - b.sortOrder);
      assert.deepEqual(ids(products, c.id), expected.map((p: any) => p.id));
    }
    for (const o of original) {
      const p = products.find((x: any) => x.id === o.id);
      for (const k of ['slug', 'category', 'name', 'description', 'price', 'allergens', 'allergensPendingReview', 'includesFries', 'modificationRestrictions', 'servings', 'units', 'featured', 'available', 'layout', 'sortOrder'])
        assert.deepEqual(p[k], o[k], `${o.id}.${k}`);
      const m = medios[o.slug];
      assert.equal(p.media.video?.high ?? null, m.video ? `/media/${o.slug}/video-720.mp4` : null);
      assert.equal(p.media.photo?.src ?? null, m.photo ? `/media/${o.slug}/foto-960.webp` : null);
      assert.equal(p.media.poster?.src ?? null, m.poster ? `/media/${o.slug}/portada-720.webp` : null);
      for (const url of [p.media.video?.high, p.media.video?.low, p.media.photo?.src, p.media.poster?.src].filter(Boolean))
        assert.equal((await fetch(base + url)).status, 200, url);
    }
    assert.deepEqual(extras, readSeed('extras'));
    assert.deepEqual(categories, readSeed('categorias'));
  });

  test('38. La página incluye la carta ya dibujada y sin enlaces al panel', async () => {
    const html = await page();
    for (const p of readSeed('productos')) assert.ok(html.includes(p.name.es), p.name.es);
    assert.ok(!html.includes('superuser'));
    const assets = [...html.matchAll(/assets\/[\w-]+\.js/g)].map((m) => m[0]);
    assert.ok(assets.length > 0);
    for (const a of assets) assert.ok(!(await (await fetch(`${base}/${a}`)).text()).includes('superuser'), a);
  });

  test('Los vídeos admiten lectura por partes (necesario en iPhone)', async () => {
    const url = (await menu()).products.find((p: any) => p.media.video).media.video.low;
    const res = await fetch(base + url, { headers: { Range: 'bytes=0-99' } });
    assert.equal(res.status, 206);
    assert.equal((await res.arrayBuffer()).byteLength, 100);
  });

  test('Una dirección que no existe muestra la página 404 y lleva a la carta', async () => {
    const get = (p: string, headers: Record<string, string> = { Accept: 'text/html', 'Accept-Language': 'es' }) => visitor.call('GET', p, undefined, headers);
    for (const p of ['/nada', '/carta/otra/cosa', '/menu.html', '/index.html', '/es/menu/', '/%E0%A4%A', '/nada?x=<script>alert(1)</script>']) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.match(r.data, /no está en la carta/, p);
      assert.match(r.data, /http-equiv="refresh" content="6;url=\/"/);
      assert.ok(!r.data.includes('alert(1)') && !r.data.includes('superuser'));
    }
    assert.match((await get('/nada', { Accept: 'text/html', 'Accept-Language': 'en-GB,en' })).data, /not on the menu/);
    assert.match((await get('/nada', { Accept: 'text/html', 'Accept-Language': 'fr' })).data, /no está en la carta/);
    assert.equal((await get('/assets/nada.js', { Accept: '*/*' })).data, 'No encontrado');
    assert.equal((await get('/api/nada')).data.error, 'No existe.');
    assert.equal((await get('/404.css', { Accept: 'text/css' })).status, 200);
  });

  test('No se sirven archivos privados', async () => {
    for (const p of ['/index.html', '/superuser.html', '/.env', '/data/carta.db', '/carta.db', '/media/%2e%2e/carta.db', '/media/..%2fcarta.db', '/server/index.ts', '/seed/productos.json', '/package.json'])
      assert.equal((await visitor.call('GET', p)).status, 404, p);
  });
});

describe('Acceso', () => {
  test('1-2. Sin sesión, /superuser lleva al inicio de sesión y no se indexa', async () => {
    for (const p of ['/superuser', '/superuser/nuevo', '/superuser/producto/doble-cheddar', '/superuser/cuenta']) {
      const r = await visitor.call('GET', p);
      assert.equal(r.status, 302, p);
      assert.equal(r.headers.get('location'), '/superuser/login');
      assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    }
    const login = await visitor.call('GET', '/superuser/login');
    assert.equal(login.status, 200);
    assert.match(login.data, /noindex, nofollow/);
  });

  test('31-32. Sin sesión, la API rechaza todo', async () => {
    const calls: [string, string, unknown?][] = [['GET', '/products'], ['GET', '/products/doble-cheddar'], ['POST', '/products', PRODUCT], ['PATCH', '/products/doble-cheddar', { priceCents: 1 }],
      ['PATCH', '/products/doble-cheddar/status', { isPublished: false }], ['DELETE', '/products/doble-cheddar'], ['POST', '/products/doble-cheddar/move', { direction: 'up' }], ['GET', '/media'],
      ['POST', '/media?name=a.jpg'], ['DELETE', '/media/doble-cheddar-foto'], ['GET', '/export'], ['POST', '/import?confirmar=si', {}], ['POST', '/change-password', {}], ['GET', '/options'], ['POST', '/logout']];
    for (const [m, p, b] of calls) assert.equal((await visitor.call(m, `/api/admin${p}`, b)).status, 401, `${m} ${p}`);
    assert.equal((await inMenu('doble-cheddar')).price, 14.5);
  });

  test('4. Una contraseña incorrecta y un usuario inexistente reciben la misma respuesta', async () => {
    const a = await new Client().login('incorrecta');
    const b = await new Client().login('incorrecta', 'otro');
    assert.equal(a.status, 401);
    assert.deepEqual([b.status, b.data], [a.status, a.data]);
  });

  test('3. El administrador entra; cookie protegida y sesión válida', async () => {
    const r = await admin.login(DEV_PASSWORD);
    assert.equal(r.status, 200);
    assert.match(r.setCookie, /HttpOnly/i);
    assert.match(r.setCookie, /SameSite=Strict/i);
    assert.equal(r.data.mustChange, true);
    assert.ok(!JSON.stringify(r.data).includes('scrypt'));
    assert.equal((await admin.call('GET', '/superuser')).status, 200);
    assert.equal((await admin.call('GET', '/superuser/login')).headers.get('location'), '/superuser');
  });

  test('CSRF: sin código, con código falso o desde otra web se rechaza', async () => {
    const path = '/api/admin/products/doble-cheddar/status';
    assert.equal((await admin.call('PATCH', path, { isPublished: false }, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await admin.call('PATCH', path, { isPublished: false }, { 'X-CSRF-Token': 'x'.repeat(32) })).status, 403);
    assert.equal((await admin.call('PATCH', path, { isPublished: false }, { Origin: 'https://otra.example' })).status, 403);
    assert.equal((await admin.call('PATCH', path, { isPublished: false }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.ok(await inMenu('doble-cheddar'));
  });

  test('6-7. Cambiar la contraseña: valida, cierra las demás sesiones e invalida la anterior', async () => {
    const other = new Client();
    await other.login(DEV_PASSWORD);
    const change = (b: object) => admin.call('POST', '/api/admin/change-password', b);
    assert.ok((await change({ current: 'mala', next: NEW_PASSWORD, confirm: NEW_PASSWORD })).data.fields.current);
    assert.ok((await change({ current: DEV_PASSWORD, next: 'corta', confirm: 'corta' })).data.fields.next);
    assert.ok((await change({ current: DEV_PASSWORD, next: '', confirm: '' })).data.fields.next);
    assert.ok((await change({ current: DEV_PASSWORD, next: 'aaaaaaaaaaaa', confirm: 'aaaaaaaaaaaa' })).data.fields.next);
    assert.ok((await change({ current: DEV_PASSWORD, next: 'mi-admin-2026!', confirm: 'mi-admin-2026!' })).data.fields.next);
    assert.ok((await change({ current: DEV_PASSWORD, next: NEW_PASSWORD, confirm: 'otra' })).data.fields.confirm);
    const old = admin.cookie;
    const r = await change({ current: DEV_PASSWORD, next: NEW_PASSWORD, confirm: NEW_PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(r.data.mustChange, false);
    assert.notEqual(admin.cookie, old);
    assert.equal((await other.call('GET', '/api/admin/products')).status, 401);
    assert.equal((await new Client().login(DEV_PASSWORD)).status, 401);
    assert.equal((await admin.call('GET', '/api/admin/products')).status, 200);
    const db = new Database(join(DATA, 'carta.db'), { readonly: true });
    const { password_hash } = db.prepare('SELECT password_hash FROM users').get() as any;
    db.close();
    assert.match(password_hash, /^scrypt\$65536\$8\$1\$/);
    assert.ok(!password_hash.includes(NEW_PASSWORD));
  });

  test('8. Cerrar sesión la invalida en el servidor', async () => {
    const c = new Client();
    await c.login(NEW_PASSWORD);
    const cookie = c.cookie;
    assert.equal((await c.call('POST', '/api/admin/logout')).status, 200);
    c.cookie = cookie;
    assert.equal((await c.call('GET', '/api/admin/products')).status, 401);
  });
});

describe('Productos', () => {
  test('9-10. Se crea oculto de forma predeterminada', async () => {
    const r = await admin.call('POST', '/api/admin/products', PRODUCT);
    assert.equal(r.status, 201);
    assert.equal(r.data.slug, id);
    assert.equal(r.data.isPublished, false);
    assert.equal(await inMenu(id), undefined);
    assert.equal((await visitor.call('GET', `/api/products/${id}`)).status, 404);
    assert.ok(!(await page()).includes('Prueba Ñandú'));
  });

  test('El servidor valida los datos', async () => {
    const bad = async (b: object, field: string) => {
      const r = await admin.call('POST', '/api/admin/products', { ...PRODUCT, ...b });
      assert.equal(r.status, 422, field);
      assert.ok(r.data.fields[field], `${field}: ${JSON.stringify(r.data)}`);
    };
    await bad({ priceCents: 0 }, 'priceCents');
    await bad({ priceCents: 12.5 }, 'priceCents');
    await bad({ categoryId: 'inventada' }, 'categoryId');
    await bad({ categoryId: 'extras' }, 'subcategoryId');
    await bad({ translations: { es: { name: 'Solo español' } } }, 'name.en');
    await bad({ allergens: ['inventado'] }, 'allergens');
    await bad({ photoId: 'no-existe' }, 'photoId');
    await bad({ photoId: 'huevo-y-miel-video' }, 'photoId');
    await bad({ otracosa: 1 }, 'otracosa');
    assert.equal((await admin.call('POST', '/api/admin/products', 'x', { 'Content-Type': 'application/json' })).status, 400);
  });

  test('11-12. Al publicar aparece en la carta, en los dos idiomas y en su enlace', async () => {
    await admin.call('PATCH', `/api/admin/products/${id}/status`, { isPublished: true });
    const p = await inMenu(id);
    assert.deepEqual(p.name, { es: 'Prueba Ñandú', en: 'Test Rhea' });
    assert.equal((await visitor.call('GET', `/api/products/${id}`)).status, 200);
    assert.ok((await page()).includes('Prueba Ñandú'));
  });

  test('13-16. Cambiar solo una cosa conserva todo lo demás', async () => {
    const before = (await admin.call('GET', `/api/admin/products/${id}`)).data;
    await admin.call('PATCH', `/api/admin/products/${id}`, { priceCents: 990 });
    assert.equal((await inMenu(id)).price, 9.9);
    assert.ok((await page()).includes('9,90 €'));
    await admin.call('PATCH', `/api/admin/products/${id}`, { translations: { es: { description: 'Nueva descripción' } } });
    await admin.call('PATCH', `/api/admin/products/${id}`, { translations: { en: { name: 'Renamed' } } });
    const p = await inMenu(id);
    assert.deepEqual(p.name, { es: 'Prueba Ñandú', en: 'Renamed' });
    assert.deepEqual(p.description, { es: 'Nueva descripción', en: 'Test text' });
    const now = (await admin.call('GET', `/api/admin/products/${id}`)).data;
    for (const k of ['slug', 'categoryId', 'sortOrder', 'allergens', 'photo', 'video', 'layout', 'isPublished']) assert.deepEqual(now[k], before[k] ?? now[k], k);
    assert.equal(now.slug, id);
  });

  test('El texto peligroso se guarda como texto y no se ejecuta', async () => {
    const evil = '</script><img src=x onerror=alert(1)>';
    await admin.call('PATCH', `/api/admin/products/${id}`, { translations: { es: { description: evil } } });
    const html = await page();
    assert.ok(!html.includes(evil));
    assert.equal((await inMenu(id)).description.es, evil);
    await admin.call('PATCH', `/api/admin/products/${id}`, { translations: { es: { description: "Robert'); DROP TABLE products;--" } } });
    assert.equal((await menu()).products.length, readSeed('productos').length + 1);
  });

  test('Dos personas editando a la vez: la segunda recibe un aviso', async () => {
    const { version } = (await admin.call('GET', `/api/admin/products/${id}`)).data;
    assert.equal((await admin.call('PATCH', `/api/admin/products/${id}`, { priceCents: 991, version })).status, 200);
    assert.equal((await admin.call('PATCH', `/api/admin/products/${id}`, { priceCents: 992, version })).status, 409);
    assert.equal((await inMenu(id)).price, 9.91);
  });

  test('26. Cambiar el orden se refleja en la carta', async () => {
    const list = async () => (await menu()).products.filter((p: any) => p.category === 'hamburguesas' && !p.featured).map((p: any) => p.id);
    const start = await list();
    assert.equal(start.at(-1), id);
    await admin.call('POST', `/api/admin/products/${id}/move`, { direction: 'up' });
    const moved = await list();
    assert.equal(moved.at(-2), id);
    await admin.call('POST', `/api/admin/products/${id}/move`, { direction: 'down' });
    assert.deepEqual(await list(), start);
    await admin.call('PATCH', `/api/admin/products/${id}`, { sortOrder: 15 });
    assert.equal((await list())[0], id);
  });

  test('27. Solo hay un destacado: el nuevo sustituye al anterior sin borrarlo', async () => {
    await admin.call('PATCH', `/api/admin/products/${id}`, { featured: true });
    let m = await menu();
    assert.deepEqual(m.products.filter((p: any) => p.featured).map((p: any) => p.id), [id]);
    assert.ok(m.products.some((p: any) => p.id === 'doble-cheddar'));
    await admin.call('PATCH', `/api/admin/products/${id}/status`, { isPublished: false });
    assert.equal((await menu()).products.filter((p: any) => p.featured).length, 0);
    await admin.call('PATCH', `/api/admin/products/${id}/status`, { isPublished: true });
    await admin.call('PATCH', '/api/admin/products/doble-cheddar', { featured: true });
    m = await menu();
    assert.deepEqual(m.products.filter((p: any) => p.featured).map((p: any) => p.id), ['doble-cheddar']);
  });

  test('Los extras se gestionan con nombre, precio y grupo', async () => {
    const r = await admin.call('POST', '/api/admin/products', { categoryId: 'extras', subcategoryId: 'quesos', priceCents: 80, isPublished: true, translations: { es: { name: 'Queso de prueba' }, en: { name: 'Test cheese' } } });
    assert.equal(r.status, 201);
    const group = (await menu()).extras.groups.find((g: any) => g.id === 'quesos');
    assert.equal(group.items.at(-1).price, 0.8);
    await admin.call('DELETE', `/api/admin/products/${r.data.id}`);
    assert.deepEqual((await menu()).extras, readSeed('extras'));
  });

  test('Una categoría con todo oculto deja de salir y vuelve al publicar', async () => {
    const coffees = (await menu()).products.filter((p: any) => p.category === 'cafes').map((p: any) => p.id);
    for (const c of coffees) await admin.call('PATCH', `/api/admin/products/${c}/status`, { isPublished: false });
    assert.ok(!(await menu()).categories.some((c: any) => c.id === 'cafes'));
    for (const c of coffees) await admin.call('PATCH', `/api/admin/products/${c}/status`, { isPublished: true });
    assert.deepEqual((await menu()).categories, readSeed('categorias'));
  });
});

describe('Fotos y vídeos', () => {
  let photo = '';
  let video = '';
  test('17-18. Subir una foto y un vídeo, y verlos en la carta', async () => {
    const a = await admin.upload('foto de prueba.jpg', 'image/jpeg', await jpeg('#c33'));
    assert.equal(a.status, 201);
    photo = a.data.id;
    const b = await admin.upload('prueba.mp4', 'video/mp4', await makeVideo('a.mp4', 2, ['-pix_fmt', 'yuv420p']));
    assert.equal(b.data.status, 'ready', JSON.stringify(b.data));
    video = b.data.id;
    await admin.call('PATCH', `/api/admin/products/${id}`, { photoId: photo, videoId: video });
    const { media } = await inMenu(id);
    assert.equal(media.photo.width / media.photo.height, 900 / 1200);
    assert.ok(media.poster, 'portada automática');
    for (const url of [media.photo.src, media.video.high, media.video.low, media.poster.src]) assert.equal((await fetch(base + url)).status, 200, url);
  });

  test('19. Sustituir una foto conserva la anterior en la biblioteca', async () => {
    const c = await admin.upload('otra.png', 'image/png', await sharp({ create: { width: 600, height: 600, channels: 3, background: '#36c' } }).png().toBuffer());
    await admin.call('PATCH', `/api/admin/products/${id}`, { photoId: c.data.id });
    assert.ok((await inMenu(id)).media.photo.src.includes(c.data.id));
    const library = (await admin.call('GET', '/api/admin/media?kind=image')).data.media;
    assert.ok(library.some((m: any) => m.id === photo));
    assert.equal((await admin.call('GET', `/api/admin/products/${id}`)).data.video.id, video);
  });

  test('No se puede borrar un archivo en uso; sí uno sin usar', async () => {
    assert.equal((await admin.call('DELETE', `/api/admin/media/${video}`)).status, 409);
    assert.equal((await admin.call('DELETE', '/api/admin/media/doble-cheddar-foto')).status, 409);
    assert.equal((await admin.call('DELETE', `/api/admin/media/${photo}`)).status, 200);
    assert.equal((await fetch(`${base}/media/${photo}/foto-960.webp`)).status, 404);
  });

  test('Se rechazan archivos peligrosos, disfrazados, rotos, vacíos o demasiado grandes', async () => {
    const enc = new TextEncoder();
    const html = enc.encode('<html><script>alert(1)</script>');
    const status = async (...a: [string, string, Uint8Array]) => (await admin.upload(...a)).status;
    assert.equal(await status('x.html', 'text/html', html), 415);
    assert.equal(await status('x.php', 'application/x-php', html), 415);
    assert.equal(await status('x.svg', 'image/svg+xml', enc.encode('<svg/>')), 415);
    assert.equal(await status('x.jpg', 'image/jpeg', html), 415);
    assert.equal(await status('x.mp4', 'video/mp4', enc.encode('#EXTM3U\nfile:///etc/passwd')), 415);
    assert.equal(await status('x.jpg', 'video/mp4', await jpeg('#000')), 415);
    assert.equal(await status('x.jpg', 'image/jpeg', new Uint8Array()), 422);
    assert.equal(await status('x.jpg', 'image/jpeg', (await jpeg('#0a0')).subarray(0, 300)), 422);
    const big = await fetch(`${base}/api/admin/media?name=x.jpg`, { method: 'POST', headers: { Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf, 'Content-Type': 'image/jpeg' }, body: new Uint8Array(16 * 1024 * 1024) }).then((r) => r.status, () => 'cortada');
    assert.ok(big === 413 || big === 'cortada', String(big));
    const broken = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(500, 7)]);
    const r = await admin.upload('roto.mp4', 'video/mp4', broken);
    assert.equal(r.data.status, 'error');
    const long = await admin.upload('largo.mp4', 'video/mp4', await makeVideo('l.mp4', 65, ['-pix_fmt', 'yuv420p', '-preset', 'ultrafast']));
    assert.equal(long.data.status, 'error');
    assert.match(long.data.error, /60 segundos/);
    const trick = await admin.upload('..\\..\\..\\raro/../x.jpg', 'image/jpeg', await jpeg('#111'));
    assert.equal(trick.status, 201);
    assert.equal(trick.data.name, 'x.jpg');
    assert.equal(readdirSync(join(DATA, 'tmp')).length, 0);
  });
});

describe('Ocultar, publicar, persistir y eliminar', () => {
  let snapshot: any;
  test('20-23. Ocultar lo retira de todo lo público y lo conserva en el panel', async () => {
    snapshot = await inMenu(id);
    await admin.call('PATCH', `/api/admin/products/${id}/status`, { isPublished: false });
    assert.ok(!JSON.stringify(await menu()).includes(id));
    assert.equal((await visitor.call('GET', `/api/products/${id}`)).status, 404);
    const html = await page();
    assert.ok(!html.includes('Prueba Ñandú') && !html.includes(id));
    const hidden = (await admin.call('GET', '/api/admin/products')).data.products.find((p: any) => p.id === id);
    assert.equal(hidden.isPublished, false);
    assert.equal((await fetch(base + snapshot.media.video.low)).status, 200);
  });

  test('29-30. Tras reiniciar el servidor todo sigue igual y nada se duplica', async () => {
    const list = (await admin.call('GET', '/api/admin/products')).data.products;
    await stop();
    await start();
    assert.deepEqual((await admin.call('GET', '/api/admin/products')).data.products, list);
    assert.ok(!log.includes('Carta inicial importada'));
  });

  test('24-25. Publicar de nuevo recupera datos, recursos y posición', async () => {
    await admin.call('PATCH', `/api/admin/products/${id}/status`, { isPublished: true });
    assert.deepEqual(await inMenu(id), snapshot);
    assert.equal((await menu()).products.filter((p: any) => p.id === id).length, 1);
  });

  test('Exportar y restaurar: revisa antes, guarda copia y deja todo como estaba', async () => {
    const copy = (await admin.call('GET', '/api/admin/export')).data;
    assert.equal(copy.products.length, readSeed('productos').length + 10 + 1);
    const before = await menu();
    await admin.call('PATCH', `/api/admin/products/${id}`, { priceCents: 5 });
    const preview = await admin.call('POST', '/api/admin/import', copy);
    assert.equal(preview.data.applied, false);
    assert.equal((await inMenu(id)).price, 0.05);
    const done = await admin.call('POST', '/api/admin/import?confirmar=si', copy);
    assert.equal(done.data.applied, true);
    assert.ok(existsSync(join(DATA, 'copias', done.data.backup)));
    assert.deepEqual(await menu(), before);
    for (const bad of [{}, { ...copy, format: 'x' }, { ...copy, products: [{ id: 'a' }] }, { ...copy, products: [...copy.products, copy.products[0]] },
      { ...copy, products: copy.products.map((p: any, i: number) => (i ? p : { ...p, category_id: 'nada' })) },
      { ...copy, media: [{ ...copy.media[0], files: '{"large":"/media/../../x"}' }] }])
      { const r = await admin.call('POST', '/api/admin/import?confirmar=si', bad); assert.equal(r.status, 422, log.slice(-900)); }
    assert.deepEqual(await menu(), before);
  });

  test('28. Eliminar es definitivo, deja copia y no borra archivos de otros', async () => {
    assert.equal((await admin.call('DELETE', `/api/admin/products/${id}`)).status, 200);
    assert.equal((await admin.call('GET', `/api/admin/products/${id}`)).status, 404);
    assert.equal(await inMenu(id), undefined);
    assert.ok(readdirSync(join(DATA, 'copias')).some((f) => f.startsWith('antes-de-borrar')));
    assert.equal((await fetch(`${base}/media/doble-cheddar/foto-960.webp`)).status, 200);
    const left = (await admin.call('GET', '/api/admin/products')).data.products;
    assert.equal(left.length, readSeed('productos').length + 10);
  });

  test('Un producto original borrado no reaparece al reiniciar', async () => {
    await admin.call('DELETE', '/api/admin/products/patatas-de-la-casa');
    await stop();
    await start();
    assert.equal(await inMenu('patatas-de-la-casa'), undefined);
  });
});

describe('Seguridad del arranque y de los intentos', () => {
  test('5. Cinco fallos bloquean el acceso, incluso con la contraseña correcta y tras reiniciar', async () => {
    const c = new Client();
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await c.login('incorrecta')).status);
    assert.equal(codes.at(-1), 429);
    const blocked = await c.login(NEW_PASSWORD);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    await stop();
    await start();
    assert.equal((await new Client().login(NEW_PASSWORD)).status, 429);
    assert.equal((await admin.call('GET', '/api/admin/products')).status, 200, 'quien ya está dentro sigue');
  });

  test('Varios intentos simultáneos tampoco esquivan el límite', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => new Client().login('x', 'alguien')));
    assert.ok(results.filter((r) => r.status === 401).length <= 5);
  });

  test('Producción se niega a arrancar con contraseña insegura o sin dirección pública', async () => {
    await stop();
    const dir = join(work, 'prod');
    const env = { DATA_DIR: dir, PUBLIC_ORIGIN: 'https://carta.example', HOST: 'localhost' };
    assert.match((await refusal({ ...env, PUBLIC_ORIGIN: '', ADMIN_PASSWORD: NEW_PASSWORD }))!, /PUBLIC_ORIGIN/);
    assert.match((await refusal({ ...env, ADMIN_PASSWORD: 'admin' }))!, /no es segura/);
    assert.match((await refusal({ ...env, ADMIN_PASSWORD: '' }))!, /ADMIN_PASSWORD/);
    // Base de datos creada en local con la contraseña de desarrollo.
    const local = join(work, 'local');
    const dev = launch({ DATA_DIR: local });
    await new Promise<void>((ok) => dev.stdout!.on('data', (d) => String(d).includes('Panel') && ok()));
    dev.kill('SIGTERM');
    await new Promise((ok) => dev.once('exit', ok));
    assert.match((await refusal({ ...env, DATA_DIR: local, ADMIN_PASSWORD: NEW_PASSWORD }))!, /contraseña de desarrollo/);
    assert.equal(await refusal({ ...env, ADMIN_PASSWORD: NEW_PASSWORD }), null, 'con contraseña segura sí arranca');
  });

  test('En producción la cookie es Secure y __Host-', async () => {
    const dir = join(work, 'prod2');
    const p = launch({ DATA_DIR: dir, PUBLIC_ORIGIN: base.replace('http', 'https'), HOST: 'localhost', ADMIN_PASSWORD: NEW_PASSWORD }, 'server/produccion.ts');
    await new Promise<void>((ok) => p.stdout!.on('data', (d) => String(d).includes('Panel') && ok()));
    const r = await new Client().login(NEW_PASSWORD);
    assert.equal(r.status, 200);
    assert.match(r.setCookie, /^__Host-carta=/);
    assert.match(r.setCookie, /; Secure/);
    assert.match(r.headers.get('strict-transport-security')!, /max-age/);
    p.kill('SIGTERM');
    await new Promise((ok) => p.once('exit', ok));
  });

  test('Recuperar la contraseña desde el servidor y hacer copia completa', async () => {
    const run = (args: string[], input: string) =>
      new Promise<string>((ok) => {
        const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/cli.ts', ...args], { cwd: ROOT, env: { ...process.env, CARTA_IGNORAR_ENV: '1', DATA_DIR: DATA } });
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));
        p.once('exit', () => ok(out));
        p.stdin.end(input);
      });
    assert.match(await run(['clave'], 'admin\nadmin\n'), /10 caracteres/);
    assert.match(await run(['clave'], 'Otra-clave-segura-7\nOtra-clave-segura-7\n'), /actualizada/);
    const copy = (await run(['copia'], '')).match(/Copia guardada en (.+)/)![1].trim();
    assert.ok(existsSync(join(copy, 'carta.db')) && existsSync(join(copy, 'media', 'doble-cheddar')));
    await start();
    const c = new Client();
    assert.equal((await c.login('Otra-clave-segura-7')).status, 200, 'además, desbloquea los intentos');
    assert.equal((await admin.call('GET', '/api/admin/products')).status, 401, 'cierra las sesiones');
    await c.call('PATCH', '/api/admin/products/doble-cheddar', { priceCents: 1 });
    await stop();
    assert.match(await run(['restaurar', copy], 'no\n'), /Cancelado/);
    assert.match(await run(['restaurar', copy], 'RESTAURAR\n'), /restaurada/);
    await start();
    assert.equal((await inMenu('doble-cheddar')).price, 14.5);
  });

  test('Los secretos no llegan a los archivos públicos', () => {
    const dir = join(ROOT, 'dist/client/assets');
    for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /scrypt|password_hash|ADMIN_PASSWORD/, f);
    writeFileSync(join(work, 'fin'), '');
  });
});
