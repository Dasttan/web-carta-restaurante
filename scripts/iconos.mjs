/** Genera los iconos y la imagen para compartir a partir del logotipo. Uso: npm run iconos */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const logo = (size) => sharp(readFileSync('public/brand/logotipo.svg'), { density: 400 }).resize(size).png().toBuffer();
for (const size of [48, 180, 512]) {
  const inner = Math.round(size * 0.68);
  await sharp({ create: { width: size, height: size, channels: 3, background: '#1c1714' } })
    .composite([{ input: await logo(inner) }])
    .png()
    .toFile(`public/brand/icono-${size}.png`);
}

const photo = await sharp('originales/productos/doble-cheddar/foto.jpg').resize(520, 630).toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#1c1714' } })
  .composite([
    { input: photo, left: 680, top: 0 },
    { input: await logo(320), left: 180, top: 155 },
  ])
  .jpeg({ quality: 84 })
  .toFile('public/brand/compartir.jpg');
