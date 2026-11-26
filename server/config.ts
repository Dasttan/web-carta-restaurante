/** Configuración del servidor. Los secretos llegan por variables de entorno o por `.env`. */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.CARTA_IGNORAR_ENV !== '1' && existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const number = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const production = process.env.NODE_ENV === 'production';
const dataDir = resolve(ROOT, process.env.DATA_DIR || 'data');

export const config = {
  production,
  /** Con recarga en vivo (vite) para desarrollar. */
  dev: process.argv.includes('--dev'),
  port: number(process.env.PORT, 4188),
  /** Fuera de producción solo se atiende a este ordenador. */
  host: process.env.HOST || (production ? '0.0.0.0' : 'localhost'),
  /** Origen público, p. ej. https://carta.midominio.com (obligatorio en producción). */
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
  /** Número de proxies de confianza delante (Caddy, Nginx…). */
  trustProxy: Number(process.env.TRUST_PROXY || 0) || 0,
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  dataDir,
  dbFile: join(dataDir, 'carta.db'),
  mediaDir: join(dataDir, 'media'),
  tmpDir: join(dataDir, 'tmp'),
  backupDir: join(dataDir, 'copias'),
  seedDir: join(ROOT, 'seed'),
  distDir: join(ROOT, 'dist'),
  maxImageBytes: number(process.env.MAX_IMAGE_MB, 15) * 1024 * 1024,
  maxVideoBytes: number(process.env.MAX_VIDEO_MB, 150) * 1024 * 1024,
  sessionHours: number(process.env.SESSION_HOURS, 12),
  idleHours: number(process.env.SESSION_IDLE_HOURS, 2),
};
