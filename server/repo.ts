/** Lectura y escritura de productos. Única capa que conoce las tablas. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import { ROOT } from './config.ts';
import { HttpError, type ProductInput } from './validate.ts';

export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];
type Localized = Record<Lang, string>;

export const allergenNames: Record<string, Localized> = JSON.parse(
  readFileSync(join(ROOT, 'src/data/alergenos.json'), 'utf8'),
);
export const restaurant: { name: Localized } = JSON.parse(readFileSync(join(ROOT, 'src/data/restaurante.json'), 'utf8'));

interface Row {
  id: string;
  slug: string;
  category_id: string;
  subcategory_id: string | null;
  translations: string;
  price_cents: number;
  currency: string;
  allergens: string | null;
  allergens_pending_review: number;
  includes_fries: number;
  modification_restrictions: number;
  servings: number | null;
  units: number | null;
  layout: 'grande' | 'compacta';
  featured: number;
  available: number;
  is_published: number;
  sort_order: number;
  photo_id: string | null;
  video_id: string | null;
  poster_id: string | null;
  custom: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ImageFiles {
  small: string;
  large: string;
  width: number;
  height: number;
}
export interface MediaRow {
  id: string;
  kind: 'image' | 'video';
  status: 'processing' | 'ready' | 'error';
  original_name: string;
  files: string;
  error: string | null;
  created_at: string;
}

export class Repo {
  private db: Db;
  /** Cambia con cada escritura: invalida la carta que el servidor tiene preparada. */
  revision = randomUUID();

  constructor(db: Db) {
    this.db = db;
  }

  private touched(): void {
    this.revision = randomUUID();
  }

  /* ---------- Categorías ---------- */

  categories() {
    const subs = this.db.prepare('SELECT * FROM subcategories ORDER BY sort_order').all() as any[];
    return (this.db.prepare('SELECT * FROM categories ORDER BY sort_order').all() as any[]).map((c) => ({
      id: c.id as string,
      type: c.type as 'productos' | 'extras',
      name: JSON.parse(c.name) as Localized,
      title: c.title ? (JSON.parse(c.title) as Localized) : null,
      subcategories: subs
        .filter((s) => s.category_id === c.id)
        .map((s) => ({ id: s.id as string, name: JSON.parse(s.name) as Localized })),
    }));
  }

  /* ---------- Multimedia ---------- */

  private mediaMap(): Map<string, MediaRow> {
    return new Map((this.db.prepare(`SELECT * FROM media WHERE status = 'ready'`).all() as MediaRow[]).map((m) => [m.id, m]));
  }

  private asset(f: ImageFiles | null) {
    if (!f) return null;
    return { src: f.large, srcset: `${f.small} 480w, ${f.large} ${f.width}w`, width: f.width, height: f.height };
  }

  private resolveMedia(row: Row, media: Map<string, MediaRow>) {
    const image = (id: string | null) => {
      const m = id ? media.get(id) : undefined;
      return m?.kind === 'image' ? this.asset(JSON.parse(m.files)) : null;
    };
    const v = row.video_id ? media.get(row.video_id) : undefined;
    const files = v?.kind === 'video' ? JSON.parse(v.files) : null;
    return {
      poster: image(row.poster_id) ?? this.asset(files?.poster ?? null),
      photo: image(row.photo_id),
      video: files ? { high: files.high as string, low: files.low as string } : null,
    };
  }

  media(id: string): MediaRow | undefined {
    return this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  }

  mediaView(m: MediaRow) {
    const files = JSON.parse(m.files);
    const usedBy = (
      this.db.prepare('SELECT translations FROM products WHERE ? IN (photo_id, video_id, poster_id)').all(m.id) as any[]
    ).map((p) => JSON.parse(p.translations).es.name as string);
    return {
      id: m.id,
      kind: m.kind,
      status: m.status,
      name: m.original_name,
      error: m.error,
      thumb: (m.kind === 'image' ? files.small : files.poster?.small) ?? null,
      url: (m.kind === 'image' ? files.large : files.low) ?? null,
      usedBy,
      createdAt: m.created_at,
    };
  }

  mediaList(kind?: string) {
    const rows = (
      kind
        ? this.db.prepare(`SELECT * FROM media WHERE status = 'ready' AND kind = ? ORDER BY created_at DESC, id`).all(kind)
        : this.db.prepare(`SELECT * FROM media WHERE status = 'ready' ORDER BY created_at DESC, id`).all()
    ) as MediaRow[];
    return rows.map((m) => this.mediaView(m));
  }

  addMedia(id: string, kind: 'image' | 'video', name: string): void {
    this.db
      .prepare(`INSERT INTO media (id, kind, status, original_name, created_at) VALUES (?, ?, 'processing', ?, ?)`)
      .run(id, kind, name, new Date().toISOString());
  }

  finishMedia(id: string, files: object): void {
    this.db.prepare(`UPDATE media SET status = 'ready', files = ? WHERE id = ?`).run(JSON.stringify(files), id);
  }

  failMedia(id: string, error: string): void {
    this.db.prepare(`UPDATE media SET status = 'error', error = ? WHERE id = ?`).run(error, id);
  }

  removeMedia(id: string): MediaRow {
    const m = this.media(id);
    if (!m) throw new HttpError(404, 'Ese archivo ya no existe.');
    const used = this.mediaView(m).usedBy;
    if (used.length) throw new HttpError(409, `Este archivo se usa en: ${used.join(', ')}. Quítalo antes de esos productos.`);
    this.db.prepare('DELETE FROM media WHERE id = ?').run(id);
    return m;
  }

  /** Subidas interrumpidas por un apagado. */
  discardUnfinishedMedia(): string[] {
    const rows = this.db.prepare(`SELECT id FROM media WHERE status != 'ready'`).all() as { id: string }[];
    this.db.prepare(`DELETE FROM media WHERE status != 'ready'`).run();
    return rows.map((r) => r.id);
  }

  /* ---------- Carta pública ---------- */

  private localized(row: Row, field: 'name' | 'description'): Localized {
    const t = JSON.parse(row.translations);
    return Object.fromEntries(LANGS.map((l) => [l, t[l]?.[field] ?? ''])) as Localized;
  }

  private publicProduct(row: Row, media: Map<string, MediaRow>) {
    return {
      id: row.id,
      slug: row.slug,
      category: row.category_id,
      name: this.localized(row, 'name'),
      description: this.localized(row, 'description'),
      price: row.price_cents / 100,
      allergens: row.allergens === null ? null : (JSON.parse(row.allergens) as string[]),
      allergensPendingReview: !!row.allergens_pending_review,
      includesFries: !!row.includes_fries,
      modificationRestrictions: !!row.modification_restrictions,
      servings: row.servings,
      units: row.units,
      featured: !!row.featured,
      available: !!row.available,
      layout: row.layout,
      sortOrder: row.sort_order,
      media: this.resolveMedia(row, media),
    };
  }

  private publishedRows(): Row[] {
    return this.db.prepare('SELECT * FROM products WHERE is_published = 1 ORDER BY sort_order, created_at, id').all() as Row[];
  }

  publicMenu() {
    const media = this.mediaMap();
    const rows = this.publishedRows();
    const all = this.categories();
    const extrasCategory = all.find((c) => c.type === 'extras');
    const extrasRows = rows.filter((r) => r.category_id === extrasCategory?.id);
    const item = (r: Row) => ({ id: r.id, name: this.localized(r, 'name'), price: r.price_cents / 100, available: !!r.available });
    const groups = (extrasCategory?.subcategories ?? [])
      .map((g) => ({ id: g.id, name: g.name, items: extrasRows.filter((r) => r.subcategory_id === g.id).map(item) }))
      .filter((g) => g.items.length > 0);
    const products = rows
      .filter((r) => r.category_id !== extrasCategory?.id)
      .map((r) => this.publicProduct(r, media))
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder);
    // Una categoría con todo oculto no se enseña vacía: vuelve sola al publicar algo.
    const categories = all
      .filter((c) => (c.type === 'extras' ? groups.length > 0 : products.some((p) => p.category === c.id)))
      .map(({ id, type, name }) => ({ id, type, name }));
    return { categories, products, extras: { title: extrasCategory?.title ?? { es: '', en: '' }, groups } };
  }

  publicBySlug(slug: string) {
    const row = this.db.prepare('SELECT * FROM products WHERE slug = ? AND is_published = 1').get(slug) as Row | undefined;
    return row ? this.publicProduct(row, this.mediaMap()) : null;
  }

  /* ---------- Administración ---------- */

  private adminProduct(row: Row, media: Map<string, MediaRow>) {
    const view = (id: string | null) => {
      const m = id ? media.get(id) : undefined;
      return m ? this.mediaView(m) : null;
    };
    const { price, media: resolved, category, ...rest } = this.publicProduct(row, media);
    return {
      ...rest,
      categoryId: category,
      subcategoryId: row.subcategory_id,
      priceCents: row.price_cents,
      currency: row.currency,
      isPublished: !!row.is_published,
      photo: view(row.photo_id),
      video: view(row.video_id),
      poster: view(row.poster_id),
      thumb: resolved.photo?.srcset.split(' ')[0] ?? resolved.poster?.srcset.split(' ')[0] ?? null,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  adminList() {
    const media = this.mediaMap();
    const order = new Map(this.categories().map((c, i) => [c.id, i]));
    const subOrder = new Map(this.categories().flatMap((c) => c.subcategories.map((s, i) => [`${c.id}/${s.id}`, i] as const)));
    return (this.db.prepare('SELECT * FROM products').all() as Row[])
      .sort(
        (a, b) =>
          order.get(a.category_id)! - order.get(b.category_id)! ||
          (subOrder.get(`${a.category_id}/${a.subcategory_id}`) ?? 0) - (subOrder.get(`${b.category_id}/${b.subcategory_id}`) ?? 0) ||
          a.sort_order - b.sort_order ||
          a.created_at.localeCompare(b.created_at) ||
          a.id.localeCompare(b.id),
      )
      .map((r) => this.adminProduct(r, media));
  }

  private row(id: string): Row {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new HttpError(404, 'Ese producto ya no existe.');
    return row;
  }

  adminGet(id: string) {
    return this.adminProduct(this.row(id), this.mediaMap());
  }

  private slugFor(name: string): string {
    const base =
      name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'producto';
    const exists = this.db.prepare('SELECT 1 FROM products WHERE slug = ? OR id = ?');
    for (let i = 1; ; i++) {
      const slug = i === 1 ? base : `${base}-${i}`;
      if (!exists.get(slug, slug)) return slug;
    }
  }

  private nextOrder(categoryId: string, subcategoryId: string | null): number {
    const { max } = this.db
      .prepare('SELECT MAX(sort_order) AS max FROM products WHERE category_id = ? AND subcategory_id IS ?')
      .get(categoryId, subcategoryId) as { max: number | null };
    return (max ?? 0) + 10;
  }

  private checkReferences(input: ProductInput, categoryId: string, subcategoryId: string | null): void {
    const category = this.categories().find((c) => c.id === categoryId);
    if (!category) throw new HttpError(422, 'Elige una categoría de la lista.', { categoryId: 'Elige una categoría.' });
    const needsSub = category.subcategories.length > 0;
    if (needsSub && !category.subcategories.some((s) => s.id === subcategoryId))
      throw new HttpError(422, 'Elige una subcategoría.', { subcategoryId: 'Elige una subcategoría.' });
    if (!needsSub && subcategoryId)
      throw new HttpError(422, 'Esa categoría no tiene subcategorías.', { subcategoryId: 'No corresponde a esta categoría.' });
    for (const [field, kind] of [['photoId', 'image'], ['posterId', 'image'], ['videoId', 'video']] as const) {
      const id = input[field];
      if (!id) continue;
      const m = this.media(id);
      if (!m || m.kind !== kind || m.status !== 'ready')
        throw new HttpError(422, 'Uno de los archivos elegidos no está disponible.', { [field]: 'Vuelve a elegir el archivo.' });
    }
    for (const a of input.allergens ?? [])
      if (!allergenNames[a]) throw new HttpError(422, 'Hay un alérgeno desconocido.', { allergens: 'Revisa los alérgenos.' });
  }

  /** Solo puede haber un producto destacado: el anterior deja de serlo, pero no se borra. */
  private unfeatureOthers(id: string): void {
    this.db
      .prepare('UPDATE products SET featured = 0, version = version + 1, updated_at = ? WHERE featured = 1 AND id != ?')
      .run(new Date().toISOString(), id);
  }

  create(input: ProductInput): string {
    const categoryId = input.categoryId!;
    const subcategoryId = input.subcategoryId ?? null;
    this.checkReferences(input, categoryId, subcategoryId);
    const slug = this.slugFor(input.translations!.es!.name!);
    const now = new Date().toISOString();
    const translations = Object.fromEntries(
      LANGS.map((l) => [l, { name: input.translations?.[l]?.name ?? '', description: input.translations?.[l]?.description ?? '' }]),
    );
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO products (id, slug, category_id, subcategory_id, translations, price_cents, allergens, allergens_pending_review,
             includes_fries, modification_restrictions, servings, units, layout, featured, available, is_published, sort_order,
             photo_id, video_id, poster_id, created_at, updated_at)
           VALUES (@slug, @slug, @categoryId, @subcategoryId, @translations, @price, @allergens, @review, @fries, @rules, @servings,
             @units, @layout, @featured, @available, @published, @sort, @photo, @video, @poster, @now, @now)`,
        )
        .run({
          slug, categoryId, subcategoryId, translations: JSON.stringify(translations), price: input.priceCents,
          allergens: input.allergens ? JSON.stringify(input.allergens) : null, review: +!!input.allergensPendingReview,
          fries: +!!input.includesFries, rules: +!!input.modificationRestrictions, servings: input.servings ?? null,
          units: input.units ?? null, layout: input.layout ?? 'compacta', featured: +!!input.featured,
          available: +(input.available ?? true), published: +(input.isPublished ?? false),
          sort: input.sortOrder ?? this.nextOrder(categoryId, subcategoryId), photo: input.photoId ?? null,
          video: input.videoId ?? null, poster: input.posterId ?? null, now,
        });
      if (input.featured) this.unfeatureOthers(slug);
    })();
    this.touched();
    return slug;
  }

  /** Cambia solo los campos recibidos; el resto queda exactamente como estaba. */
  update(id: string, input: ProductInput, version: number | undefined): void {
    const row = this.row(id);
    if (version !== undefined && version !== row.version)
      throw new HttpError(409, 'Alguien ha cambiado este producto mientras lo editabas. Vuelve a abrirlo para ver la última versión.');

    const categoryId = input.categoryId ?? row.category_id;
    let subcategoryId = input.subcategoryId === undefined ? row.subcategory_id : input.subcategoryId;
    const moved = categoryId !== row.category_id;
    if (moved && input.subcategoryId === undefined) subcategoryId = null;
    this.checkReferences(input, categoryId, subcategoryId);

    const set: Record<string, unknown> = {};
    const flag = (column: string, value: boolean | undefined) => value !== undefined && (set[column] = +value);
    const plain = (column: string, value: unknown) => value !== undefined && (set[column] = value);

    if (moved) set.category_id = categoryId;
    if (subcategoryId !== row.subcategory_id) set.subcategory_id = subcategoryId;
    if ((moved || subcategoryId !== row.subcategory_id) && input.sortOrder === undefined)
      set.sort_order = this.nextOrder(categoryId, subcategoryId);
    if (input.translations) {
      const t = JSON.parse(row.translations);
      for (const l of LANGS) if (input.translations[l]) t[l] = { ...t[l], ...input.translations[l] };
      set.translations = JSON.stringify(t);
    }
    if (input.allergens !== undefined) set.allergens = input.allergens === null ? null : JSON.stringify(input.allergens);
    plain('price_cents', input.priceCents);
    plain('servings', input.servings);
    plain('units', input.units);
    plain('layout', input.layout);
    plain('sort_order', input.sortOrder);
    plain('photo_id', input.photoId);
    plain('video_id', input.videoId);
    plain('poster_id', input.posterId);
    flag('allergens_pending_review', input.allergensPendingReview);
    flag('includes_fries', input.includesFries);
    flag('modification_restrictions', input.modificationRestrictions);
    flag('featured', input.featured);
    flag('available', input.available);
    flag('is_published', input.isPublished);
    if (!Object.keys(set).length) return;

    this.db.transaction(() => {
      const columns = Object.keys(set).map((c) => `${c} = @${c}`).join(', ');
      this.db
        .prepare(`UPDATE products SET ${columns}, version = version + 1, updated_at = @now WHERE id = @id`)
        .run({ ...set, id, now: new Date().toISOString() });
      if (input.featured) this.unfeatureOthers(id);
    })();
    this.touched();
  }

  /** Intercambia la posición con el vecino dentro de su categoría (o grupo). */
  move(id: string, direction: 'up' | 'down'): void {
    const row = this.row(id);
    this.db.transaction(() => {
      const list = this.db
        .prepare('SELECT id FROM products WHERE category_id = ? AND subcategory_id IS ? ORDER BY sort_order, created_at, id')
        .all(row.category_id, row.subcategory_id) as { id: string }[];
      const ids = list.map((r) => r.id);
      const from = ids.indexOf(id);
      const to = from + (direction === 'up' ? -1 : 1);
      if (to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      const set = this.db.prepare('UPDATE products SET sort_order = ?, version = version + 1 WHERE id = ? AND sort_order != ?');
      ids.forEach((pid, i) => set.run((i + 1) * 10, pid, (i + 1) * 10));
    })();
    this.touched();
  }

  remove(id: string): string {
    const name = JSON.parse(this.row(id).translations).es.name as string;
    this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
    this.touched();
    return name;
  }

  /* ---------- Exportar e importar ---------- */

  export() {
    return {
      format: 'web-carta',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      categories: this.db.prepare('SELECT * FROM categories').all(),
      subcategories: this.db.prepare('SELECT * FROM subcategories').all(),
      media: this.db.prepare(`SELECT * FROM media WHERE status = 'ready'`).all(),
      products: this.db.prepare('SELECT * FROM products').all(),
    };
  }

  /** Sustituye los productos por los de una copia ya validada. Conserva los archivos actuales. */
  import(data: { media: MediaRow[]; products: Row[] }): number {
    const categories = new Map(this.categories().map((c) => [c.id, c]));
    const mediaIds = new Set((this.db.prepare('SELECT id FROM media').all() as { id: string }[]).map((m) => m.id));
    const incoming = new Map(data.media.map((m) => [m.id, m]));
    for (const p of data.products) {
      const c = categories.get(p.category_id);
      if (!c) throw new HttpError(422, `La copia usa la categoría «${p.category_id}», que no existe en esta carta.`);
      if (p.subcategory_id && !c.subcategories.some((s) => s.id === p.subcategory_id))
        throw new HttpError(422, `La copia usa la subcategoría «${p.subcategory_id}», que no existe en esta carta.`);
      for (const m of [p.photo_id, p.video_id, p.poster_id])
        if (m && !mediaIds.has(m) && !incoming.has(m)) throw new HttpError(422, 'La copia menciona archivos que no incluye.');
    }
    const columns = ['id', 'slug', 'category_id', 'subcategory_id', 'translations', 'price_cents', 'currency', 'allergens',
      'allergens_pending_review', 'includes_fries', 'modification_restrictions', 'servings', 'units', 'layout', 'featured',
      'available', 'is_published', 'sort_order', 'photo_id', 'video_id', 'poster_id', 'custom', 'version', 'created_at', 'updated_at'];
    this.db.transaction(() => {
      const addMedia = this.db.prepare(
        `INSERT OR IGNORE INTO media (id, kind, status, original_name, files, created_at) VALUES (?, ?, 'ready', ?, ?, ?)`,
      );
      for (const m of data.media) addMedia.run(m.id, m.kind, m.original_name, m.files, m.created_at);
      this.db.prepare('DELETE FROM products').run();
      const add = this.db.prepare(
        `INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map((c) => '@' + c).join(', ')})`,
      );
      for (const p of data.products) add.run(p);
    })();
    this.touched();
    return data.products.length;
  }
}
