import http from 'node:http';
import path from 'node:path';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build, root } from './build.mjs';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535.');
let slugs = await build();
const dist = await realpath(path.join(root, 'dist'));
const streams = new Set();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const reload = `<script>const events=new EventSource('/__events');events.onmessage=()=>location.reload();</script>`;
const inside = filename => { const relative = path.relative(dist, filename); return !relative.startsWith('..') && !path.isAbsolute(relative); };

const server = http.createServer(async (request, response) => {
  const host = request.headers.host;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { response.writeHead(403).end(); return; }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/__events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      response.write(': connected\n\n');
      streams.add(response);
      request.on('close', () => streams.delete(response));
      return;
    }
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Client previews</title><h1>Client previews</h1><ul>${slugs.map(slug => `<li><a href="/${slug}/">${slug}</a></li>`).join('')}</ul>${reload}</html>`);
      return;
    }
    let filename = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (!inside(filename)) { response.writeHead(403).end(); return; }
    if ((await stat(filename)).isDirectory()) {
      if (!url.pathname.endsWith('/')) { response.writeHead(302, { Location: `${url.pathname}/${url.search}` }).end(); return; }
      filename = path.join(filename, 'index.html');
    }
    filename = await realpath(filename);
    if (!inside(filename)) { response.writeHead(403).end(); return; }
    const extension = path.extname(filename);
    let contents = await readFile(filename);
    if (extension === '.html' && !url.searchParams.has('no-reload')) contents = Buffer.from(contents.toString().replace('</body>', `${reload}</body>`));
    response.writeHead(200, { 'Content-Type': mime[extension] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch { response.writeHead(404).end('Not found'); }
});

async function fingerprint() {
  const hash = createHash('sha256');
  async function scan(directory) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      hash.update(filename);
      if (entry.isDirectory()) await scan(filename);
      else if (entry.isFile()) hash.update(await readFile(filename));
    }
  }
  for (const directory of ['clients', 'src', 'assets']) await scan(path.join(root, directory));
  return hash.digest('hex');
}

let previous = await fingerprint();
let busy = false;
const timer = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const current = await fingerprint();
    if (current !== previous) {
      previous = current;
      slugs = await build();
      for (const stream of streams) stream.write('data: reload\n\n');
    }
  } catch (error) { console.error(`Rebuild failed; keeping previous output: ${error.message}`); }
  finally { busy = false; }
}, 800);

server.on('error', error => { clearInterval(timer); console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}/ — edit JSON, CSS, JS, or images to reload. Restart after editing scripts/ or schema/.`));
process.on('SIGINT', () => { clearInterval(timer); for (const stream of streams) stream.end(); server.close(); });
