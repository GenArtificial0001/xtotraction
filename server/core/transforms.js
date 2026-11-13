/** Transformación de un valor antes de enviarlo al destino. Extiende esta clase para añadir más. */
export class Transform {
  static id = 'transform';
  static label = 'Transformación';
  apply(value) { return value; }
}

const str = (v) => (v === null || v === undefined ? v : String(v));

export class IdentityTransform extends Transform {
  static id = 'none'; static label = 'Sin cambios';
}
export class TrimTransform extends Transform {
  static id = 'trim'; static label = 'Quitar espacios';
  apply(v) { return typeof v === 'string' ? v.trim() : v; }
}
export class UpperTransform extends Transform {
  static id = 'upper'; static label = 'MAYÚSCULAS';
  apply(v) { return typeof v === 'string' ? v.toUpperCase() : v; }
}
export class LowerTransform extends Transform {
  static id = 'lower'; static label = 'minúsculas';
  apply(v) { return typeof v === 'string' ? v.toLowerCase() : v; }
}
export class StringTransform extends Transform {
  static id = 'string'; static label = 'A texto';
  apply(v) { return typeof v === 'object' && v !== null ? JSON.stringify(v) : str(v); }
}
export class NumberTransform extends Transform {
  static id = 'number'; static label = 'A número';
  apply(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
    return Number.isNaN(n) ? null : n;
  }
}
export class BooleanTransform extends Transform {
  static id = 'boolean'; static label = 'A sí/no (booleano)';
  apply(v) {
    if (typeof v === 'string') return ['true', '1', 'yes', 'si', 'sí', 'y'].includes(v.trim().toLowerCase());
    return Boolean(v);
  }
}
export class IsoDateTransform extends Transform {
  static id = 'isoDate'; static label = 'Fecha ISO 8601';
  apply(v) {
    if (v === null || v === undefined || v === '') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
}
export class DateOnlyTransform extends Transform {
  static id = 'dateOnly'; static label = 'Solo fecha (AAAA-MM-DD)';
  apply(v) {
    const iso = new IsoDateTransform().apply(v);
    return iso ? iso.slice(0, 10) : null;
  }
}
export class StripHtmlTransform extends Transform {
  static id = 'stripHtml'; static label = 'Quitar HTML (texto enriquecido)';
  apply(v) {
    if (typeof v !== 'string') return v;
    return v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
  }
}

export class TransformRegistry {
  #map = new Map();
  register(TransformClass) {
    this.#map.set(TransformClass.id, new TransformClass());
    return this;
  }
  get(id) {
    const t = this.#map.get(id || 'none');
    if (!t) throw new Error(`Transformación desconocida: ${id}`);
    return t;
  }
  has(id) { return this.#map.has(id || 'none'); }
  list() { return [...this.#map.values()].map((t) => ({ id: t.constructor.id, label: t.constructor.label })); }

  static withDefaults() {
    const r = new TransformRegistry();
    [IdentityTransform, TrimTransform, UpperTransform, LowerTransform, StringTransform, NumberTransform,
      BooleanTransform, IsoDateTransform, DateOnlyTransform, StripHtmlTransform].forEach((t) => r.register(t));
    return r;
  }
}
