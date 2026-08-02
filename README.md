# API do baixador de playlists

## Requisitos

- Node.js 20 ou superior
- [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) disponível no `PATH` (ou definido em `YTDLP_PATH`)
- FFmpeg no `PATH` para a melhor qualidade de vídeo/áudio (ou definido em `FFMPEG_LOCATION`)

## Executar

```bash
copy .env.example .env
npm install
npm run dev
```

A API inicia em `http://localhost:2000`, que já corresponde a `front/src/constants/api.ts`.

## Rotas

- `POST /playlists/` recebe `{ "url": "..." }` e devolve metadados da playlist.
- `POST /downloads/stream` recebe as URLs selecionadas e responde com o ZIP como download do navegador.

Os vídeos e o ZIP nunca são gravados no backend: o `yt-dlp` transmite cada vídeo para o ZIP, que é transmitido diretamente ao navegador.
