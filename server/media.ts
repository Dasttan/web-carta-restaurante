/**
 * Subida de fotos y vídeos. Nada de lo que se sube se sirve tal cual: las fotos se
 * vuelven a generar y los vídeos se vuelven a codificar, igual que los de la carta.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { config } from './config.ts';
import type { Repo } from './repo.ts';
import { HttpError } from './validate.ts';

type Kind = 'image' | 'video';
interface Format {
  kind: Kind;
  extensions: string[];
  mime: string[];
  /** Formato con el que ffmpeg debe leerlo: nunca lo adivina. */
  demuxer?: string;
}

const FORMATS: Record<string, Format> = {
  jpeg: { kind: 'image', extensions: ['jpg', 'jpeg'], mime: ['image/jpeg'] },
  png: { kind: 'image', extensions: ['png'], mime: ['image/png'] },
  webp: { kind: 'image', extensions: ['webp'], mime: ['image/webp'] },
  mp4: { kind: 'video', extensions: ['mp4', 'm4v', 'mov'], mime: ['video/mp4', 'video/quicktime', 'video/x-m4v'], demuxer: 'mov' },
  webm: { kind: 'video', extensions: ['webm'], mime: ['video/webm'], demuxer: 'matroska' },
};
const MAX_VIDEO_SECONDS = 60;
const VIDEO_SIZES = [
  { key: 'high', w: 720, h: 1280, crf: 27, rate: 1800 },
  { key: 'low', w: 486, h: 864, crf: 28, rate: 800 },
] as const;

/** Formato real según los primeros bytes, no según el nombre. */
function sniff(head: Buffer): string | null {
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  const box = head.toString('latin1', 4, 8);
  if (box === 'ftyp') return /^(avif|avis|heic|heix|mif1|msf1)/.test(head.toString('latin1', 8, 12)) ? null : 'mp4';
  if (['moov', 'mdat', 'wide', 'free'].includes(box)) return 'mp4';
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  return null;
}

const ALLOWED = 'Formatos admitidos: JPG, PNG o WebP para fotos; MP4, MOV o WebM para vídeos.';

/** Recibe el archivo, lo comprueba y lanza su conversión en segundo plano. */
export async function receive(req: Request, repo: Repo): Promise<string> {
  const name = safeName(String(req.query.name ?? ''));
  const extension = name.split('.').pop()!.toLowerCase();
  const declared = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const guess = Object.values(FORMATS).find((f) => f.extensions.includes(extension));
  if (!guess || !guess.mime.includes(declared)) throw new HttpError(415, `Ese tipo de archivo no se puede usar. ${ALLOWED}`);

  const limit = guess.kind === 'image' ? config.maxImageBytes : config.maxVideoBytes;
  const tooBig = new HttpError(413, `El archivo es demasiado grande. El máximo es ${Math.round(limit / 1048576)} MB.`);
  if (Number(req.headers['content-length'] ?? 0) > limit) throw tooBig;

  const id = randomUUID();
  await mkdir(config.tmpDir, { recursive: true });
  const tmp = join(config.tmpDir, `${id}.subida`);
  let size = 0;
  const counter = new Transform({
    transform(chunk, _enc, done) {
      size += chunk.length;
      done(size > limit ? tooBig : null, chunk);
    },
  });
  try {
    await pipeline(req, counter, createWriteStream(tmp, { flags: 'wx' }));
    if (size === 0) throw new HttpError(422, 'El archivo está vacío.');
    const head = Buffer.alloc(16);
    const file = await open(tmp);
    await file.read(head, 0, 16, 0);
    await file.close();
    const real = sniff(head);
    const format = real ? FORMATS[real] : null;
    if (!format || format !== guess) throw new HttpError(415, `El contenido del archivo no corresponde a su nombre. ${ALLOWED}`);

    repo.addMedia(id, format.kind, name);
    if (format.kind === 'image') await finish(id, 'image', tmp, format, repo); // es inmediato: se espera
    else void finish(id, 'video', tmp, format, repo);
    return id;
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

async function finish(id: string, kind: Kind, tmp: string, format: Format, repo: Repo): Promise<void> {
  const out = join(config.mediaDir, id);
  try {
    await mkdir(out, { recursive: true });
    const files = kind === 'image' ? await convertImage(tmp, out, id) : await queue(() => convertVideo(tmp, out, id, format.demuxer!));
    repo.finishMedia(id, files);
  } catch (error) {
    await rm(out, { recursive: true, force: true });
    const message = error instanceof HttpError ? error.message : 'El archivo está dañado o no se puede leer.';
    if (!(error instanceof HttpError)) console.error('Conversión fallida:', (error as Error).message.slice(0, 400));
    repo.failMedia(id, message);
    if (kind === 'image') throw new HttpError(422, message);
  } finally {
    await rm(tmp, { force: true });
  }
}

const reader = (src: string) => sharp(src, { limitInputPixels: 60_000_000, failOn: 'error' });

async function imagePair(src: string, out: string, id: string, base: string, large: number) {
  const make = (width: number) =>
    reader(src).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78, effort: 5 }).toFile(join(out, `${base}-${width}.webp`));
  await make(480);
  const { width, height } = await make(large);
  return { small: `/media/${id}/${base}-480.webp`, large: `/media/${id}/${base}-${large}.webp`, width, height };
}

