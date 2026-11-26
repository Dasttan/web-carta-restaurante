/** Proveedor de datos y de acceso del panel. Todo pasa por aquí. */
import { signal } from '@preact/signals';

export type LangCode = string;
export interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  status: 'processing' | 'ready' | 'error';
  name: string;
  error: string | null;
  thumb: string | null;
  url: string | null;
  usedBy: string[];
}
export interface AdminProduct {
  id: string;
  slug: string;
  categoryId: string;
  subcategoryId: string | null;
  name: Record<LangCode, string>;
  description: Record<LangCode, string>;
  priceCents: number;
  allergens: string[] | null;
  allergensPendingReview: boolean;
  includesFries: boolean;
  modificationRestrictions: boolean;
  servings: number | null;
  units: number | null;
  layout: 'grande' | 'compacta';
  featured: boolean;
  available: boolean;
  isPublished: boolean;
  sortOrder: number;
  photo: MediaItem | null;
  video: MediaItem | null;
  poster: MediaItem | null;
  thumb: string | null;
  version: number;
}
export interface CategoryOption {
  id: string;
  type: 'productos' | 'extras';
  name: Record<LangCode, string>;
  subcategories: { id: string; name: Record<LangCode, string> }[];
}
export interface Options {
  languages: LangCode[];
  categories: CategoryOption[];
  allergens: Record<string, Record<LangCode, string>>;
  limits: { imageMb: number; videoMb: number };
}
export interface Session {
  username: string;
  csrf: string;
  mustChange: boolean;
}

export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;
  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export const session = signal<Session | null>(null);
export const restaurantName = signal('');
export const products = signal<AdminProduct[] | null>(null);
export const options = signal<Options | null>(null);

const OFFLINE = 'No hay conexión con el servidor. Comprueba tu internet e inténtalo otra vez.';

function expired(status: number, path: string): void {
  if (status === 401 && path !== '/login' && session.value) {
    session.value = null;
    products.value = null;
    history.replaceState(null, '', '/superuser/login');
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session.value ? { 'X-CSRF-Token': session.value.csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    expired(res.status, path);
    throw new ApiError(res.status, data.error ?? 'Algo ha fallado. Inténtalo de nuevo.', data.fields);
  }
  return data as T;
}

export async function loadSession(): Promise<void> {
  const data = await request<{ session: Session | null; restaurant: Record<string, string> }>('GET', '/session');
  session.value = data.session;
  restaurantName.value = data.restaurant.es;
}
export async function login(username: string, password: string): Promise<void> {
  session.value = await request<Session>('POST', '/login', { username, password });
}
export async function logout(): Promise<void> {
  await request('POST', '/logout');
  session.value = null;
  products.value = null;
}
export async function changePassword(current: string, next: string, confirm: string): Promise<void> {
  session.value = await request<Session>('POST', '/change-password', { current, next, confirm });
}

export async function loadOptions(): Promise<Options> {
  return (options.value ??= await request<Options>('GET', '/options'));
}
export async function loadProducts(): Promise<AdminProduct[]> {
  return (products.value = (await request<{ products: AdminProduct[] }>('GET', '/products')).products);
}
export const getProduct = (id: string) => request<AdminProduct>('GET', `/products/${encodeURIComponent(id)}`);
export const createProduct = (body: unknown) => request<AdminProduct>('POST', '/products', body);
export const updateProduct = (id: string, body: unknown) =>
  request<AdminProduct>('PATCH', `/products/${encodeURIComponent(id)}`, body);
export const setPublished = (id: string, isPublished: boolean) =>
  request<AdminProduct>('PATCH', `/products/${encodeURIComponent(id)}/status`, { isPublished });
export const deleteProduct = (id: string) => request<{ name: string }>('DELETE', `/products/${encodeURIComponent(id)}`);
export async function moveProduct(id: string, direction: 'up' | 'down'): Promise<void> {
  const data = await request<{ products: AdminProduct[] }>('POST', `/products/${encodeURIComponent(id)}/move`, { direction });
  products.value = data.products;
}

export const listMedia = (kind: 'image' | 'video') => request<{ media: MediaItem[] }>('GET', `/media?kind=${kind}`);
export const getMedia = (id: string) => request<MediaItem>('GET', `/media/${id}`);
export const deleteMedia = (id: string) => request('DELETE', `/media/${id}`);

/** Subida con progreso. Los vídeos siguen convirtiéndose después: hay que esperar a `ready`. */
export function uploadMedia(file: File, onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/admin/media?name=${encodeURIComponent(file.name)}`);
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-CSRF-Token', session.value?.csrf ?? '');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status < 300) return resolve(xhr.response);
      expired(xhr.status, '/media');
      reject(new ApiError(xhr.status, xhr.response?.error ?? 'No se ha podido subir el archivo.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'La subida se ha interrumpido. Puede que el archivo sea demasiado grande.'));
    xhr.onabort = () => reject(new ApiError(0, 'Subida cancelada.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

export interface ImportSummary {
  applied: boolean;
  products: number;
  published: number;
  hidden: number;
  current: number;
  backup?: string;
}
export const importBackup = (data: unknown, confirmed: boolean) =>
  request<ImportSummary>('POST', `/import${confirmed ? '?confirmar=si' : ''}`, data);
