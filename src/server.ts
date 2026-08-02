import 'dotenv/config';

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import archiver from 'archiver';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

const port = Number(process.env.PORT ?? 2000);
const ytDlp = process.env.YTDLP_PATH || 'yt-dlp';

const urlSchema = z.string().trim().url().refine(isYouTubeUrl, 'Insira uma URL válida do YouTube.');
const playlistSchema = z.object({ url: urlSchema });
const streamSchema = z.object({
  urls: z.array(urlSchema).min(1, 'Selecione pelo menos um vídeo.').max(100, 'O limite é 100 vídeos por download.'),
});

function isYouTubeUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  } catch {
    return false;
  }
}

function runYtDlp(argumentsList: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp, argumentsList, { windowsHide: true });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { errors += String(chunk); });
    child.on('error', (error: NodeJS.ErrnoException) => reject(new Error(error.code === 'ENOENT'
      ? 'yt-dlp não foi encontrado. Instale-o ou configure YTDLP_PATH.'
      : error.message)));
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(errors || `yt-dlp terminou com código ${code}.`)));
  });
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().slice(0, 150) || 'video';
}

async function getPlaylist(url: string) {
  const raw = await runYtDlp(['--flat-playlist', '--dump-single-json', '--no-warnings', url]);
  const result = JSON.parse(raw) as { title?: string; entries?: Array<{ id?: string; title?: string; duration?: number; thumbnail?: string; url?: string }> };
  const videos = (result.entries ?? []).filter((entry) => entry.id).map((entry) => ({
    id: entry.id!,
    title: entry.title ?? 'Vídeo sem título',
    duration: Math.round(entry.duration ?? 0),
    thumbnail: entry.thumbnail ?? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
    url: entry.url?.startsWith('http') ? entry.url : `https://www.youtube.com/watch?v=${entry.id}`,
    selected: true,
  }));
  return { title: result.title ?? 'Playlist', count_videos: videos.length, videos };
}

async function getVideoInfo(url: string): Promise<{ title: string; ext: string }> {
  const raw = await runYtDlp(['--no-playlist', '--dump-single-json', '--skip-download', '--no-warnings', url]);
  const result = JSON.parse(raw) as { title?: string; ext?: string };
  return { title: safeFileName(result.title ?? 'video'), ext: result.ext ?? 'mp4' };
}

function appendVideo(archive: archiver.Archiver, url: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp, ['--no-playlist', '--no-warnings', '--format', 'best[ext=mp4]/best', '--output', '-', url], { windowsHide: true });
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += String(chunk); });
    child.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'ENOENT' ? new Error('yt-dlp não foi encontrado. Instale-o ou configure YTDLP_PATH.') : error));
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(errors || `Falha ao baixar ${name}.`)));
    archive.append(child.stdout, { name });
  });
}

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5000' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.post('/playlists/', async (request, response, next) => {
  try {
    const { url } = playlistSchema.parse(request.body);
    response.json(await getPlaylist(url));
  } catch (error) { next(error); }
});

app.post('/downloads/stream', async (request, response, next) => {
  try {
    const submittedUrls = typeof request.body.urls === 'string' ? JSON.parse(request.body.urls) : request.body.urls;
    const { urls } = streamSchema.parse({ urls: submittedUrls });
    response.status(200);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', 'attachment; filename="videos.zip"');
    response.setHeader('Cache-Control', 'no-store');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (error) => response.destroy(error));
    archive.pipe(response);
    for (const [index, url] of urls.entries()) {
      const info = await getVideoInfo(url);
      await appendVideo(archive, url, `${String(index + 1).padStart(2, '0')}-${info.title}.${info.ext}`);
    }
    await archive.finalize();
  } catch (error) { next(error); }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return response.status(422).json({ detail: error.issues.map((issue) => ({ msg: issue.message })) });
  const message = error instanceof Error ? error.message : 'Erro interno do servidor.';
  console.error(error);
  return response.status(500).json({ detail: [{ msg: message }] });
});

createServer(app).listen(port, () => console.log(`API disponível em http://localhost:${port}`));
