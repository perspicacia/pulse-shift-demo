import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { BUILTIN_TRACKS } from './src/tracks.js';
import { createMultiplayerHandler } from './src/multiplayer-server.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const multiplayer = createMultiplayerHandler(BUILTIN_TRACKS, { publicOrigin: process.env.PUBLIC_ORIGIN || '' });
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.wav': 'audio/wav' };

createServer(async (req, res) => {
  if (await multiplayer(req, res)) return;
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const relative = path.slice(root.length + 1);
    if ((path !== root && !path.startsWith(root + sep)) || relative.split(sep).some(part => part.startsWith('.')) || relative === 'server.mjs') {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const file = path === resolve(root) ? resolve(root, 'index.html') : path;
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, host, () => console.log(`PULSE SHIFT → http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`));
