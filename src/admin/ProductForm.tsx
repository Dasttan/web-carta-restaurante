import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createProduct, getProduct, loadOptions, options, updateProduct, type AdminProduct, type ApiError, type MediaItem } from './api';
import { MediaField } from './MediaField';
import { BASE, dirty, go, linkTo } from './router';
import { Check, Field, Icon, languageName, notify, parsePrice, priceText, Spinner, useLock } from './ui';

interface Draft {
  categoryId: string;
  subcategoryId: string;
  price: string;
  sortOrder: string;
  texts: Record<string, { name: string; description: string }>;
  allergensKnown: boolean;
  allergens: string[];
  allergensPendingReview: boolean;
  includesFries: boolean;
  modificationRestrictions: boolean;
  servings: string;
  units: string;
  layout: 'grande' | 'compacta';
  featured: boolean;
  available: boolean;
  isPublished: boolean;
  photo: MediaItem | null;
  video: MediaItem | null;
  poster: MediaItem | null;
}

function toDraft(p: AdminProduct | null, languages: string[]): Draft {
  return {
    categoryId: p?.categoryId ?? '',
    subcategoryId: p?.subcategoryId ?? '',
    price: p ? priceText(p.priceCents) : '',
    sortOrder: p ? String(p.sortOrder) : '',
    texts: Object.fromEntries(languages.map((l) => [l, { name: p?.name[l] ?? '', description: p?.description[l] ?? '' }])),
    allergensKnown: p ? p.allergens !== null : false,
    allergens: p?.allergens ?? [],
    allergensPendingReview: p?.allergensPendingReview ?? false,
    includesFries: p?.includesFries ?? false,
    modificationRestrictions: p?.modificationRestrictions ?? false,
    servings: p?.servings ? String(p.servings) : '',
    units: p?.units ? String(p.units) : '',
    layout: p?.layout ?? 'compacta',
    featured: p?.featured ?? false,
    available: p?.available ?? true,
    isPublished: p?.isPublished ?? false,
    photo: p?.photo ?? null,
    video: p?.video ?? null,
    poster: p?.poster ?? null,
  };
}

const count = (s: string) => (s.trim() === '' ? null : Number(s));

/** Lo que se envía al servidor. Al editar, solo lo que ha cambiado. */
function payload(d: Draft, before: Draft | null, simple: boolean): Record<string, unknown> {
  const flat = (x: Draft): Record<string, unknown> => ({
    categoryId: x.categoryId,
    subcategoryId: x.subcategoryId || null,
    priceCents: parsePrice(x.price),
    ...(x.sortOrder.trim() === '' ? {} : { sortOrder: Number(x.sortOrder) }),
    isPublished: x.isPublished,
    available: x.available,
    ...(simple
      ? {}
      : {
          allergens: x.allergensKnown ? [...x.allergens].sort() : null,
          allergensPendingReview: x.allergensPendingReview,
          includesFries: x.includesFries,
          modificationRestrictions: x.modificationRestrictions,
          servings: count(x.servings),
          units: count(x.units),
          layout: x.layout,
          featured: x.featured,
          photoId: x.photo?.id ?? null,
          videoId: x.video?.id ?? null,
          posterId: x.poster?.id ?? null,
        }),
  });
  const now = flat(d);
  const old = before ? flat(before) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(now)) if (!before || JSON.stringify(v) !== JSON.stringify(old[k])) out[k] = v;

  const translations: Record<string, Record<string, string>> = {};
  for (const [l, t] of Object.entries(d.texts)) {
    for (const f of ['name', 'description'] as const) {
      if (simple && f === 'description') continue;
      if (!before || t[f] !== before.texts[l]?.[f]) (translations[l] ??= {})[f] = t[f];
    }
  }
  if (Object.keys(translations).length) out.translations = translations;
  return out;
}

