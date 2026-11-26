/** Validación de todo lo que entra por la API de administración. */

export class HttpError extends Error {
  status: number;
  fields?: Record<string, string>;
  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export interface ProductInput {
  categoryId?: string;
  subcategoryId?: string | null;
  translations?: Partial<Record<'es' | 'en', { name?: string; description?: string }>>;
  priceCents?: number;
  allergens?: string[] | null;
  allergensPendingReview?: boolean;
  includesFries?: boolean;
  modificationRestrictions?: boolean;
  servings?: number | null;
  units?: number | null;
  layout?: 'grande' | 'compacta';
  featured?: boolean;
  available?: boolean;
  isPublished?: boolean;
  sortOrder?: number;
  photoId?: string | null;
  videoId?: string | null;
  posterId?: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/i;

/** Texto plano: sin caracteres de control y sin espacios sobrantes. */
const clean = (s: string) => s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ ]+/g, ' ').trim();

export function parseProduct(body: unknown, mode: 'create' | 'update'): { input: ProductInput; version?: number } {
  if (!isObject(body)) throw new HttpError(400, 'La petición no es válida.');
  const errors: Record<string, string> = {};
  const input: ProductInput = {};
  const creating = mode === 'create';

  const allowed = new Set(['categoryId', 'subcategoryId', 'translations', 'priceCents', 'allergens', 'allergensPendingReview',
    'includesFries', 'modificationRestrictions', 'servings', 'units', 'layout', 'featured', 'available', 'isPublished', 'sortOrder',
    'photoId', 'videoId', 'posterId', 'version']);
  for (const key of Object.keys(body)) if (!allowed.has(key)) errors[key] = 'Campo desconocido.';

  if (body.categoryId !== undefined) {
    if (typeof body.categoryId === 'string' && ID.test(body.categoryId)) input.categoryId = body.categoryId;
    else errors.categoryId = 'Elige una categoría.';
  } else if (creating) errors.categoryId = 'Elige una categoría.';

  if (body.subcategoryId !== undefined) {
    if (body.subcategoryId === null || (typeof body.subcategoryId === 'string' && ID.test(body.subcategoryId)))
      input.subcategoryId = body.subcategoryId as string | null;
    else errors.subcategoryId = 'Elige una subcategoría.';
  }

  if (body.translations !== undefined) {
    if (!isObject(body.translations)) errors.translations = 'Revisa los textos.';
    else {
      input.translations = {};
      for (const [l, value] of Object.entries(body.translations)) {
        if ((l !== 'es' && l !== 'en') || !isObject(value)) {
          errors.translations = 'Idioma desconocido.';
          continue;
        }
        const out: { name?: string; description?: string } = {};
        for (const [field, max] of [['name', 90], ['description', 700]] as const) {
          if (value[field] === undefined) continue;
          if (typeof value[field] !== 'string') errors[`${field}.${l}`] = 'Escribe un texto.';
          else {
            const text = clean(value[field]);
            if (text.length > max) errors[`${field}.${l}`] = `Máximo ${max} caracteres.`;
            else if (field === 'name' && !text) errors[`name.${l}`] = 'Escribe el nombre.';
            else out[field] = text;
          }
        }
        input.translations[l] = out;
      }
    }
  }
  if (creating) for (const l of ['es', 'en'] as const) if (!input.translations?.[l]?.name) errors[`name.${l}`] ??= 'Escribe el nombre.';

  if (body.priceCents !== undefined) {
    if (Number.isInteger(body.priceCents) && (body.priceCents as number) > 0 && (body.priceCents as number) <= 100_000_00)
      input.priceCents = body.priceCents as number;
    else errors.priceCents = 'Escribe un precio mayor que cero.';
  } else if (creating) errors.priceCents = 'Escribe el precio.';

  if (body.allergens !== undefined) {
    if (body.allergens === null) input.allergens = null;
    else if (Array.isArray(body.allergens) && body.allergens.length <= 30 && body.allergens.every((a) => typeof a === 'string' && ID.test(a)))
      input.allergens = [...new Set(body.allergens as string[])];
    else errors.allergens = 'Revisa los alérgenos.';
  }

  for (const key of ['allergensPendingReview', 'includesFries', 'modificationRestrictions', 'featured', 'available', 'isPublished'] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] === 'boolean') input[key] = body[key];
    else errors[key] = 'Debe ser sí o no.';
  }
  for (const key of ['servings', 'units'] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null || (Number.isInteger(body[key]) && (body[key] as number) >= 1 && (body[key] as number) <= 999))
      input[key] = body[key] as number | null;
    else errors[key] = 'Escribe un número entero o déjalo vacío.';
  }
  if (body.sortOrder !== undefined) {
    if (Number.isInteger(body.sortOrder) && (body.sortOrder as number) >= 0 && (body.sortOrder as number) <= 1_000_000)
      input.sortOrder = body.sortOrder as number;
    else errors.sortOrder = 'Escribe un número entero.';
  }
  if (body.layout !== undefined) {
    if (body.layout === 'grande' || body.layout === 'compacta') input.layout = body.layout;
    else errors.layout = 'Elige un tamaño.';
  }
  for (const key of ['photoId', 'videoId', 'posterId'] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null || (typeof body[key] === 'string' && ID.test(body[key] as string))) input[key] = body[key] as string | null;
    else errors[key] = 'Vuelve a elegir el archivo.';
  }
  if (body.version !== undefined && !Number.isInteger(body.version)) errors.version = 'Versión no válida.';

  if (Object.keys(errors).length) throw new HttpError(422, 'Revisa los campos marcados.', errors);
  return { input, version: body.version as number | undefined };
}

