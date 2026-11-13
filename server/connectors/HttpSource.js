import { SourceConnector } from '../core/SourceConnector.js';
import { HttpClient, ConnectorError, snippet } from '../core/HttpClient.js';
import { SchemaInferer } from '../../shared/SchemaInferer.js';

const METHODS = ['GET', 'POST'];

/** Origen genérico: cualquier endpoint HTTP que devuelva JSON (con o sin paginación). */
export class HttpSource extends SourceConnector {
  static get descriptor() {
    return {
      type: 'http', role: 'source', label: 'API HTTP genérica (JSON)', supportsHar: true,
      description: 'Cualquier endpoint que devuelva JSON. Impórtalo desde un .har o rellénalo a mano.',
      fields: [
        { name: 'url', label: 'URL origen', type: 'text', required: true, placeholder: 'https://api.ejemplo.com/proyectos' },
        { name: 'method', label: 'Método', type: 'select', options: METHODS, default: 'GET' },
        { name: 'headers', label: 'Cabeceras (una por línea: Nombre: valor)', type: 'headers' },
        { name: 'body', label: 'Cuerpo de la petición (opcional)', type: 'textarea' },
        { name: 'itemsPath', label: 'Ruta de la lista de registros', type: 'text', default: 'auto',
          help: '«auto» la detecta sola. Usa «$» si la respuesta ya es una lista, o p. ej. «data.items».' },
      ],
    };
  }

  constructor(config = {}, { http = new HttpClient() } = {}) {
    super(config);
    this.http = http;
    this.inferer = new SchemaInferer();
    this.maxPages = config.maxPages ?? 200;
  }

  validate() {
    if (!this.resolveUrl()) throw new Error('Falta la URL del origen');
    const m = (this.config.method || 'GET').toUpperCase();
    if (!METHODS.includes(m)) throw new Error(`Método no soportado en el origen: ${m}`);
  }

  /** URL de la primera página. Las subclases pueden construirla a partir de otros parámetros. */
  resolveUrl() { return this.config.url; }

  /** Cabeceras de la petición; las subclases pueden añadir valores por defecto. */
  get requestHeaders() { return this.config.headers || {}; }

  /** URL de la página siguiente según la respuesta, o null si no hay más. */
  getNextUrl(/* json, currentUrl */) { return null; }

  async *fetchRecords({ limit = Infinity, signal } = {}) {
    let url = this.resolveUrl();
    let page = 0;
    let count = 0;
    while (url && page < this.maxPages && count < limit) {
      const first = page === 0;
      const res = await this.http.request({
        url,
        method: first ? (this.config.method || 'GET').toUpperCase() : 'GET',
        headers: this.requestHeaders,
        body: first ? this.config.body : undefined,
        signal,
      });
      if (!res.ok) {
        const hint = [401, 403].includes(res.status) ? ' · La sesión/token de la captura probablemente caducó: vuelve a copiar las cabeceras.' : '';
        throw new ConnectorError(`El origen respondió HTTP ${res.status} ${res.statusText}${hint} — ${snippet(res.text, 160)}`, { status: res.status, body: res.text });
      }
      let json;
      try { json = JSON.parse(res.text); }
      catch { throw new ConnectorError(`El origen no devolvió JSON (¿página de login?): ${snippet(res.text, 120)}`); }
      const { items } = this.inferer.extractItems(json, this.config.itemsPath);
      for (const item of items) {
        yield item;
        if (++count >= limit) return;
      }
      url = this.getNextUrl(json, url);
      page++;
    }
  }
}
