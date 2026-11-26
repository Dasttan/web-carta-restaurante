/** Base de datos SQLite: esquema, migraciones y carga inicial (una sola vez). */
import Database from 'better-sqlite3';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';

export type Db = Database.Database;

const MIGRATIONS = [
  `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('productos', 'extras')),
    name TEXT NOT NULL,
    title TEXT,
    sort_order INTEGER NOT NULL
  );
  CREATE TABLE subcategories (
    id TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (category_id, id)
  );
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'error')),
    original_name TEXT NOT NULL,
    files TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    category_id TEXT NOT NULL REFERENCES categories(id),
    subcategory_id TEXT,
    translations TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'EUR',
    allergens TEXT,
    allergens_pending_review INTEGER NOT NULL DEFAULT 0,
    includes_fries INTEGER NOT NULL DEFAULT 0,
    modification_restrictions INTEGER NOT NULL DEFAULT 0,
    servings INTEGER,
    units INTEGER,
    layout TEXT NOT NULL DEFAULT 'compacta' CHECK (layout IN ('grande', 'compacta')),
    featured INTEGER NOT NULL DEFAULT 0,
    available INTEGER NOT NULL DEFAULT 1,
    is_published INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL,
    photo_id TEXT REFERENCES media(id),
    video_id TEXT REFERENCES media(id),
    poster_id TEXT REFERENCES media(id),
    custom TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id, subcategory_id) REFERENCES subcategories(category_id, id)
  );
  CREATE INDEX products_by_category ON products (category_id, sort_order);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL
  );
  CREATE TABLE login_attempts (
    key TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX attempts_by_key ON login_attempts (key, at);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export function openDb(): Db {
  for (const dir of [config.dataDir, config.mediaDir, config.tmpDir, config.backupDir]) mkdirSync(dir, { recursive: true });
  const db = new Database(config.dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

const readSeed = (name: string) => JSON.parse(readFileSync(join(config.seedDir, `${name}.json`), 'utf8'));

interface Size {
  width: number;
  height: number;
}

/**
 * Importa la carta original (carpeta seed/) la primera vez. Queda marcada como hecha:
 * los reinicios no duplican nada ni devuelven productos que se hayan borrado después.
 */
function seed(db: Db): void {
  if (db.prepare('SELECT 1 FROM meta WHERE key = ?').get('seeded')) return;
  if (!existsSync(join(config.seedDir, 'productos.json'))) {
    throw new Error('No hay datos: falta la carpeta seed/ con la carta inicial.');
  }
  const products = readSeed('productos');
  const categories = readSeed('categorias');
  const extras = readSeed('extras');
  const manifest = readSeed('medios') as Record<string, { video?: boolean; poster?: Size; photo?: Size }>;

  cpSync(join(config.seedDir, 'media'), config.mediaDir, { recursive: true, force: false });

  const now = new Date().toISOString();
  const cents = (price: number) => Math.round(price * 100);
  const bool = (v: unknown) => (v ? 1 : 0);

  db.transaction(() => {
    const addCategory = db.prepare('INSERT INTO categories (id, type, name, title, sort_order) VALUES (?, ?, ?, ?, ?)');
    categories.forEach((c: { id: string; type: string; name: object }, i: number) => {
      const title = c.type === 'extras' ? JSON.stringify(extras.title) : null;
      addCategory.run(c.id, c.type, JSON.stringify(c.name), title, (i + 1) * 10);
    });

    const addMedia = db.prepare(
      `INSERT INTO media (id, kind, status, original_name, files, created_at) VALUES (?, ?, 'ready', ?, ?, ?)`,
    );
    const imageFiles = (slug: string, kind: 'portada' | 'foto', size: Size) => {
      const big = kind === 'portada' ? 720 : 960;
      const base = `/media/${slug}/${kind}`;
      return { small: `${base}-480.webp`, large: `${base}-${big}.webp`, ...size };
    };

    const addProduct = db.prepare(`
      INSERT INTO products (id, slug, category_id, subcategory_id, translations, price_cents, allergens,
        allergens_pending_review, includes_fries, modification_restrictions, servings, units, layout, featured,
        available, is_published, sort_order, photo_id, video_id, poster_id, custom, created_at, updated_at)
      VALUES (@id, @slug, @category, @subcategory, @translations, @price, @allergens, @review, @fries, @rules,
        @servings, @units, @layout, @featured, @available, 1, @sort, @photo, @video, @poster, @custom, @now, @now)`);

    for (const p of products) {
      const m = manifest[p.slug] ?? {};
      let photo: string | null = null;
      let video: string | null = null;
      let poster: string | null = null;
      if (m.photo) {
        photo = `${p.slug}-foto`;
        addMedia.run(photo, 'image', `${p.slug} · foto`, JSON.stringify(imageFiles(p.slug, 'foto', m.photo)), now);
      }
      if (m.video) {
        video = `${p.slug}-video`;
        const files = {
          high: `/media/${p.slug}/video-720.mp4`,
          low: `/media/${p.slug}/video-486.mp4`,
          poster: m.poster ? imageFiles(p.slug, 'portada', m.poster) : null,
        };
        addMedia.run(video, 'video', `${p.slug} · vídeo`, JSON.stringify(files), now);
      } else if (m.poster) {
        poster = `${p.slug}-portada`;
        addMedia.run(poster, 'image', `${p.slug} · portada`, JSON.stringify(imageFiles(p.slug, 'portada', m.poster)), now);
      }

      const known = new Set(['id', 'slug', 'category', 'name', 'description', 'price', 'allergens', 'allergensPendingReview',
        'includesFries', 'modificationRestrictions', 'servings', 'units', 'layout', 'featured', 'available', 'sortOrder']);
      const custom = Object.fromEntries(Object.entries(p).filter(([k]) => !known.has(k)));
      const translations: Record<string, object> = {};
      for (const l of Object.keys(p.name)) translations[l] = { name: p.name[l], description: p.description[l] };

      addProduct.run({
        id: p.id, slug: p.slug, category: p.category, subcategory: null, translations: JSON.stringify(translations),
        price: cents(p.price), allergens: p.allergens === null ? null : JSON.stringify(p.allergens),
        review: bool(p.allergensPendingReview), fries: bool(p.includesFries), rules: bool(p.modificationRestrictions),
        servings: p.servings, units: p.units, layout: p.layout, featured: bool(p.featured), available: bool(p.available),
        sort: p.sortOrder, photo, video, poster, custom: JSON.stringify(custom), now,
      });
    }

    // Los extras son productos sencillos: nombre, precio y grupo.
    const extrasCategory = categories.find((c: { type: string }) => c.type === 'extras');
    const addSub = db.prepare('INSERT INTO subcategories (id, category_id, name, sort_order) VALUES (?, ?, ?, ?)');
    const taken = new Set(products.map((p: { id: string }) => p.id));
    extras.groups.forEach((g: { id: string; name: object; items: any[] }, gi: number) => {
      addSub.run(g.id, extrasCategory.id, JSON.stringify(g.name), (gi + 1) * 10);
      g.items.forEach((x, i) => {
        const id = taken.has(x.id) ? `extra-${x.id}` : x.id;
        const translations: Record<string, object> = {};
        for (const l of Object.keys(x.name)) translations[l] = { name: x.name[l], description: '' };
        addProduct.run({
          id, slug: id, category: extrasCategory.id, subcategory: g.id, translations: JSON.stringify(translations),
          price: cents(x.price), allergens: null, review: 0, fries: 0, rules: 0, servings: null, units: null,
          layout: 'compacta', featured: 0, available: bool(x.available), sort: (i + 1) * 10, photo: null, video: null,
          poster: null, custom: '{}', now,
        });
      });
    });

    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('seeded', now);
  })();
  console.log(`Carta inicial importada: ${products.length} productos y ${extras.groups.flatMap((g: any) => g.items).length} extras.`);
}

/** Copia consistente de la base de datos, también con el servidor en marcha. */
export function backupDb(db: Db, file: string): void {
  db.prepare('VACUUM INTO ?').run(file);
}

/** Con milésimas: dos copias seguidas nunca comparten nombre. */
export const stamp = () => new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 23);
