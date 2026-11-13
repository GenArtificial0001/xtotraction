import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectPath } from '../shared/ObjectPath.js';
import { SchemaInferer } from '../shared/SchemaInferer.js';
import { HarParser } from '../shared/HarParser.js';

test('ObjectPath: get/set anidado, índices y claves con punto', () => {
  const o = {};
  ObjectPath.set(o, 'a.b.0.c', 1);
  assert.deepEqual(o, { a: { b: [{ c: 1 }] } });
  assert.equal(ObjectPath.get(o, 'a.b.0.c'), 1);
  assert.equal(ObjectPath.get({ 'odata.etag': 'x' }, 'odata\\.etag'), 'x');
  assert.equal(ObjectPath.get(o, 'a.z.y'), undefined);
});

test('ObjectPath: bloquea prototype pollution', () => {
  assert.throws(() => ObjectPath.set({}, '__proto__.polluted', 1));
  assert.throws(() => ObjectPath.set({}, 'a.constructor.prototype.x', 1));
  assert.equal({}.polluted, undefined);
});

test('SchemaInferer: aplana, detecta tipos y la lista de registros', () => {
  const inf = new SchemaInferer();
  const fields = inf.flatten({ Title: 'x', n: 2, ok: true, d: '2025-01-01T00:00:00Z', owner: { name: 'a' }, tags: ['a', 'b'], 'k.y': 1 });
  const byPath = Object.fromEntries(fields.map((f) => [f.path, f.type]));
  assert.deepEqual(byPath, { Title: 'string', n: 'number', ok: 'boolean', d: 'date', 'owner.name': 'string', tags: 'array', 'k\\.y': 'number' });
  assert.equal(inf.findItemsPath([{ a: 1 }]), '');
  assert.equal(inf.findItemsPath({ value: [{ a: 1 }] }), 'value');
  assert.equal(inf.findItemsPath({ d: { results: [{ a: 1 }, { a: 2 }] } }), 'd.results');
  assert.equal(inf.findItemsPath({ x: 1 }), null);
  assert.deepEqual(inf.extractItems({ a: { b: [{ i: 1 }] } }, 'a.b').items, [{ i: 1 }]);
  assert.deepEqual(inf.extractItems([{ i: 1 }], '$').items, [{ i: 1 }]);
});

test('HarParser: entradas, cabeceras saneadas, borradores de origen y destino', () => {
  const body = { value: [{ Title: 'vision-ai', Id: 1 }] };
  const har = {
    log: { entries: [
      { request: { method: 'GET', url: 'https://x/_api/items', headers: [{ name: 'Authorization', value: 'Bearer t' }, { name: 'Host', value: 'x' }, { name: ':method', value: 'GET' }, { name: 'sec-fetch-site', value: 'a' }] },
        response: { status: 200, content: { mimeType: 'application/json; charset=utf-8', text: Buffer.from(JSON.stringify(body)).toString('base64'), encoding: 'base64' } } },
      { request: { method: 'POST', url: 'https://t/api/projects', headers: [], postData: { mimeType: 'application/json', text: '{"name":"n","owner":{"id":3}}' } },
        response: { status: 201, content: { mimeType: 'application/json', text: '{}' } } },
    ] },
  };
  const doc = HarParser.parse(JSON.stringify(har));
  assert.equal(doc.entries.length, 2);
  assert.equal(doc.filter({ onlyWithRequestBody: true }).length, 1);
  assert.equal(doc.filter({ text: '_api' }).length, 1);

  const src = doc.get(0).toSourceDraft();
  assert.deepEqual(src.config.headers, { Authorization: 'Bearer t' });
  assert.equal(src.config.itemsPath, 'value');
  assert.deepEqual(src.fields.map((f) => f.path), ['Title', 'Id']);

  const tgt = doc.get(1).toTargetDraft();
  assert.equal(tgt.config.method, 'POST');
  assert.deepEqual(tgt.fields.map((f) => f.path), ['name', 'owner.id']);

  assert.throws(() => HarParser.parse('{"nope":1}'), /HAR/);
  assert.throws(() => HarParser.parse('no json'), /JSON/);
});

test('CurlParser: comillas, $\'…\', cabeceras, datos y método implícito', async () => {
  const { CurlParser } = await import('../shared/CurlParser.js');
  const cmd = `curl 'https://t.example.com/api/projects?x=1' \\
  -H 'authorization: Bearer abc' \\
  -H 'content-type: application/json' \\
  -b 'sid=9' --compressed \\
  --data-raw $'{"name":"it\\'s","owner":{"id":3}}'`;
  const p = CurlParser.parse(cmd);
  assert.equal(p.method, 'POST');
  assert.equal(p.url, 'https://t.example.com/api/projects?x=1');
  assert.equal(p.headers.authorization, 'Bearer abc');
  assert.equal(p.headers.Cookie, 'sid=9');
  assert.deepEqual(JSON.parse(p.body), { name: "it's", owner: { id: 3 } });

  const tgt = CurlParser.toHarEntry(cmd).toTargetDraft();
  assert.deepEqual(tgt.fields.map((f) => f.path), ['name', 'owner.id']);
  assert.equal(tgt.config.method, 'POST');

  const src = CurlParser.toHarEntry('curl "https://s.example.com/_api/items" -H "Accept: application/json" -X GET').toSourceDraft();
  assert.equal(src.config.method, 'GET');
  assert.equal(src.fields.length, 0);
  assert.equal(src.warnings.length, 1);

  assert.throws(() => CurlParser.parse('curl -H "a: b"'), /URL/);
  assert.throws(() => CurlParser.parse("curl 'https://x -d"), /sin cerrar/);
  assert.throws(() => CurlParser.parse('curl https://x -F a=@f'), /multipart/);
  assert.equal(CurlParser.looksLikeCurl('  curl https://x'), true);
  assert.equal(CurlParser.looksLikeCurl('{"a":1}'), false);
});

test('entryFromJsonSample: JSON pegado como respuesta (origen) o cuerpo (destino)', async () => {
  const { entryFromJsonSample } = await import('../shared/HarParser.js');
  const src = entryFromJsonSample('{"value":[{"Title":"a","Id":1}]}', 'source').toSourceDraft();
  assert.deepEqual(src.fields.map((f) => f.path), ['Title', 'Id']);
  assert.equal(src.config.itemsPath, 'value');
  const tgt = entryFromJsonSample('{"name":"x","tags":[]}', 'target').toTargetDraft();
  assert.deepEqual(tgt.fields.map((f) => f.path), ['name', 'tags']);
  assert.throws(() => entryFromJsonSample('no json', 'source'));
});
