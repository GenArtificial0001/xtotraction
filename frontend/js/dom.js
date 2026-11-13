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

const ICONS = {
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v5',
  save: 'M5 4h11l3 3v13H5V4zM8 4v5h7V4M8 20v-6h8v6',
  play: 'M7 4l12 8-12 8V4z',
  send: 'M4 12l16-8-6 16-2-7-8-1z',
  wand: 'M5 19 16 8m0 0 1-3 1 3 3 1-3 1-1 3-1-3-3-1 3-1zM6 5v3M4.5 6.5h3',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  chevron: 'M6 9l6 6 6-6',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  plus: 'M12 5v14M5 12h14',
  stop: 'M6 6h12v12H6z',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  swap: 'M4 8h14m0 0-4-4m4 4-4 4M20 16H6m0 0 4-4m-4 4 4 4',
  file: 'M6 3h8l4 4v14H6V3zM14 3v4h4',
  table: 'M4 5h16v14H4V5zM4 10h16M10 5v14',
  cloud: 'M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5a4.75 4.75 0 0 1 .5 9.5H7z',
};

/** Ícono SVG de trazo (decorativo). Los datos del path son constantes del código, no entrada de usuario. */
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || ICONS.file);
  svg.append(path);
  return svg;
}
