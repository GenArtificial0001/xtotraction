/**
 * Servidores de demostración (NO son SharePoint ni Traction reales):
 *  - «SharePoint»: http://127.0.0.1:4001  → lista «Proyectos» con paginación, requiere  Authorization: Bearer demo-token
 *  - «Traction»  : http://127.0.0.1:4002  → POST /api/projects crea, GET /api/projects lista
 * Sirven para probar el flujo completo sin credenciales reales:  npm run demo
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const DEMO_TOKEN = 'demo-token';

const PROJECTS = [
  { Id: 1, Title: 'vision-ai', Descripcion: '<p>Visión por <b>computador</b></p>', Estado: 'Activo', FechaInicio: '2025-03-01T08:00:00Z', Presupuesto: '12000,50', Responsable: { Title: 'Ana Pérez', EMail: 'ana@contoso.com' }, 'odata.etag': '"1"' },
  { Id: 2, Title: 'portal-clientes', Descripcion: '<p>Portal de autoservicio</p>', Estado: 'En pausa', FechaInicio: '2025-05-15T08:00:00Z', Presupuesto: '8000', Responsable: { Title: 'Luis Gómez', EMail: 'luis@contoso.com' } },
  { Id: 3, Title: 'migracion-erp', Descripcion: '<p>Migración a la nube</p>', Estado: 'Activo', FechaInicio: '2025-07-01T08:00:00Z', Presupuesto: '45000', Responsable: { Title: 'Marta Ruiz', EMail: 'marta@contoso.com' } },
  { Id: 4, Title: 'chatbot-soporte', Descripcion: '<p>Asistente de soporte</p>', Estado: 'Planificado', FechaInicio: '2025-09-10T08:00:00Z', Presupuesto: '6500', Responsable: { Title: 'Ana Pérez', EMail: 'ana@contoso.com' } },
  { Id: 5, Title: 'data-lake', Descripcion: '<p>Lago de datos</p>', Estado: 'Activo', FechaInicio: '2025-10-20T08:00:00Z', Presupuesto: '30000', Responsable: { Title: 'Luis Gómez', EMail: 'luis@contoso.com' } },
];

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

export function createMockSharePoint({ port = 4001, pageSize = 2 } = {}) {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${DEMO_TOKEN}`) return json(res, 401, { error: 'unauthorized' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (!/\/_api\/web\/lists\/getbytitle\('Proyectos'\)\/items$/.test(decodeURIComponent(url.pathname))) return json(res, 404, { error: 'lista no encontrada' });
    const skip = Number(url.searchParams.get('$skip') || 0);
    const slice = PROJECTS.slice(skip, skip + pageSize);
    const body = { 'odata.metadata': 'demo', value: slice };
    if (skip + pageSize < PROJECTS.length) {
      body['odata.nextLink'] = `http://${req.headers.host}${url.pathname}?$skip=${skip + pageSize}`;
    }
    return json(res, 200, body);
  });
  return server;
}

export function createMockTraction({ port = 4002 } = {}) {
  const created = [];
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${DEMO_TOKEN}`) return json(res, 401, { error: 'unauthorized' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/api/projects') return json(res, 200, created);
    if (req.method === 'POST' && url.pathname === '/api/projects') {
      let raw = '';
      for await (const c of req) raw += c;
      let body;
      try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'JSON inválido' }); }
      if (!body.name) return json(res, 422, { error: 'name es obligatorio' });
      const project = { id: created.length + 1, ...body };
      created.push(project);
      return json(res, 201, project);
    }
    return json(res, 404, { error: 'no encontrado' });
  });
  server.created = created;
  return server;
}

const listen = (server, port) => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await listen(createMockSharePoint(), 4001);
  await listen(createMockTraction(), 4002);
  console.log('«SharePoint» demo → http://127.0.0.1:4001/_api/web/lists/getbytitle(\'Proyectos\')/items   (Authorization: Bearer demo-token)');
  console.log('«Traction»  demo → http://127.0.0.1:4002/api/projects                                      (Authorization: Bearer demo-token)');
  console.log('Importa examples/sharepoint-demo.har como origen y examples/traction-demo.har como destino.');
}
