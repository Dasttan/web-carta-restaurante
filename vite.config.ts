import { defineConfig } from 'vite';

export default defineConfig(({ isSsrBuild }) => ({
  build: isSsrBuild
    ? { target: 'node22', outDir: 'dist/server', copyPublicDir: false }
    : {
        target: 'es2020',
        assetsInlineLimit: 0,
        outDir: 'dist/client',
        rolldownOptions: { input: { index: 'index.html', superuser: 'superuser.html' } },
      },
  ssr: { noExternal: true },
}));
