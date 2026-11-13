/**
 * Acceso a propiedades anidadas mediante rutas con puntos ("Author.Title", "tags.0").
 * Las claves que contienen un punto se escapan como "\.".
 * Se bloquean claves peligrosas para evitar prototype pollution.
 */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export class ObjectPath {
  static split(path) {
    if (path === '' || path == null) return [];
    const s = String(path);
    const out = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '.') { cur += '.'; i++; }
      else if (c === '.') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  /** Añade una clave (ya sin escapar) a una ruta existente. */
  static append(path, key) {
    const k = String(key).replace(/\./g, '\\.');
    return path === '' || path == null ? k : `${path}.${k}`;
  }

  static get(obj, path) {
    let cur = obj;
    for (const seg of ObjectPath.split(path)) {
      if (cur == null || typeof cur !== 'object') return undefined;
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
      cur = cur[seg];
    }
    return cur;
  }

  static has(obj, path) {
    return ObjectPath.get(obj, path) !== undefined;
  }

  static set(obj, path, value) {
    const segs = ObjectPath.split(path);
    if (!segs.length) throw new Error('Ruta vacía');
    for (const s of segs) if (FORBIDDEN.has(s)) throw new Error(`Segmento de ruta no permitido: ${s}`);
    let cur = obj;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (cur[seg] == null || typeof cur[seg] !== 'object') {
        cur[seg] = /^\d+$/.test(segs[i + 1]) ? [] : {};
      }
      cur = cur[seg];
    }
    cur[segs[segs.length - 1]] = value;
    return obj;
  }
}
