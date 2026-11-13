import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecretMasker } from './storage/SecretMasker.js';
import { FileConfigRepository } from './storage/ConfigRepository.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const MAX_BODY = 5 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Servidor HTTP mínimo: API JSON + archivos estáticos (public/ y shared/). */
export class WebApp {
  constructor({ service, repository }) {
    this.service = service;
    this.repository = repository;
    this.routes = [];
    this.#defineRoutes();
  }

  #route(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    this.routes.push({ method, re, keys, handler });
  }

  #defineRoutes() {
    const { service, repository } = this;

    this.#route('GET', '/api/meta', async () => service.meta());

    this.#route('GET', '/api/configs', async () => repository.list());
    this.#route('GET', '/api/configs/:id', async ({ params }) => {
      const c = await repository.get(params.id);
      if (!c) throw new HttpError(404, 'Configuración no encontrada');
      return SecretMasker.mask(c);
    });
    this.#route('POST', '/api/configs', async ({ body }) => {
      if (!body || typeof body !== 'object') throw new HttpError(400, 'Cuerpo inválido');
      if (body.id && !FileConfigRepository.isValidId(body.id)) throw new HttpError(400, 'Identificador inválido');
      const resolved = await service.resolve(body);
      return SecretMasker.mask(await repository.save(resolved));
    });
    this.#route('DELETE', '/api/configs/:id', async ({ params }) => {
      if (!(await repository.delete(params.id))) throw new HttpError(404, 'Configuración no encontrada');
      return { ok: true };
    });

    this.#route('POST', '/api/source/preview', async ({ body, signal }) => service.preview({ id: body?.id, source: body?.source }, { limit: body?.limit, signal }));
    this.#route('POST', '/api/target/describe', async ({ body }) => service.describeTarget(body?.target));

    // Ejecución en streaming (NDJSON): un evento por línea.
    this.#route('POST', '/api/run', async ({ body, res, signal }) => {
      const job = await service.buildJob(body?.config, { dryRun: body?.dryRun, limit: body?.limit });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      for await (const ev of job.run(signal)) {
        if (signal.aborted) break;
        res.write(`${JSON.stringify(ev)}\n`);
      }
      res.end();
      return undefined;
    });
  }

  async #readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Cuerpo demasiado grande');
      chunks.push(chunk);
    }
    if (!size) return undefined;
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'JSON inválido'); }
  }

  async #serveStatic(urlPath, res) {
    let rel = decodeURIComponent(urlPath);
    if (rel === '/') rel = '/index.html';
    const base = rel.startsWith('/shared/') ? ROOT : path.join(ROOT, 'public');
    const file = path.resolve(base, `.${rel}`);
    const allowedRoot = rel.startsWith('/shared/') ? path.join(ROOT, 'shared') : path.join(ROOT, 'public');
    if (!file.startsWith(allowedRoot + path.sep)) throw new HttpError(404, 'No encontrado');
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch { throw new HttpError(404, 'No encontrado'); }
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const r of this.routes) {
          if (r.method !== req.method) continue;
          const m = r.re.exec(url.pathname);
          if (!m) continue;
          const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await this.#readBody(req) : undefined;
          const out = await r.handler({ params, body, res, signal: ac.signal });
          if (!res.headersSent) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(out ?? null));
          }
          return;
        }
        throw new HttpError(404, 'Ruta no encontrada');
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido');
      await this.#serveStatic(url.pathname, res);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      const message = status === 500 && err.name !== 'ConnectorError' ? 'Error interno' : err.message;
      if (res.headersSent) { res.end(`${JSON.stringify({ type: 'error', error: message })}\n`); return; }
      res.writeHead(err.name === 'ConnectorError' ? 502 : status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: message }));
    }
  }

  createServer() {
    return http.createServer((req, res) => this.handle(req, res));
  }
}
