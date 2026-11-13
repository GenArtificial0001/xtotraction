import { SchemaInferer } from './SchemaInferer.js';

/** Cabeceras que no deben copiarse de una captura del navegador al conectar desde el servidor. */
const SKIPPED_HEADERS = new Set([
  'host', 'content-length', 'connection', 'accept-encoding', 'priority', 'te',
  'upgrade-insecure-requests', 'keep-alive', 'transfer-encoding', 'if-none-match', 'if-modified-since',
]);

const isSkippedHeader = (name) => {
  const n = name.toLowerCase();
  return n.startsWith(':') || n.startsWith('sec-') || SKIPPED_HEADERS.has(n);
};

function decodeBase64Utf8(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Una petición/respuesta capturada dentro de un .har. */
export class HarEntry {
  constructor(raw, index) {
    this.raw = raw;
    this.index = index;
  }

  get method() { return (this.raw.request?.method || 'GET').toUpperCase(); }
  get url() { return this.raw.request?.url || ''; }
  get status() { return this.raw.response?.status ?? 0; }
  get mimeType() { return (this.raw.response?.content?.mimeType || '').split(';')[0].trim(); }
  get startedAt() { return this.raw.startedDateTime || ''; }
  get requestMimeType() { return (this.raw.request?.postData?.mimeType || '').split(';')[0].trim(); }

  /** Cabeceras de la petición, saneadas y como objeto {nombre: valor}. */
  get requestHeaders() {
    const out = {};
    for (const h of this.raw.request?.headers || []) {
      if (!h?.name || isSkippedHeader(h.name)) continue;
      out[h.name] = h.value;
    }
    return out;
  }

  get requestBodyText() {
    const pd = this.raw.request?.postData;
    if (!pd) return '';
    if (typeof pd.text === 'string') return pd.text;
    if (Array.isArray(pd.params)) {
      return new URLSearchParams(pd.params.map((p) => [p.name, p.value ?? ''])).toString();
    }
    return '';
  }

  get hasRequestBody() { return this.requestBodyText.length > 0; }

  get responseText() {
    const c = this.raw.response?.content;
    if (!c || typeof c.text !== 'string') return '';
    try {
      return c.encoding === 'base64' ? decodeBase64Utf8(c.text) : c.text;
    } catch { return ''; }
  }

  get isJsonResponse() {
    return /json/i.test(this.mimeType) || /^\s*[[{]/.test(this.responseText.slice(0, 20));
  }

  /** Resumen ligero para listar en la interfaz. */
  summary() {
    return {
      index: this.index, method: this.method, url: this.url, status: this.status,
      mimeType: this.mimeType, hasRequestBody: this.hasRequestBody,
      hasResponseBody: this.responseText.length > 0, isJson: this.isJsonResponse,
    };
  }

  /**
   * Borrador de configuración para un ORIGEN: la URL/cabeceras de la petición y los campos
   * deducidos del cuerpo de la respuesta.
   */
  toSourceDraft(inferer = new SchemaInferer()) {
    const warnings = [];
    const config = {
      url: this.url,
      method: this.method,
      headers: this.requestHeaders,
      body: this.method === 'GET' ? '' : this.requestBodyText,
      itemsPath: 'auto',
    };
    let fields = [];
    let sample = [];
    const text = this.responseText;
    if (!text) {
      warnings.push('Lo importado no incluye el cuerpo de la respuesta (si es un HAR, expórtalo «con contenido»). Pulsa «Probar y traer campos» para obtenerlos en vivo.');
    } else {
      try {
        const json = JSON.parse(text);
        const { itemsPath, items } = inferer.extractItems(json, 'auto');
        config.itemsPath = itemsPath === null ? 'auto' : (itemsPath === '' ? '$' : itemsPath);
        sample = items.slice(0, 5);
        fields = inferer.inferFromRecords(sample);
        if (!fields.length) warnings.push('La respuesta es JSON pero no se encontraron registros.');
      } catch {
        warnings.push('El cuerpo de la respuesta no es JSON válido.');
      }
    }
    return { config, fields, sample, warnings };
  }

  /**
   * Borrador de configuración para un DESTINO: la URL/cabeceras y el cuerpo de la petición
   * como plantilla; sus campos son los campos destino disponibles.
   */
  toTargetDraft(inferer = new SchemaInferer()) {
    const warnings = [];
    const config = {
      url: this.url,
      method: ['POST', 'PUT', 'PATCH'].includes(this.method) ? this.method : 'POST',
      headers: this.requestHeaders,
      bodyFormat: 'json',
      bodyTemplate: '',
    };
    let fields = [];
    const text = this.requestBodyText;
    const mime = this.requestMimeType;
    if (!text) {
      warnings.push('Esta petición no tiene cuerpo. Usa la que crea/edita un registro (POST/PUT/PATCH).');
    } else if (/multipart\//i.test(mime)) {
      warnings.push('El cuerpo es multipart/form-data, aún no soportado. Usa una petición JSON o x-www-form-urlencoded.');
    } else if (/x-www-form-urlencoded/i.test(mime)) {
      config.bodyFormat = 'form';
      const obj = Object.fromEntries(new URLSearchParams(text));
      config.bodyTemplate = JSON.stringify(obj, null, 2);
      fields = inferer.flatten(obj);
    } else {
      try {
        const json = JSON.parse(text);
        config.bodyTemplate = JSON.stringify(json, null, 2);
        fields = inferer.flatten(json);
      } catch {
        warnings.push('El cuerpo de la petición no es JSON válido.');
      }
    }
    return { config, fields, warnings };
  }
}

/** Documento .har completo. */
export class HarDocument {
  constructor(entries, meta = {}) {
    this.entries = entries;
    this.meta = meta;
  }

  get(index) { return this.entries[index]; }

  /** Filtra entradas por texto (URL/método), solo JSON y/o solo con cuerpo en la petición. */
  filter({ text = '', onlyJson = false, onlyWithRequestBody = false } = {}) {
    const q = text.trim().toLowerCase();
    return this.entries.filter((e) => {
      if (onlyJson && !e.isJsonResponse) return false;
      if (onlyWithRequestBody && !e.hasRequestBody) return false;
      if (q && !`${e.method} ${e.url}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }
}

export class HarParser {
  /** Acepta el texto del archivo .har o el objeto ya parseado. */
  static parse(input) {
    let har = input;
    if (typeof input === 'string') {
      try { har = JSON.parse(input.replace(/^﻿/, '')); }
      catch { throw new Error('El archivo no es un JSON válido.'); }
    }
    const entries = har?.log?.entries;
    if (!Array.isArray(entries)) throw new Error('No parece un archivo HAR: falta log.entries.');
    return new HarDocument(
      entries.map((raw, i) => new HarEntry(raw, i)),
      { creator: har.log.creator?.name, version: har.log.version },
    );
  }
}

/** Entrada sintética a partir de un JSON pegado a mano: respuesta de ejemplo (origen) o cuerpo de petición (destino). */
export function entryFromJsonSample(text, role) {
  const trimmed = text.trim();
  JSON.parse(trimmed); // lanza si no es JSON
  const raw = role === 'target'
    ? { request: { method: 'POST', url: '', headers: [], postData: { mimeType: 'application/json', text: trimmed } }, response: { status: 0, content: {} } }
    : { request: { method: 'GET', url: '', headers: [] }, response: { status: 200, content: { mimeType: 'application/json', text: trimmed } } };
  return new HarEntry(raw, 0);
}
