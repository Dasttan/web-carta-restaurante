/** Arranque de producción: igual en Windows, Linux y Mac. */
process.env.NODE_ENV = 'production';
await import('./index.ts');

export {};
