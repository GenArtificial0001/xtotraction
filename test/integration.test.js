import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMockSharePoint, createMockTraction, DEMO_TOKEN } from '../examples/mock-servers.js';
import { createDefaultRegistry } from '../server/connectors/index.js';
import { FileConfigRepository } from '../server/storage/ConfigRepository.js';
import { SyncService } from '../server/core/SyncService.js';
import { WebApp } from '../server/app.js';
import { HarParser } from '../shared/HarParser.js';
import { readFileSync } from 'node:fs';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
let sp; let tr; let app; let dir; let base; let spPort; let trPort;

before(async () => {
  // Los mocks usan puertos propios en las URLs de nextLink, así que escuchamos en puertos libres y se los pasamos.
  sp = createMockSharePoint({ port: 0 });
  tr = createMockTraction({ port: 0 });
  spPort = await listen(sp);
  trPort = await listen(tr);
  dir = await mkdtemp(path.join(os.tmpdir(), 'ts-'));
  const repository = new FileConfigRepository(dir);
  const service = new SyncService({ registry: createDefaultRegistry(), repository });
  app = new WebApp({ service, repository }).createServer();
  base = `http://127.0.0.1:${await listen(app)}`;
});
after(async () => {
  for (const s of [sp, tr, app]) s.close();
  await rm(dir, { recursive: true, force: true });
});

const api = async (method, p, body) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, text: await res.text() };
};

const buildConfig = () => ({
  name: 'Proyectos → Traction',
  source: {
    type: 'sharepoint-list',
    url: `http://127.0.0.1:${spPort}/_api/web/lists/getbytitle('Proyectos')/items`,
    headers: { Authorization: `Bearer ${DEMO_TOKEN}` },
  },
  target: {
    type: 'http', url: `http://127.0.0.1:${trPort}/api/projects`, method: 'POST',
    headers: { Authorization: `Bearer ${DEMO_TOKEN}` }, bodyFormat: 'json',
    bodyTemplate: JSON.stringify({ name: '', description: '', status: 'x', budget: 0, owner: { name: '', email: '' }, tags: ['importado'] }),
  },
  mappings: [
    { source: 'Title', target: 'name' },
    { source: 'Descripcion', target: 'description', transform: 'stripHtml' },
    { source: 'Presupuesto', target: 'budget', transform: 'number' },
    { source: 'Responsable.Title', target: 'owner.name' },
    { source: 'Responsable.EMail', target: 'owner.email' },
    { source: null, target: 'status', constant: 'active' },
  ],
});

const run = async (config, opts) => {
  const { status, text } = await api('POST', '/api/run', { config, ...opts });
  return { status, events: text.trim().split('\n').map((l) => JSON.parse(l)) };
};

test('preview del origen: pagina, trae campos y oculta metadatos OData', async () => {
  const cfg = buildConfig();
  const { status, text } = await api('POST', '/api/source/preview', { source: cfg.source, limit: 10 });
  assert.equal(status, 200);
  const { fields, records } = JSON.parse(text);
  assert.equal(records.length, 5); // 3 páginas de 2/2/1
  const paths = fields.map((f) => f.path);
  assert.ok(paths.includes('Title') && paths.includes('Responsable.EMail'));
  assert.ok(!paths.some((p) => p.includes('odata')));
});

test('simulacro (dryRun) no envía nada pero devuelve las peticiones', async () => {
  const { events } = await run(buildConfig(), { dryRun: true });
  const recs = events.filter((e) => e.type === 'record');
  assert.equal(recs.length, 5);
  assert.equal(tr.created.length, 0);
  assert.deepEqual(recs[0].request.body, {
    name: 'vision-ai', description: 'Visión por computador', status: 'active', budget: 12000.5,
    owner: { name: 'Ana Pérez', email: 'ana@contoso.com' }, tags: ['importado'],
  });
  assert.deepEqual(events.at(-1), { type: 'done', total: 5, ok: 5, failed: 0, aborted: false, dryRun: true });
});