const convertImage = (src: string, out: string, id: string) => imagePair(src, out, id, 'foto', 960);

async function convertVideo(src: string, out: string, id: string, demuxer: string) {
  const input = ['-protocol_whitelist', 'file', '-f', demuxer, '-i', src];
  const info = await ffmpeg([...input, '-map', '0:v:0', '-t', '0.1', '-f', 'null', '-'], 60_000, 'info');
  const m = info.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const seconds = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  if (seconds > MAX_VIDEO_SECONDS + 0.5)
    throw new HttpError(422, `El vídeo dura demasiado. El máximo es ${MAX_VIDEO_SECONDS} segundos.`);

  const files: Record<string, unknown> = {};
  for (const { key, w, h, crf, rate } of VIDEO_SIZES) {
    await ffmpeg(
      [...input, '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-t', String(MAX_VIDEO_SECONDS),
        // Se ajusta al marco sin deformar ni recortar.
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30`,
        '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', String(crf), '-maxrate', `${rate}k`,
        '-bufsize', `${rate * 2}k`, '-pix_fmt', 'yuv420p', '-g', '60', '-movflags', '+faststart', join(out, `video-${w}.mp4`)],
      300_000,
    );
    files[key] = `/media/${id}/video-${w}.mp4`;
  }
  const frame = join(out, 'fotograma.png');
  await ffmpeg(['-ss', String(Math.max(0, seconds * 0.5).toFixed(2)), '-i', join(out, 'video-720.mp4'), '-frames:v', '1', frame], 60_000);
  files.poster = await imagePair(frame, out, id, 'portada', 720);
  await rm(frame, { force: true });
  return files;
}

function ffmpeg(args: string[], timeout: number, level = 'error'): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath as unknown as string, ['-hide_banner', '-nostdin', '-loglevel', level, '-y', ...args], { windowsHide: true });
    let log = '';
    p.stderr.on('data', (d) => (log = (log + d).slice(-20_000)));
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('error', reject);
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(log);
      else reject(new Error(log || `ffmpeg terminó con ${code}`));
    });
  });
}

/** Un vídeo cada vez: convertir varios a la vez dejaría la carta sin recursos. */
let last: Promise<unknown> = Promise.resolve();
function queue<T>(job: () => Promise<T>): Promise<T> {
  const run = last.then(job, job);
  last = run.catch(() => {});
  return run;
}

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop()!.normalize('NFC').replace(/[^\p{L}\p{N}._ ()-]/gu, '').replace(/^\.+/, '').trim().slice(-100);
  if (!base.includes('.')) throw new HttpError(415, `Ese tipo de archivo no se puede usar. ${ALLOWED}`);
  return base;
}

/** Borra los ficheros de un recurso que ya no usa nadie. */
export async function deleteFiles(files: string): Promise<void> {
  const paths: string[] = [];
  const walk = (o: object) => {
    for (const v of Object.values(o)) {
      if (typeof v === 'string') paths.push(v);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(JSON.parse(files));
  for (const path of paths) {
    const m = path.match(/^\/media\/([a-z0-9-]+)\/([a-z0-9-]+\.(?:webp|mp4))$/i);
    if (m) await rm(join(config.mediaDir, m[1], m[2]), { force: true });
  }
}

export async function cleanTmp(): Promise<void> {
  await rm(config.tmpDir, { recursive: true, force: true });
  await mkdir(config.tmpDir, { recursive: true });
  await stat(config.mediaDir);
}