const COMMON = new Set(['admin', 'administrador', 'password', 'contraseña', 'contrasena', '1234567890', '12345678910', '0123456789',
  'qwertyuiop', 'administrator', 'superuser', 'restaurante', 'password123', 'admin123456', 'adminadmin']);

/** Devuelve el motivo por el que una contraseña no vale, o null si es aceptable. */
export function passwordProblem(password: unknown, username: string): string | null {
  if (typeof password !== 'string' || !password) return 'Escribe una contraseña.';
  if (password.length < 10) return 'Usa al menos 10 caracteres.';
  if (password.length > 128) return 'Usa como máximo 128 caracteres.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Esa contraseña es demasiado conocida.';
  if (lower.includes(username.toLowerCase())) return 'No incluyas el nombre de usuario.';
  if (new Set(password).size < 5) return 'Usa caracteres más variados.';
  return null;
}

const ROW_TYPES: Record<string, (v: unknown) => boolean> = {
  id: (v) => typeof v === 'string' && ID.test(v),
  slug: (v) => typeof v === 'string' && ID.test(v),
  category_id: (v) => typeof v === 'string',
  subcategory_id: (v) => v === null || typeof v === 'string',
  translations: isTranslations,
  price_cents: (v) => Number.isInteger(v) && (v as number) > 0,
  currency: (v) => v === 'EUR',
  allergens: (v) => v === null || isJson(v, (x) => Array.isArray(x) && x.every((a) => typeof a === 'string')),
  allergens_pending_review: isFlag,
  includes_fries: isFlag,
  modification_restrictions: isFlag,
  servings: isCount,
  units: isCount,
  layout: (v) => v === 'grande' || v === 'compacta',
  featured: isFlag,
  available: isFlag,
  is_published: isFlag,
  sort_order: (v) => Number.isInteger(v),
  photo_id: isRef,
  video_id: isRef,
  poster_id: isRef,
  custom: (v) => isJson(v, isObject),
  version: (v) => Number.isInteger(v),
  created_at: (v) => typeof v === 'string',
  updated_at: (v) => typeof v === 'string',
};
function isFlag(v: unknown) {
  return v === 0 || v === 1;
}
function isCount(v: unknown) {
  return v === null || (Number.isInteger(v) && (v as number) > 0);
}
function isRef(v: unknown) {
  return v === null || (typeof v === 'string' && ID.test(v));
}
function isJson(v: unknown, check: (x: any) => boolean) {
  try {
    return typeof v === 'string' && check(JSON.parse(v));
  } catch {
    return false;
  }
}
function isTranslations(v: unknown) {
  return isJson(v, (x) => isObject(x) && ['es', 'en'].every((l) => isObject(x[l]) && typeof x[l].name === 'string' && x[l].name && typeof x[l].description === 'string'));
}
const MEDIA_PATH = /^\/media\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|mp4)$/i;

/** Comprueba una copia exportada antes de tocar nada. */
export function parseImport(body: unknown): { media: any[]; products: any[] } {
  if (!isObject(body) || body.format !== 'web-carta' || body.formatVersion !== 1 || !Array.isArray(body.products) || !Array.isArray(body.media))
    throw new HttpError(422, 'Ese archivo no es una copia de esta carta.');
  if (body.products.length > 5000 || body.media.length > 20000) throw new HttpError(422, 'La copia es demasiado grande.');
  const slugs = new Set<string>();
  const ids = new Set<string>();
  let featured = 0;
  const products = body.products.map((p, i) => {
    if (!isObject(p)) throw new HttpError(422, `El producto ${i + 1} de la copia no es válido.`);
    for (const [key, ok] of Object.entries(ROW_TYPES))
      if (!ok(p[key])) throw new HttpError(422, `El producto ${i + 1} de la copia tiene un dato incorrecto (${key}).`);
    if (slugs.has(p.slug as string) || ids.has(p.id as string)) throw new HttpError(422, `La copia repite el producto «${p.slug}».`);
    slugs.add(p.slug as string);
    ids.add(p.id as string);
    featured += p.featured as number;
    return Object.fromEntries(Object.keys(ROW_TYPES).map((k) => [k, p[k]]));
  });
  if (featured > 1) throw new HttpError(422, 'La copia tiene más de un producto destacado.');
  const media = body.media.map((m) => {
    const paths = isObject(m) && isJson(m.files, (f) => isObject(f) && collect(f).every((s) => MEDIA_PATH.test(s)));
    if (!isObject(m) || !isRef(m.id) || m.id === null || (m.kind !== 'image' && m.kind !== 'video') || typeof m.original_name !== 'string' || typeof m.created_at !== 'string' || !paths)
      throw new HttpError(422, 'La copia contiene un archivo multimedia no válido.');
    return m;
  });
  return { media, products };
}
function collect(o: Record<string, unknown>): string[] {
  return Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : isObject(v) ? collect(v) : []));
}