test('envío real: origen → destino con límite', async () => {
  const { events } = await run(buildConfig(), { dryRun: false, limit: 3 });
  const done = events.at(-1);
  assert.equal(done.total, 3);
  assert.equal(done.ok, 3);
  assert.equal(tr.created.length, 3);
  assert.equal(tr.created[0].name, 'vision-ai');
  assert.equal(tr.created[0].owner.email, 'ana@contoso.com');
  tr.created.length = 0;
});

test('errores por registro se informan sin abortar y credenciales malas dan error claro', async () => {
  const cfg = buildConfig();
  cfg.mappings = cfg.mappings.filter((m) => m.target !== 'name'); // el destino exige name → 422
  const { events } = await run(cfg, { dryRun: false, limit: 2 });
  const done = events.at(-1);
  assert.equal(done.failed, 2);
  assert.match(events.find((e) => e.type === 'record').error, /422/);

  const bad = buildConfig();
  bad.source.headers.Authorization = 'Bearer caducado';
  const r = await run(bad, { dryRun: true });
  assert.match(r.events.find((e) => e.type === 'error').error, /401.*caducó/);
});

test('configuraciones: se guardan, las credenciales vuelven enmascaradas y se conservan', async () => {
  const saved = JSON.parse((await api('POST', '/api/configs', buildConfig())).text);
  assert.ok(saved.id);
  assert.notEqual(saved.source.headers.Authorization, `Bearer ${DEMO_TOKEN}`);
  const loaded = JSON.parse((await api('GET', `/api/configs/${saved.id}`)).text);
  assert.equal(loaded.source.headers.Authorization, saved.source.headers.Authorization);
  assert.doesNotMatch(JSON.stringify(loaded), new RegExp(DEMO_TOKEN));

  // Ejecutar con la config enmascarada funciona porque el servidor restaura el secreto guardado.
  const { events } = await run(loaded, { dryRun: true, limit: 1 });
  assert.equal(events.at(-1).ok, 1);

  assert.equal((await api('GET', '/api/configs')).status, 200);
  assert.equal((await api('DELETE', `/api/configs/${saved.id}`)).status, 200);
  assert.equal((await api('GET', `/api/configs/${saved.id}`)).status, 404);
  assert.equal((await api('GET', '/api/configs/..%2F..%2Fetc')).status, 400);
});

test('validaciones y seguridad básica', async () => {
  assert.equal((await api('POST', '/api/run', { config: { source: { type: 'nope' }, target: {} } })).status, 400);
  assert.equal((await api('POST', '/api/run', { config: { ...buildConfig(), mappings: [] } })).status, 400);
  assert.equal((await api('GET', '/shared/../server/index.js')).status, 404);
  assert.equal((await api('GET', '/%2e%2e/package.json')).status, 404);
  const meta = JSON.parse((await api('GET', '/api/meta')).text);
  assert.deepEqual(meta.sources.map((s) => s.type), ['http', 'sharepoint-list']);
  assert.deepEqual(meta.targets.map((s) => s.type), ['http']);
});

test('los HAR de ejemplo producen origen, destino y campos utilizables', () => {
  const src = HarParser.parse(readFileSync(new URL('../examples/sharepoint-demo.har', import.meta.url), 'utf8')).get(0).toSourceDraft();
  assert.ok(src.fields.some((f) => f.path === 'Title'));
  assert.equal(src.config.headers.Authorization, 'Bearer demo-token');
  assert.ok(!('Accept-Encoding' in src.config.headers) && !(':authority' in src.config.headers));
  const tgt = HarParser.parse(readFileSync(new URL('../examples/traction-demo.har', import.meta.url), 'utf8')).get(1).toTargetDraft();
  assert.ok(tgt.fields.some((f) => f.path === 'owner.email'));
  assert.ok(!('Content-Length' in tgt.config.headers));
});
