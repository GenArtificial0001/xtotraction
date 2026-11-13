import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectPath } from '../shared/ObjectPath.js';
import { SchemaInferer } from '../shared/SchemaInferer.js';
import { HarParser } from '../shared/HarParser.js';
import { Mapper, MappingRule } from '../server/core/Mapper.js';
import { TransformRegistry } from '../server/core/transforms.js';
import { SecretMasker, MASK } from '../server/storage/SecretMasker.js';
import { HttpTarget } from '../server/connectors/HttpTarget.js';
import { SharePointListSource } from '../server/connectors/SharePointListSource.js';

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

test('Mapper: origen→destino con transformaciones, constantes y avisos', () => {
  const m = new Mapper([
    { source: 'Title', target: 'name', transform: 'upper' },
    { source: 'Responsable.EMail', target: 'owner.email' },
    { source: null, target: 'status', constant: 'active' },
    { source: 'NoExiste', target: 'x' },
  ]);
  const { values, warnings } = m.map({ Title: 'vision-ai', Responsable: { EMail: 'a@b.c' } });
  assert.deepEqual(values, { name: 'VISION-AI', 'owner.email': 'a@b.c', status: 'active' });
  assert.equal(warnings.length, 1);
  assert.throws(() => new MappingRule({ target: 't' }), /origen ni valor fijo/);
  assert.throws(() => new Mapper([{ source: 'a', target: 'b', transform: 'inexistente' }]), /desconocida/);
});

test('Transformaciones', () => {
  const t = TransformRegistry.withDefaults();
  assert.equal(t.get('number').apply('12000,50'), 12000.5);
  assert.equal(t.get('number').apply('abc'), null);
  assert.equal(t.get('stripHtml').apply('<p>Hola <b>mundo</b></p>'), 'Hola mundo');
  assert.equal(t.get('dateOnly').apply('2025-03-01T08:00:00Z'), '2025-03-01');
  assert.equal(t.get('boolean').apply('Sí'), true);
});

test('SecretMasker: enmascara y restaura credenciales', () => {
  const cfg = { source: { headers: { Authorization: 'Bearer abc', Accept: 'json' } }, target: { headers: { Cookie: 'sid=1' } } };
  const masked = SecretMasker.mask(cfg);
  assert.equal(masked.source.headers.Authorization, MASK);
  assert.equal(masked.source.headers.Accept, 'json');
  assert.equal(masked.target.headers.Cookie, MASK);
  assert.equal(cfg.source.headers.Authorization, 'Bearer abc'); // no muta
  const restored = SecretMasker.restore(masked, cfg);
  assert.deepEqual(restored, cfg);
  const changed = SecretMasker.restore({ ...masked, source: { headers: { Authorization: 'Bearer nuevo' } } }, cfg);
  assert.equal(changed.source.headers.Authorization, 'Bearer nuevo');
});

test('HttpTarget: plantilla + valores, URL con marcadores y formulario', () => {
  const t = new HttpTarget({ url: 'https://t/api/p/{{id}}', method: 'PUT', bodyTemplate: '{"id":0,"name":"","owner":{"email":""},"keep":"fijo"}' });
  const req = t.buildRequest({ id: 7, name: 'vision-ai', 'owner.email': 'a@b.c' });
  assert.equal(req.url, 'https://t/api/p/7');
  assert.deepEqual(req.json, { id: 7, name: 'vision-ai', owner: { email: 'a@b.c' }, keep: 'fijo' });
  assert.equal(req.headers['Content-Type'], 'application/json');
  assert.deepEqual(t.describeFields().map((f) => f.path), ['id', 'name', 'owner.email', 'keep']);
  assert.throws(() => new HttpTarget({ url: 'https://t/{{ref}}', bodyTemplate: '{}' }).buildRequest({ name: 'x' }), /marcador/);

  const f = new HttpTarget({ url: 'https://t', bodyFormat: 'form', bodyTemplate: { a: '' } });
  assert.equal(f.buildRequest({ a: 'x y' }).body, 'a=x+y');
  assert.throws(() => new HttpTarget({ url: 'https://t', bodyTemplate: '{rota' }).validate(), /JSON/);
});

test('SharePointListSource: construye la URL REST y detecta metadatos', () => {
  const s = new SharePointListSource({ siteUrl: 'https://c.sharepoint.com/sites/p/', listTitle: "Pro'yectos", select: 'Id,Title' });
  assert.equal(s.resolveUrl(), "https://c.sharepoint.com/sites/p/_api/web/lists/getbytitle('Pro''yectos')/items?%24top=100&%24select=Id%2CTitle");
  assert.equal(s.requestHeaders.Accept, 'application/json;odata=nometadata');
  assert.ok(s.isNoiseField('__metadata.uri'));
  assert.ok(s.isNoiseField('odata\\.etag'));
  assert.ok(s.isNoiseField('Author.__deferred.uri'));
  assert.ok(!s.isNoiseField('Title'));
  assert.equal(s.getNextUrl({ d: { __next: 'https://c/next' } }), 'https://c/next');
  assert.equal(s.getNextUrl({ 'odata.nextLink': 'https://c/n2' }), 'https://c/n2');
  assert.equal(s.getNextUrl({}), null);
  assert.throws(() => new SharePointListSource({}).validate(), /URL del sitio/);
});
