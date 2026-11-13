// Regenera los HAR de ejemplo:  node examples/generate-har.js
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const har = (entries) => ({ log: { version: '1.2', creator: { name: 'ejemplo-traction-sync', version: '1' }, entries } });

const sharepointBody = {
  'odata.metadata': 'http://127.0.0.1:4001/$metadata',
  value: [
    { Id: 1, Title: 'vision-ai', Descripcion: '<p>Visión por <b>computador</b></p>', Estado: 'Activo', FechaInicio: '2025-03-01T08:00:00Z', Presupuesto: '12000,50', Responsable: { Title: 'Ana Pérez', EMail: 'ana@contoso.com' }, 'odata.etag': '"1"' },
    { Id: 2, Title: 'portal-clientes', Descripcion: '<p>Portal de autoservicio</p>', Estado: 'En pausa', FechaInicio: '2025-05-15T08:00:00Z', Presupuesto: '8000', Responsable: { Title: 'Luis Gómez', EMail: 'luis@contoso.com' } },
  ],
  'odata.nextLink': "http://127.0.0.1:4001/_api/web/lists/getbytitle('Proyectos')/items?$skip=2",
};

const tractionBody = {
  name: 'ejemplo', description: '', status: 'active', startDate: '2025-01-01T00:00:00.000Z', budget: 0,
  owner: { name: 'Nombre', email: 'correo@ejemplo.com' }, tags: ['importado'],
};

const common = [
  { name: 'Authorization', value: 'Bearer demo-token' },
  { name: 'Accept', value: 'application/json' },
  { name: 'User-Agent', value: 'Mozilla/5.0' },
  { name: 'Accept-Encoding', value: 'gzip, deflate' },
  { name: ':authority', value: '127.0.0.1' },
  { name: 'sec-fetch-mode', value: 'cors' },
];

writeFileSync(path.join(dir, 'sharepoint-demo.har'), JSON.stringify(har([
  { startedDateTime: '2025-11-01T10:00:00Z', request: { method: 'GET', url: "http://127.0.0.1:4001/_api/web/lists/getbytitle('Proyectos')/items", headers: common }, response: { status: 200, content: { mimeType: 'application/json', text: JSON.stringify(sharepointBody) } } },
  { startedDateTime: '2025-11-01T10:00:01Z', request: { method: 'GET', url: 'http://127.0.0.1:4001/favicon.ico', headers: [] }, response: { status: 404, content: { mimeType: 'text/html', text: 'not found' } } },
]), null, 2));

writeFileSync(path.join(dir, 'traction-demo.har'), JSON.stringify(har([
  { startedDateTime: '2025-11-01T10:05:00Z', request: { method: 'GET', url: 'http://127.0.0.1:4002/api/projects', headers: common }, response: { status: 200, content: { mimeType: 'application/json', text: '[]' } } },
  { startedDateTime: '2025-11-01T10:05:10Z', request: { method: 'POST', url: 'http://127.0.0.1:4002/api/projects', headers: [...common, { name: 'Content-Type', value: 'application/json' }, { name: 'Content-Length', value: '200' }], postData: { mimeType: 'application/json', text: JSON.stringify(tractionBody) } }, response: { status: 201, content: { mimeType: 'application/json', text: JSON.stringify({ id: 1, ...tractionBody }) } } },
]), null, 2));
console.log('HAR de ejemplo generados en examples/');