export function ProductForm({ id }: { id?: string }) {
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const initial = useRef<Draft | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const lock = useLock();

  const load = () => {
    setLoadError('');
    Promise.all([loadOptions(), id ? getProduct(id) : null]).then(
      ([opts, p]) => {
        const d = toDraft(p, opts.languages);
        initial.current = d;
        setProduct(p);
        setDraft(d);
      },
      (e: ApiError) => setLoadError(e.message),
    );
  };
  useEffect(load, [id]);

  const changed = useMemo(() => Boolean(draft && JSON.stringify(draft) !== JSON.stringify(initial.current)), [draft]);
  useEffect(() => {
    dirty.value = changed || uploading > 0;
    return () => void (dirty.value = false);
  }, [changed, uploading]);

  if (loadError)
    return (
      <div class="empty">
        <h1>No se ha podido abrir el producto</h1>
        <p>{loadError}</p>
        <a class="btn btn--primary" {...linkTo(BASE)}>
          Volver a los productos
        </a>
      </div>
    );
  const opts = options.value;
  if (!draft || !opts) return <Spinner label="Abriendo…" />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d!, [key]: value }));
  const setText = (l: string, f: 'name' | 'description', v: string) =>
    setDraft((d) => ({ ...d!, texts: { ...d!.texts, [l]: { ...d!.texts[l], [f]: v } } }));

  const category = opts.categories.find((c) => c.id === draft.categoryId);
  const simple = category?.type === 'extras';

  function check(d: Draft): Record<string, string> {
    const e: Record<string, string> = {};
    if (!d.categoryId) e.categoryId = 'Elige una categoría.';
    if (category?.subcategories.length && !d.subcategoryId) e.subcategoryId = 'Elige una subcategoría.';
    const cents = parsePrice(d.price);
    if (cents === null || cents <= 0) e.priceCents = 'Escribe un precio, por ejemplo 12,50.';
    for (const l of opts!.languages) if (!d.texts[l].name.trim()) e[`name.${l}`] = 'Escribe el nombre.';
    for (const k of ['servings', 'units', 'sortOrder'] as const)
      if (d[k].trim() && !/^\d{1,6}$/.test(d[k].trim())) e[k] = 'Escribe un número entero.';
    return e;
  }

  function submit(e: Event) {
    e.preventDefault();
    void lock(save);
  }

  async function save() {
    const found = check(draft!);
    setErrors(found);
    if (Object.keys(found).length) return focusFirst();
    const body = payload(draft!, id ? initial.current : null, simple);
    if (id && !Object.keys(body).length) return void go(BASE, true);
    setSaving(true);
    try {
      if (id) await updateProduct(id, { ...body, version: product!.version });
      else await createProduct(body);
      notify(id ? 'Cambios guardados.' : 'Producto añadido correctamente.');
      await go(BASE, true);
    } catch (err) {
      const { message, fields } = err as ApiError;
      setErrors(fields);
      notify(message, true);
      focusFirst();
    } finally {
      setSaving(false);
    }
  }
  const focusFirst = () =>
    setTimeout(() => form.current?.querySelector<HTMLElement>('.field--error input, .field--error select, .field--error textarea')?.focus(), 30);

  const invalid = (key: string, inputId: string) => ({
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${inputId}-error` : undefined,
  });

  return (
    <form class="form" ref={form} onSubmit={submit} noValidate>
      <div class="page-head">
        <div>
          <a class="back" {...linkTo(BASE)}>
            <Icon name="back" />
            Productos
          </a>
          <h1>{id ? product!.name.es : 'Añadir producto'}</h1>
        </div>
        {id && product!.isPublished && !simple && (
          <a class="btn" href={`/#${product!.slug}`} target="_blank" rel="noopener">
            <Icon name="external" />
            Ver en la carta
          </a>
        )}
      </div>

      <fieldset class="panel">
        <legend>Información general</legend>
        <div class="grid">
          <Field id="categoria" label="Categoría" error={errors.categoryId}>
            <select
              id="categoria"
              value={draft.categoryId}
              {...invalid('categoryId', 'categoria')}
              onChange={(e) => setDraft({ ...draft, categoryId: e.currentTarget.value, subcategoryId: '', sortOrder: '' })}
            >
              <option value="" disabled>
                Elige una…
              </option>
              {opts.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name.es}
                </option>
              ))}
            </select>
          </Field>
          {category && category.subcategories.length > 0 && (
            <Field id="subcategoria" label="Subcategoría" error={errors.subcategoryId}>
              <select
                id="subcategoria"
                value={draft.subcategoryId}
                {...invalid('subcategoryId', 'subcategoria')}
                onChange={(e) => setDraft({ ...draft, subcategoryId: e.currentTarget.value, sortOrder: '' })}
              >
                <option value="" disabled>
                  Elige una…
                </option>
                {category.subcategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name.es}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="precio" label="Precio" error={errors.priceCents}>
            <div class="suffix">
              <input
                id="precio"
                inputMode="decimal"
                autocomplete="off"
                maxLength={9}
                value={draft.price}
                {...invalid('priceCents', 'precio')}
                onInput={(e) => set('price', e.currentTarget.value)}
              />
              <span>€</span>
            </div>
          </Field>
          <Field id="orden" label="Orden" optional hint="Los números más bajos salen antes. Vacío: al final." error={errors.sortOrder}>
            <input id="orden" inputMode="numeric" value={draft.sortOrder} {...invalid('sortOrder', 'orden')} onInput={(e) => set('sortOrder', e.currentTarget.value)} />
          </Field>
        </div>
      </fieldset>

      <fieldset class="panel">
        <legend>{simple ? 'Nombre' : 'Nombre y descripción'}</legend>
        <div class="grid">
          {opts.languages.map((l) => (
            <div key={l} class="lang-col" lang={l}>
              <Field id={`nombre-${l}`} label={`Nombre en ${languageName(l).toLowerCase()}`} error={errors[`name.${l}`]}>
                <input id={`nombre-${l}`} maxLength={90} value={draft.texts[l].name} {...invalid(`name.${l}`, `nombre-${l}`)} onInput={(e) => setText(l, 'name', e.currentTarget.value)} />
              </Field>
              {!simple && (
                <Field id={`texto-${l}`} label={`Descripción e ingredientes en ${languageName(l).toLowerCase()}`} optional error={errors[`description.${l}`]}>
                  <textarea id={`texto-${l}`} rows={4} maxLength={700} value={draft.texts[l].description} {...invalid(`description.${l}`, `texto-${l}`)} onInput={(e) => setText(l, 'description', e.currentTarget.value)} />
                </Field>
              )}
            </div>
          ))}
        </div>
      </fieldset>

      {!simple && (
        <>
          <fieldset class="panel">
            <legend>Fotos y vídeo</legend>
            <div class="media-grid">
              <MediaField label="Foto" kind="image" value={draft.photo} hint="Se ve cuando no hay vídeo, o con el botón «Ver foto»." onChange={(m) => set('photo', m)} onBusy={(d) => setUploading((n) => n + d)} />
              <MediaField label="Vídeo" kind="video" value={draft.video} hint="Mejor vertical y de 6 a 15 segundos. Se reproduce sin sonido." onChange={(m) => set('video', m)} onBusy={(d) => setUploading((n) => n + d)} />
              {draft.video && (
                <MediaField
                  label="Portada del vídeo"
                  kind="image"
                  value={draft.poster}
                  fallback={draft.video.thumb}
                  hint="Opcional. Si no eliges ninguna, se usa una imagen del propio vídeo."
                  onChange={(m) => set('poster', m)}
                  onBusy={(d) => setUploading((n) => n + d)}
                />
              )}
            </div>
          </fieldset>

          <fieldset class="panel">
            <legend>Alérgenos</legend>
            <div class="choices" role="radiogroup" aria-label="Alérgenos">
              <label class="check">
                <input type="radio" name="alergenos" checked={draft.allergensKnown} onChange={() => set('allergensKnown', true)} />
                <span>Los indico aquí</span>
              </label>
              <label class="check">
                <input type="radio" name="alergenos" checked={!draft.allergensKnown} onChange={() => set('allergensKnown', false)} />
                <span>
                  No los sé<small>La carta pedirá que pregunten al personal.</small>
                </span>
              </label>
            </div>
            {draft.allergensKnown && (
              <>
                <div class="pills">
                  {Object.entries(opts.allergens).map(([key, name]) => (
                    <label key={key} class="pill">
                      <input
                        type="checkbox"
                        checked={draft.allergens.includes(key)}
                        onChange={(e) =>
                          set('allergens', e.currentTarget.checked ? [...draft.allergens, key] : draft.allergens.filter((a) => a !== key))
                        }
                      />
                      <span>{name.es}</span>
                    </label>
                  ))}
                </div>
                <Check label="Pedir que los confirmen con el personal" checked={draft.allergensPendingReview} onChange={(v) => set('allergensPendingReview', v)} />
              </>
            )}
            {errors.allergens && <p class="field__error">{errors.allergens}</p>}
          </fieldset>

          <fieldset class="panel">
            <legend>Información adicional</legend>
            <div class="grid">
              <Field id="personas" label="Número de personas" optional error={errors.servings}>
                <input id="personas" inputMode="numeric" maxLength={3} value={draft.servings} {...invalid('servings', 'personas')} onInput={(e) => set('servings', e.currentTarget.value)} />
              </Field>
              <Field id="unidades" label="Unidades por ración" optional error={errors.units}>
                <input id="unidades" inputMode="numeric" maxLength={3} value={draft.units} {...invalid('units', 'unidades')} onInput={(e) => set('units', e.currentTarget.value)} />
              </Field>
              <Field id="tamano" label="Tamaño en pantallas grandes">
                <select id="tamano" value={draft.layout} onChange={(e) => set('layout', e.currentTarget.value as Draft['layout'])}>
                  <option value="grande">Grande</option>
                  <option value="compacta">Compacto</option>
                </select>
              </Field>
            </div>
            <Check label="Incluye patatas" checked={draft.includesFries} onChange={(v) => set('includesFries', v)} />
            <Check label="No se pueden modificar sus ingredientes" checked={draft.modificationRestrictions} onChange={(v) => set('modificationRestrictions', v)} />
            <Check label="Producto destacado" hint="Sale el primero y en grande. Solo puede haber uno: sustituye al actual." checked={draft.featured} onChange={(v) => set('featured', v)} />
          </fieldset>
        </>
      )}

      <fieldset class="panel">
        <legend>Estado</legend>
        <div class="choices" role="radiogroup" aria-label="Estado de publicación">
          <label class="check">
            <input type="radio" name="estado" checked={!draft.isPublished} onChange={() => set('isPublished', false)} />
            <span>
              Oculto<small>Solo se ve en este panel.</small>
            </span>
          </label>
          <label class="check">
            <input type="radio" name="estado" checked={draft.isPublished} onChange={() => set('isPublished', true)} />
            <span>
              Publicado<small>Se ve en la carta.</small>
            </span>
          </label>
        </div>
        <Check label="Disponible" hint="Si lo desmarcas, sigue en la carta con el aviso «No disponible»." checked={draft.available} onChange={(v) => set('available', v)} />
      </fieldset>

      <div class="save-bar">
        <span class="save-bar__state" role="status">
          {uploading > 0 ? 'Espera a que termine la subida.' : changed ? 'Hay cambios sin guardar.' : ''}
        </span>
        <button type="button" class="btn" disabled={saving} onClick={() => go(BASE)}>
          Cancelar
        </button>
        <button type="submit" class="btn btn--primary" disabled={saving || uploading > 0}>
          {saving && <span class="spinner" aria-hidden="true" />}
          {saving ? 'Guardando…' : id ? 'Guardar cambios' : 'Añadir producto'}
        </button>
      </div>
    </form>
  );
}
