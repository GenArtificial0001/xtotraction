import { ObjectPath } from './ObjectPath.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Descripción de un campo detectado: ruta, tipo y un valor de ejemplo. */
export class FieldDescriptor {
  constructor({ path, type = 'string', sample = null }) {
    this.path = path;
    this.type = type;
    this.sample = sample;
  }
}

/**
 * Deduce los campos disponibles a partir de datos reales (respuesta de una API,
 * cuerpo de una petición, etc.). Aplana los objetos anidados a rutas con punto.
 */
export class SchemaInferer {
  constructor({ maxArrayItems = 3, maxDepth = 8 } = {}) {
    this.maxArrayItems = maxArrayItems;
    this.maxDepth = maxDepth;
  }

  static typeOf(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'string') return ISO_DATE.test(value) ? 'date' : 'string';
    return typeof value; // number | boolean | object
  }

  /** Devuelve [{path, type, sample}] de un valor cualquiera. */
  flatten(value, prefix = '', depth = 0, out = []) {
    const leaf = (v) => out.push(new FieldDescriptor({ path: prefix, type: SchemaInferer.typeOf(v), sample: v }));
    if (depth > this.maxDepth) { if (prefix) leaf(JSON.stringify(value)); return out; }
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (!keys.length) { if (prefix) leaf(value); return out; }
      for (const k of keys) this.flatten(value[k], ObjectPath.append(prefix, k), depth + 1, out);
    } else if (Array.isArray(value)) {
      if (!value.length || value.every((v) => v === null || typeof v !== 'object')) {
        if (prefix) leaf(value);
      } else {
        value.slice(0, this.maxArrayItems).forEach((v, i) => this.flatten(v, ObjectPath.append(prefix, i), depth + 1, out));
      }
    } else if (prefix) {
      leaf(value);
    }
    return out;
  }

  /** Une los campos de varios registros, conservando el primer ejemplo no nulo. */
  inferFromRecords(records, { exclude = () => false } = {}) {
    const merged = new Map();
    for (const rec of records) {
      for (const f of this.flatten(rec)) {
        if (exclude(f.path)) continue;
        const prev = merged.get(f.path);
        if (!prev) merged.set(f.path, f);
        else if ((prev.sample === null || prev.sample === '') && f.sample !== null) merged.set(f.path, f);
      }
    }
    return [...merged.values()];
  }

  /** Localiza dónde está la lista de registros dentro de una respuesta JSON. '' = la raíz; null = ninguna. */
  findItemsPath(json) {
    if (Array.isArray(json)) return '';
    const candidates = [];
    const walk = (node, path, depth) => {
      if (depth > 4 || node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        if (node.length && node.every(isPlainObject)) candidates.push({ path, len: node.length });
        return;
      }
      for (const [k, v] of Object.entries(node)) walk(v, ObjectPath.append(path, k), depth + 1);
    };
    walk(json, '', 0);
    if (!candidates.length) return null;
    const preferred = ['value', 'd.results', 'results', 'Row', 'items', 'data', 'records', 'rows'];
    const rank = (p) => { const i = preferred.indexOf(p); return i === -1 ? preferred.length : i; };
    candidates.sort((a, b) => rank(a.path) - rank(b.path) || b.len - a.len);
    return candidates[0].path;
  }

  /** Extrae los registros de una respuesta JSON usando itemsPath (o autodetección). */
  extractItems(json, itemsPath) {
    // undefined / null / 'auto' => autodetectar · '' o '$' => la raíz es la lista
    let path = itemsPath === undefined || itemsPath === null || itemsPath === 'auto'
      ? this.findItemsPath(json) : itemsPath;
    if (path === '$') path = '';
    if (path === null) return { itemsPath: null, items: isPlainObject(json) ? [json] : [] };
    const node = path === '' ? json : ObjectPath.get(json, path);
    if (Array.isArray(node)) return { itemsPath: path, items: node.filter(isPlainObject) };
    return { itemsPath: path, items: isPlainObject(node) ? [node] : [] };
  }
}
