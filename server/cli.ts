/**
 * Tareas de mantenimiento, solo desde el servidor:
 *   npm run clave                       cambia la contraseña (la pide sin mostrarla)
 *   npm run copia                       copia completa: base de datos y multimedia
 *   npm run restaurar -- <carpeta>      vuelve a una copia (con el servidor parado)
 */
import Database from 'better-sqlite3';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { Auth } from './auth.ts';
import { config } from './config.ts';
import { backupDb, openDb, stamp } from './db.ts';
import { passwordProblem } from './validate.ts';

const [command, argument] = process.argv.slice(2);

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const lines = rl[Symbol.asyncIterator]();

async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  const out = rl as unknown as { _writeToOutput: (s: string) => void };
  const write = out._writeToOutput;
  if (hidden) out._writeToOutput = () => {};
  const { value } = await lines.next();
  out._writeToOutput = write;
  if (hidden) process.stdout.write('\n');
  return String(value ?? '');
}

async function changePassword() {
  const db = openDb();
  const auth = new Auth(db);
  const user = db.prepare('SELECT username FROM users LIMIT 1').get() as { username: string } | undefined;
  const username = user?.username ?? config.adminUser;
  const password = await ask(`Nueva contraseña para «${username}» (no se muestra): `, true);
  const problem = passwordProblem(password, username);
  if (problem) throw new Error(problem);
  if ((await ask('Repítela: ', true)) !== password) throw new Error('No coinciden.');
  await auth.setPassword(username, password);
  console.log('Contraseña actualizada. Se han cerrado todas las sesiones.');
}

function backup(): string {
  const dir = join(config.backupDir, `completa-${stamp()}`);
  mkdirSync(dir, { recursive: true });
  const db = openDb();
  backupDb(db, join(dir, 'carta.db'));
  db.close();
  cpSync(config.mediaDir, join(dir, 'media'), { recursive: true });
  return dir;
}

async function restore() {
  if (!argument) {
    const list = existsSync(config.backupDir) ? readdirSync(config.backupDir).filter((f) => f.startsWith('completa-')) : [];
    throw new Error(`Indica la copia: npm run restaurar -- <carpeta>\nDisponibles en ${config.backupDir}:\n  ${list.join('\n  ') || '(ninguna)'}`);
  }
  const dir = existsSync(argument) ? resolve(argument) : join(config.backupDir, argument);
  if (!existsSync(join(dir, 'carta.db'))) throw new Error('Esa carpeta no contiene una copia (falta carta.db).');
  const check = new Database(join(dir, 'carta.db'), { readonly: true });
  const healthy = check.pragma('integrity_check', { simple: true }) === 'ok';
  const { n } = check.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
  check.close();
  if (!healthy) throw new Error('La base de datos de esa copia está dañada.');
  console.log(`La copia tiene ${n} productos. Para el servidor antes de seguir.`);
  if ((await ask('Escribe RESTAURAR para sustituir los datos actuales: ')).trim() !== 'RESTAURAR') throw new Error('Cancelado: no se ha cambiado nada.');
  const safety = existsSync(config.dbFile) ? backup() : null;
  for (const f of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) rmSync(f, { force: true });
  cpSync(join(dir, 'carta.db'), config.dbFile);
  if (existsSync(join(dir, 'media'))) cpSync(join(dir, 'media'), config.mediaDir, { recursive: true });
  console.log(`Copia restaurada.${safety ? ` Lo que había antes queda en ${safety}` : ''}`);
}

try {
  if (command === 'clave') await changePassword();
  else if (command === 'copia') console.log(`Copia guardada en ${backup()}`);
  else if (command === 'restaurar') await restore();
  else throw new Error('Órdenes: clave, copia, restaurar.');
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  rl.close();
}
