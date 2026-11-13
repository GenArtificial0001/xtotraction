import { HttpSource } from './HttpSource.js';
import { ObjectPath } from '../../shared/ObjectPath.js';

const NOISE = /(^|\.)(__metadata|__deferred|odata\\\.[a-z]+|@odata[^.]*)(\.|$)/i;

/**
 * Lista de SharePoint vía REST (/_api/web/lists/...). Entiende los formatos OData
 * «nometadata» (value) y «verbose» (d.results), y sigue la paginación (nextLink / __next).
 * También sirve cuando se importa una captura .har de cualquier llamada de la lista
 * (p. ej. RenderListDataAsStream: los registros están en «Row»).
 */
export class SharePointListSource extends HttpSource {
  static get descriptor() {
    return {
      type: 'sharepoint-list', role: 'source', label: 'Lista de SharePoint', supportsHar: true,
      noisePattern: NOISE.source,
      description: 'Indica sitio y lista, o importa un .har de la lista abierta en SharePoint.',
      fields: [
        { name: 'siteUrl', label: 'URL del sitio', type: 'text', placeholder: 'https://contoso.sharepoint.com/sites/proyectos',
          help: 'Se ignora si rellenas la URL completa (o importas un HAR).' },
        { name: 'listTitle', label: 'Nombre de la lista', type: 'text', placeholder: 'Proyectos' },
        { name: 'select', label: 'Columnas ($select, opcional)', type: 'text', placeholder: 'Id,Title,Estado' },
        { name: 'filter', label: 'Filtro ($filter, opcional)', type: 'text', placeholder: "Estado eq 'Activo'" },
        { name: 'url', label: 'URL completa del endpoint (opcional)', type: 'text' },
        { name: 'method', label: 'Método', type: 'select', options: ['GET', 'POST'], default: 'GET' },
        { name: 'headers', label: 'Cabeceras / autenticación (una por línea)', type: 'headers',
          help: 'Pega aquí Authorization: Bearer … o Cookie: … (copiado del HAR). Caducan: renuévalos cuando falle con 401/403.' },
        { name: 'body', label: 'Cuerpo (solo para POST)', type: 'textarea' },
        { name: 'itemsPath', label: 'Ruta de la lista de registros', type: 'text', default: 'auto' },
      ],
    };
  }

  validate() {
    if (!this.resolveUrl()) throw new Error('Indica la URL del sitio y el nombre de la lista, o la URL completa del endpoint');
    super.validate();
  }

  resolveUrl() {
    const { url, siteUrl, listTitle, select, filter } = this.config;
    if (url) return url;
    if (!siteUrl || !listTitle) return '';
    const base = siteUrl.replace(/\/+$/, '');
    const q = new URLSearchParams({ $top: '100' });
    if (select) q.set('$select', select);
    if (filter) q.set('$filter', filter);
    return `${base}/_api/web/lists/getbytitle('${listTitle.replace(/'/g, "''")}')/items?${q}`;
  }

  /** Cabeceras por defecto: pedir JSON ligero si el usuario no indicó Accept. */
  get requestHeaders() {
    const h = { ...(this.config.headers || {}) };
    if (!Object.keys(h).some((k) => k.toLowerCase() === 'accept')) h.Accept = 'application/json;odata=nometadata';
    return h;
  }

  getNextUrl(json) {
    const next = ObjectPath.get(json, 'odata\\.nextLink') ?? json?.['@odata.nextLink'] ?? json?.d?.__next ?? json?.NextHref;
    if (typeof next !== 'string' || !next) return null;
    try { return new URL(next, this.resolveUrl()).toString(); } catch { return null; }
  }

  isNoiseField(path) { return NOISE.test(path); }
}
