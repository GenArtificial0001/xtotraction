/** Crea elementos del DOM sin innerHTML (evita inyección de HTML con datos externos). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected', 'open', 'draggable'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

export const truncate = (v, n = 48) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? '' : (s.length > n ? `${s.slice(0, n)}…` : s);
};

/** «Nombre: valor» por línea ⇄ objeto. */
export const headersToText = (obj = {}) => Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('\n');
export function textToHeaders(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    if (name) out[name] = line.slice(i + 1).trim();
  }
  return out;
}

export const debounce = (fn, ms = 400) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
