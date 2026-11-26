import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { Auth } from './auth.ts';
import { config, ROOT } from './config.ts';
import { openDb } from './db.ts';
import { cleanTmp } from './media.ts';
import { Repo } from './repo.ts';

async function main() {
  if (config.production && !/^https:\/\//.test(config.publicOrigin))
    throw new Error('En producción hace falta PUBLIC_ORIGIN, por ejemplo https://carta.midominio.com');
  if (!config.dev && !existsSync(join(config.distDir, 'client/index.html')))
    throw new Error('Falta compilar la web: ejecuta npm run build.');

  const db = openDb();
  const auth = new Auth(db);
  await auth.init();
  const repo = new Repo(db);
  repo.discardUnfinishedMedia();
  await cleanTmp();

  const server = createServer();
  const vite = config.dev
    ? await (await import('vite')).createServer({
        root: ROOT,
        appType: 'custom',
        server: { middlewareMode: true, hmr: { server } },
      })
    : undefined;
  server.on('request', await createApp({ db, repo, auth, vite }));
  server.requestTimeout = 20 * 60_000; // vídeos grandes con conexiones lentas

  server.listen(config.port, config.host, () => {
    console.log(`\n  Carta:  http://localhost:${config.port}/`);
    console.log(`  Panel:  http://localhost:${config.port}/superuser\n`);
  });

  const close = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

main().catch((error) => {
  console.error(`\n  No se ha podido arrancar. ${error.message}\n`);
  process.exit(1);
});
