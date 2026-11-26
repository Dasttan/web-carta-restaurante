/**
 * Única puerta de entrada a los datos de la carta. Los productos vienen de la base de
 * datos (el servidor los incluye en la página); aquí se guardan para los componentes.
 */
import { computed, signal } from '@preact/signals';
import alergenosJson from '../data/alergenos.json';
import restauranteJson from '../data/restaurante.json';
import legalJson from '../data/legal.json';

export type Lang = 'es' | 'en';
export type Localized = Record<Lang, string>;

export interface Product {
  id: string;
  slug: string;
  category: string;
  name: Localized;
  description: Localized;
  price: number;
  /** null = no indicados (nunca se deducen). */
  allergens: string[] | null;
  /** true = el restaurante debe revisar la lista. */
  allergensPendingReview: boolean;
  includesFries: boolean;
  modificationRestrictions: boolean;
  servings: number | null;
  units: number | null;
  featured: boolean;
  available: boolean;
  layout: 'grande' | 'compacta';
  sortOrder: number;
  media: Media;
}

export interface ImageAsset {
  src: string;
  srcset: string;
  width: number;
  height: number;
}

export interface Media {
  poster: ImageAsset | null;
  photo: ImageAsset | null;
  video: { high: string; low: string } | null;
}

export interface Category {
  id: string;
  name: Localized;
  type: 'productos' | 'extras';
}

export interface ExtraItem {
  id: string;
  name: Localized;
  price: number;
  available: boolean;
}

export interface ExtraGroup {
  id: string;
  name: Localized;
  items: ExtraItem[];
}

export interface MenuData {
  categories: Category[];
  products: Product[];
  extras: { title: Localized; groups: ExtraGroup[] };
}

const menu = signal<MenuData>({ categories: [], products: [], extras: { title: { es: '', en: '' }, groups: [] } });
export const setMenu = (data: MenuData) => (menu.value = data);

export const products = computed(() => menu.value.products);
export const categories = computed(() => menu.value.categories);
export const extras = computed(() => menu.value.extras);
export const productsOf = (categoryId: string) => products.value.filter((p) => p.category === categoryId);

export const allergenNames = alergenosJson as Record<string, Localized>;
export const restaurant = restauranteJson;
export const legalPages = legalJson;

/** Vuelve a pedir la carta: precios y disponibilidad al día sin recargar. */
export async function refreshMenu(): Promise<void> {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) return;
    const data = (await res.json()) as MenuData;
    if (JSON.stringify(data) !== JSON.stringify(menu.value)) menu.value = data;
  } catch {
    /* sin conexión: se conserva la carta que ya se ve */
  }
}
