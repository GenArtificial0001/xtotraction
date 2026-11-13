import { TargetConnector } from '../core/TargetConnector.js';
import { HttpClient, snippet } from '../core/HttpClient.js';
import { ObjectPath } from '../../shared/ObjectPath.js';
import { SchemaInferer } from '../../shared/SchemaInferer.js';

const METHODS = ['POST', 'PUT', 'PATCH'];

/**
 * Destino HTTP genérico (Traction u otra API). Usa como plantilla el cuerpo de una
 * petición real (p. ej. la que el navegador hizo al crear un proyecto, importada del .har):
 * los campos mapeados sustituyen sus valores y el resto de la plantilla se conserva.
 * La URL admite marcadores {{ruta.del.campo}} resueltos con el cuerpo final (útil en PUT /proyectos/{{id}}).
 */
export class HttpTarget extends TargetConnector {
  static get descriptor() {
    return {
      type: 'http', role: 'target', label: 'Traction / API HTTP', supportsHar: true,
      description: 'Importa la petición que crea un registro (POST) desde un .har, o descríbela a mano.',
      fields: [
        { name: 'url', label: 'URL destino', type: 'text', required: true, placeholder: 'https://traction.ejemplo.com/api/projects' },
        { name: 'method', label: 'Método', type: 'select', options: METHODS, default: 'POST' },
        { name: 'headers', label: 'Cabeceras / autenticación (una por línea)', type: 'headers' },
        { name: 'bodyFormat', label: 'Formato del cuerpo', type: 'select', options: ['json', 'form'], default: 'json' },
        { name: 'bodyTemplate', label: 'Plantilla del cuerpo (JSON)', type: 'json',
          help: 'Sus campos son los campos destino. Los valores no mapeados se envían tal cual.' },
      ],
    };
  }

  constructor(config = {}, { http = new HttpClient() } = {}) {
    super(config);
    this.http = http;
    this.inferer = new SchemaInferer();
  }

  get template() {
    const t = this.config.bodyTemplate;
    if (t === undefined || t === null || t === '') return {};
    if (typeof t === 'string') return JSON.parse(t);
    return t;
  }

  validate() {
    if (!this.config.url) throw new Error('Falta la URL del destino');
    const method = (this.config.method || 'POST').toUpperCase();
    if (!METHODS.includes(method)) throw new Error(`Método no soportado en el destino: ${method}`);
    try { this.template; } catch { throw new Error('La plantilla del cuerpo no es JSON válido'); }
  }

  describeFields() { return this.inferer.flatten(this.template); }

  buildRequest(values) {
    const body = structuredClone(this.template);
    for (const [path, value] of Object.entries(values)) ObjectPath.set(body, path, value);

    const url = this.config.url.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p) => {
      const v = ObjectPath.get(body, p);
      if (v === undefined || v === null) throw new Error(`El marcador {{${p}}} de la URL no tiene valor`);
      return encodeURIComponent(String(v));
    });

    const headers = { ...(this.config.headers || {}) };
    const hasHeader = (n) => Object.keys(headers).some((k) => k.toLowerCase() === n);
    let payload;
    if (this.config.bodyFormat === 'form') {
      payload = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')])).toString();
      if (!hasHeader('content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      payload = JSON.stringify(body);
      if (!hasHeader('content-type')) headers['Content-Type'] = 'application/json';
    }
    return { method: (this.config.method || 'POST').toUpperCase(), url, headers, body: payload, json: body };
  }

  async send(values, { dryRun = false, signal } = {}) {
    const req = this.buildRequest(values);
    const preview = { method: req.method, url: req.url, body: req.json };
    if (dryRun) return { ok: true, status: null, dryRun: true, request: preview };
    const res = await this.http.request({ url: req.url, method: req.method, headers: req.headers, body: req.body, signal });
    return {
      ok: res.ok, status: res.status, request: preview, response: snippet(res.text, 400),
      error: res.ok ? undefined : `HTTP ${res.status} ${res.statusText} — ${snippet(res.text, 200)}`,
    };
  }
}
