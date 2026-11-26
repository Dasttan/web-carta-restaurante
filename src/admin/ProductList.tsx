import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { deleteProduct, loadOptions, loadProducts, moveProduct, options, products, setPublished, type AdminProduct, type ApiError } from './api';
import { BASE, linkTo } from './router';
import { confirmDialog, Icon, money, notify, plain, Spinner, useLock, type IconName } from './ui';

/* Se conservan al volver de editar un producto. */
const search = signal('');
const category = signal('');
const status = signal<'' | 'publicado' | 'oculto'>('');
const onlyFeatured = signal(false);
const page = signal(1);
const PAGE_SIZE = 25;

const filter = <T,>(s: { value: T }, v: T) => {
  s.value = v;
  page.value = 1;
};

export function ProductList() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useLock();

  const load = () => {
    setError('');
    Promise.all([loadOptions(), loadProducts()]).catch((e: ApiError) => setError(e.message));
  };
  useEffect(load, []);

  const all = products.value;
  const opts = options.value;
  if (error)
    return (
      <div class="empty">
        <h1>No se han podido cargar los productos</h1>
        <p>{error}</p>
        <button type="button" class="btn btn--primary" onClick={load}>
          Reintentar
        </button>
      </div>
    );
  if (!all || !opts) return <Spinner label="Cargando productos…" />;

  const q = plain(search.value);
  const shown = all.filter(
    (p) =>
      (!q || Object.values(p.name).some((n) => plain(n).includes(q))) &&
      (!category.value || p.categoryId === category.value) &&
      (!status.value || p.isPublished === (status.value === 'publicado')) &&
      (!onlyFeatured.value || p.featured),
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page.value, pages);
  const rows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const published = all.filter((p) => p.isPublished).length;
  const filtering = Boolean(q || category.value || status.value || onlyFeatured.value);

  const act = (id: string, job: () => Promise<void>) =>
    lock(async () => {
      setBusy(id);
      try {
        await job();
      } catch (e) {
        const err = e as ApiError;
        notify(err.message, true);
        if (err.status === 404) await loadProducts().catch(() => {});
      } finally {
        setBusy(null);
      }
    });

  const toggle = (p: AdminProduct) =>
    act(p.id, async () => {
      const next = await setPublished(p.id, !p.isPublished);
      products.value = products.value!.map((x) => (x.id === p.id ? next : x));
      notify(next.isPublished ? `«${p.name.es}» publicado correctamente.` : `«${p.name.es}» ocultado de la carta.`);
    });

  const remove = async (p: AdminProduct) => {
    const ok = await confirmDialog({
      title: `¿Eliminar «${p.name.es}»?`,
      message: (
        <>
          <p>Se borrará el producto con sus textos, precio y traducciones. Esta acción es definitiva.</p>
          <p>Si solo quieres retirarlo un tiempo, usa «Ocultar»: podrás volver a publicarlo cuando quieras.</p>
        </>
      ),
      confirmLabel: 'Eliminar definitivamente',
      danger: true,
    });
    if (!ok) return;
    await act(p.id, async () => {
      await deleteProduct(p.id);
      await loadProducts();
      notify('Producto eliminado.');
    });
  };

  const categoryOf = (p: AdminProduct) => {
    const c = opts.categories.find((x) => x.id === p.categoryId);
    const s = c?.subcategories.find((x) => x.id === p.subcategoryId);
    return s ? `${c!.name.es} · ${s.name.es}` : (c?.name.es ?? '');
  };
  const siblings = (p: AdminProduct) => all.filter((x) => x.categoryId === p.categoryId && x.subcategoryId === p.subcategoryId);

  return (
    <>
      <div class="page-head">
        <h1>Productos</h1>
        <a class="btn btn--primary" {...linkTo(`${BASE}/nuevo`)}>
          <Icon name="plus" />
          Añadir producto
        </a>
      </div>

      <dl class="counts">
        <div>
          <dt>Total</dt>
          <dd>{all.length}</dd>
        </div>
        <div>
          <dt>Publicados</dt>
          <dd>{published}</dd>
        </div>
        <div>
          <dt>Ocultos</dt>
          <dd>{all.length - published}</dd>
        </div>
      </dl>

      <div class="filters" role="search">
        <div class="filters__search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Buscar por nombre"
            placeholder="Buscar por nombre"
            value={search.value}
            onInput={(e) => filter(search, e.currentTarget.value)}
          />
        </div>
        <select aria-label="Categoría" value={category.value} onChange={(e) => filter(category, e.currentTarget.value)}>
          <option value="">Todas las categorías</option>
          {opts.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name.es}
            </option>
          ))}
        </select>
        <select aria-label="Estado" value={status.value} onChange={(e) => filter(status, e.currentTarget.value as '')}>
          <option value="">Publicados y ocultos</option>
          <option value="publicado">Solo publicados</option>
          <option value="oculto">Solo ocultos</option>
        </select>
        <label class="filters__check">
          <input type="checkbox" checked={onlyFeatured.value} onChange={(e) => filter(onlyFeatured, e.currentTarget.checked)} />
          Destacados
        </label>
      </div>

      {rows.length === 0 ? (
        <div class="empty">
          <h2>{filtering ? 'Ningún producto coincide' : 'Todavía no hay productos'}</h2>
          {filtering ? (
            <button
              type="button"
              class="btn"
              onClick={() => {
                search.value = category.value = status.value = '';
                onlyFeatured.value = false;
              }}
            >
              Quitar filtros
            </button>
          ) : (
            <a class="btn btn--primary" {...linkTo(`${BASE}/nuevo`)}>
              Añadir el primero
            </a>
          )}
        </div>
      ) : (
        <table class="products">
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Categoría</th>
              <th scope="col" class="num">
                Precio
              </th>
              <th scope="col">Estado</th>
              <th scope="col">Orden</th>
              <th scope="col">
                <span class="sr">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const group = siblings(p);
              const position = group.findIndex((x) => x.id === p.id);
              const working = busy === p.id;
              return (
                <tr key={p.id} class={p.isPublished ? undefined : 'is-hidden'} aria-busy={working || undefined}>
                  <td class="cell-main">
                    <div class="cell-product">
                    <Thumb product={p} />
                    <div>
                      <a class="cell-name" {...linkTo(`${BASE}/producto/${p.id}`)}>
                        {p.name.es}
                      </a>
                      {p.featured && (
                        <span class="tag tag--star">
                          <Icon name="star" />
                          Destacado
                        </span>
                      )}
                      {!p.available && <span class="tag">No disponible</span>}
                    </div>
                    </div>
                  </td>
                  <td class="cell-cat">{categoryOf(p)}</td>
                  <td class="cell-price num">{money(p.priceCents)}</td>
                  <td class="cell-state">
                    <span class={`state${p.isPublished ? ' state--on' : ''}`}>{p.isPublished ? 'Publicado' : 'Oculto'}</span>
                  </td>
                  <td class="cell-order">
                    <span class="order">
                      <span class="order__n" aria-label={`Posición ${position + 1} de ${group.length}`}>
                        {position + 1}
                      </span>
                      <IconButton icon="up" label={`Subir ${p.name.es}`} disabled={!!busy || position === 0} onClick={() => act(p.id, () => moveProduct(p.id, 'up'))} />
                      <IconButton icon="down" label={`Bajar ${p.name.es}`} disabled={!!busy || position === group.length - 1} onClick={() => act(p.id, () => moveProduct(p.id, 'down'))} />
                    </span>
                  </td>
                  <td class="cell-actions">
                    <a class="btn btn--small" {...linkTo(`${BASE}/producto/${p.id}`)} aria-label={`Editar ${p.name.es}`}>
                      <Icon name="edit" />
                      Editar
                    </a>
                    <button
                      type="button"
                      class={`btn btn--small btn--toggle${p.isPublished ? '' : ' btn--publish'}`}
                      disabled={!!busy}
                      aria-label={`${p.isPublished ? 'Ocultar' : 'Publicar'} ${p.name.es}`}
                      onClick={() => toggle(p)}
                    >
                      {working ? <span class="spinner" aria-hidden="true" /> : <Icon name={p.isPublished ? 'eye-off' : 'eye'} />}
                      {p.isPublished ? 'Ocultar' : 'Publicar'}
                    </button>
                    <button type="button" class="btn btn--small btn--quiet-danger" disabled={!!busy} aria-label={`Eliminar ${p.name.es}`} onClick={() => remove(p)}>
                      <Icon name="trash" />
                      Eliminar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <nav class="pager" aria-label="Páginas">
          <button type="button" class="btn btn--small" disabled={current === 1} onClick={() => (page.value = current - 1)}>
            Anterior
          </button>
          <span>
            Página {current} de {pages}
          </span>
          <button type="button" class="btn btn--small" disabled={current === pages} onClick={() => (page.value = current + 1)}>
            Siguiente
          </button>
        </nav>
      )}
    </>
  );
}

function Thumb({ product }: { product: AdminProduct }) {
  return product.thumb ? (
    <img class="thumb" src={product.thumb} width="56" height="56" alt="" loading="lazy" />
  ) : (
    <span class="thumb thumb--none" aria-hidden="true">
      {product.name.es.slice(0, 1)}
    </span>
  );
}

function IconButton(props: { icon: IconName; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" class="icon-btn" title={props.label} aria-label={props.label} disabled={props.disabled} onClick={props.onClick}>
      <Icon name={props.icon} />
    </button>
  );
}
