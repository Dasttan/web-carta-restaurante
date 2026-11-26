/** Contraseñas, sesiones y límite de intentos. */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Db } from './db.ts';
import { config } from './config.ts';
import { HttpError, passwordProblem } from './validate.ts';

const SCRYPT = { N: 2 ** 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const KEY_LENGTH = 64;

const derive = (password: string, salt: Buffer, params = SCRYPT) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, params, (err, key) => (err ? reject(err) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, N, r, p, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), { ...SCRYPT, N: +N, r: +r, p: +p });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

interface User {
  id: number;
  username: string;
  password_hash: string;
  is_default: number;
}
export interface Session {
  tokenHash: string;
  userId: number;
  username: string;
  csrf: string;
  mustChange: boolean;
}

const COOKIE = config.production ? '__Host-carta' : 'carta-sesion';
const HOUR = 3600_000;
const WINDOW = 15 * 60_000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_IP = 20;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Intento con la contraseña por defecto del entorno local. Nunca vale en producción. */
const isWeakDefault = (password: string) => password === 'admin';

export class Auth {
  private db: Db;
  private dummy = '';

  constructor(db: Db) {
    this.db = db;
  }

  /** Crea la cuenta inicial y, en producción, se niega a arrancar con una contraseña insegura. */
  async init(): Promise<void> {
    this.dummy = await hashPassword(randomBytes(12).toString('hex'));
    let user = this.db.prepare('SELECT * FROM users LIMIT 1').get() as User | undefined;
    if (!user) {
      if (!config.adminPassword)
        throw new Error('Falta la contraseña inicial: define ADMIN_PASSWORD en .env (mira .env.example) y vuelve a arrancar.');
      const problem = passwordProblem(config.adminPassword, config.adminUser);
      if (problem && config.production) throw new Error(`ADMIN_PASSWORD no es segura para producción. ${problem}`);
      await this.setPassword(config.adminUser, config.adminPassword, Boolean(problem));
      console.log(`Cuenta «${config.adminUser}» creada.`);
      user = this.db.prepare('SELECT * FROM users LIMIT 1').get() as User;
    }
    if (config.production) {
      const weak = user.is_default || (await verifyPassword('admin', user.password_hash));
      if (weak) throw new Error('La cuenta usa la contraseña de desarrollo. Cámbiala con: npm run clave');
    }
    this.db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - config.sessionHours * HOUR);
  }

  async setPassword(username: string, password: string, isDefault = false): Promise<void> {
    const hash = await hashPassword(password);
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (id, username, password_hash, is_default, updated_at) VALUES (1, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash,
             is_default = excluded.is_default, updated_at = excluded.updated_at`,
        )
        .run(username, hash, +isDefault, new Date().toISOString());
      this.db.prepare('DELETE FROM sessions').run();
      this.db.prepare('DELETE FROM login_attempts').run();
    })();
  }

  /* ---------- Límite de intentos (persiste aunque se reinicie) ---------- */

  private attempts(key: string, since: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?').get(key, since) as { n: number }).n;
  }

  private checkLimit(res: Response, keys: [string, number][]): void {
    const since = Date.now() - WINDOW;
    this.db.prepare('DELETE FROM login_attempts WHERE at <= ?').run(since);
    for (const [key, max] of keys) {
      if (this.attempts(key, since) < max) continue;
      const { first } = this.db.prepare('SELECT MIN(at) AS first FROM login_attempts WHERE key = ?').get(key) as { first: number };
      const seconds = Math.max(1, Math.ceil((first + WINDOW - Date.now()) / 1000));
      res.setHeader('Retry-After', String(seconds));
      throw new HttpError(429, `Demasiados intentos. Vuelve a probar dentro de ${Math.ceil(seconds / 60)} min.`);
    }
  }

  private noteFailure(keys: [string, number][]): void {
    const add = this.db.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)');
    for (const [key] of keys) add.run(key, Date.now());
  }

  /* ---------- Sesiones ---------- */

  async login(req: Request, res: Response): Promise<Session> {
    const { username, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password)
      throw new HttpError(422, 'Escribe tu usuario y tu contraseña.');
    if (username.length > 100 || password.length > 200) throw new HttpError(401, 'El usuario o la contraseña no son correctos.');

    const ip = req.ip ?? 'desconocida';
    const keys: [string, number][] = [[`cuenta:${sha(username.trim().toLowerCase())}:${ip}`, MAX_PER_ACCOUNT], [`ip:${ip}`, MAX_PER_IP]];
    this.checkLimit(res, keys);
    // Se apunta antes de comprobar: así varios intentos a la vez no esquivan el límite.
    this.noteFailure(keys);

    const user = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as User | undefined;
    const ok = await verifyPassword(password, user?.password_hash ?? this.dummy);
    if (!user || !ok || (config.production && isWeakDefault(password)))
      throw new HttpError(401, 'El usuario o la contraseña no son correctos.');

    for (const [key] of keys) this.db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
    return this.open(res, user);
  }

  private open(res: Response, user: User): Session {
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const now = Date.now();
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha(token), user.id, csrf, now, now);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: config.production,
      sameSite: 'strict',
      path: '/',
      maxAge: config.sessionHours * HOUR,
    });
    return { tokenHash: sha(token), userId: user.id, username: user.username, csrf, mustChange: !!user.is_default };
  }

  session(req: Request): Session | null {
    const cookie = req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    const token = cookie?.slice(COOKIE.length + 1);
    if (!token || token.length > 100) return null;
    const row = this.db
      .prepare(`SELECT s.*, u.username, u.is_default FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
      .get(sha(token)) as any;
    if (!row) return null;
    const now = Date.now();
    if (now - row.created_at > config.sessionHours * HOUR || now - row.seen_at > config.idleHours * HOUR) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    if (now - row.seen_at > 60_000) this.db.prepare('UPDATE sessions SET seen_at = ? WHERE token_hash = ?').run(now, row.token_hash);
    return { tokenHash: row.token_hash, userId: row.user_id, username: row.username, csrf: row.csrf, mustChange: !!row.is_default };
  }

  logout(session: Session, res: Response): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.tokenHash);
    res.clearCookie(COOKIE, { httpOnly: true, secure: config.production, sameSite: 'strict', path: '/' });
  }

  async changePassword(session: Session, body: unknown, req: Request, res: Response): Promise<Session> {
    const { current, next, confirm } = (body ?? {}) as Record<string, unknown>;
    const keys: [string, number][] = [[`cambio:${session.userId}:${req.ip}`, MAX_PER_ACCOUNT]];
    this.checkLimit(res, keys);
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) as User;
    if (typeof current !== 'string' || !(await verifyPassword(current.slice(0, 200), user.password_hash))) {
      this.noteFailure(keys);
      throw new HttpError(422, 'La contraseña actual no es correcta.', { current: 'No es correcta.' });
    }
    const problem = passwordProblem(next, user.username);
    if (problem) throw new HttpError(422, problem, { next: problem });
    if (next !== confirm) throw new HttpError(422, 'Las contraseñas nuevas no coinciden.', { confirm: 'No coincide.' });
    if (next === current) throw new HttpError(422, 'La contraseña nueva debe ser distinta.', { next: 'Debe ser distinta de la actual.' });
    await this.setPassword(user.username, next as string); // cierra todas las sesiones
    return this.open(res, { ...user, is_default: 0 });
  }

  csrfOk(session: Session, header: unknown): boolean {
    if (typeof header !== 'string') return false;
    const a = Buffer.from(header);
    const b = Buffer.from(session.csrf);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
