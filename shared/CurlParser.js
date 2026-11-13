import { HarEntry } from './HarParser.js';

const ANSI_ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v' };

/**
 * Interpreta un comando «curl» (p. ej. «Copiar como cURL (bash)» del navegador) y lo convierte en una
 * entrada equivalente a la de un HAR, para reutilizar el mismo flujo de importación.
 */
export class CurlParser {
  static looksLikeCurl(text) { return /^\s*curl(\s|$)/i.test(text); }

  /** Divide la línea de comandos respetando comillas ('…', "…", $'…') y continuaciones con «\». */
  static tokenize(text) {
    const s = text.replace(/\\\r?\n/g, ' ');
    const tokens = [];
    let cur = '';
    let has = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/\s/.test(c)) { if (has) { tokens.push(cur); cur = ''; has = false; } continue; }
      has = true;
      if (c === "'") {
        const end = s.indexOf("'", i + 1);
        if (end < 0) throw new Error('Comillas simples sin cerrar');
        cur += s.slice(i + 1, end); i = end;
      } else if (c === '$' && s[i + 1] === "'") {
        i += 2;
        for (; i < s.length && s[i] !== "'"; i++) {
          if (s[i] !== '\\') { cur += s[i]; continue; }
          const n = s[++i];
          if (n === 'u') { cur += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; }
          else if (n === 'x') { cur += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
          else cur += ANSI_ESC[n] ?? n;
        }
        if (i >= s.length) throw new Error('Comillas $\'…\' sin cerrar');
      } else if (c === '"') {
        i++;
        for (; i < s.length && s[i] !== '"'; i++) {
          if (s[i] === '\\' && '"\\$`'.includes(s[i + 1])) i++;
          cur += s[i];
        }
        if (i >= s.length) throw new Error('Comillas dobles sin cerrar');
      } else if (c === '\\') { cur += s[++i] ?? ''; } else cur += c;
    }
    if (has) tokens.push(cur);
    return tokens;
  }

  static parse(text) {
    const t = CurlParser.tokenize(text.trim());
    if (!/^curl$/i.test(t[0] || '')) throw new Error('El texto no empieza con «curl».');
    const out = { method: '', url: '', headers: {}, data: [] };
    const takesArg = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode',
      '-u', '--user', '-b', '--cookie', '-A', '--user-agent', '-e', '--referer', '--url', '-o', '--output', '-m', '--max-time', '--connect-timeout', '-F', '--form']);
    for (let i = 1; i < t.length; i++) {
      const a = t[i];
      if (!a.startsWith('-') || a === '-') { if (!out.url) out.url = a; continue; }
      const eq = a.startsWith('--') ? a.indexOf('=') : -1;
      const flag = eq > 0 ? a.slice(0, eq) : a;
      const arg = () => (eq > 0 ? a.slice(eq + 1) : t[++i] ?? '');
      if (!takesArg.has(flag)) continue;
      const v = arg();
      switch (flag) {
        case '-X': case '--request': out.method = v.toUpperCase(); break;
        case '-H': case '--header': { const k = v.indexOf(':'); if (k > 0) out.headers[v.slice(0, k).trim()] = v.slice(k + 1).trim(); break; }
        case '-u': case '--user': out.headers.Authorization = `Basic ${btoa(v)}`; break;
        case '-b': case '--cookie': out.headers.Cookie = v; break;
        case '-A': case '--user-agent': out.headers['User-Agent'] = v; break;
        case '-e': case '--referer': out.headers.Referer = v; break;
        case '--url': out.url = v; break;
        case '-F': case '--form': throw new Error('Los formularios multipart (-F) no están soportados.');
        case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii': case '--data-urlencode': out.data.push(v); break;
        default: break;
      }
    }
    if (!out.url) throw new Error('No se encontró la URL en el comando curl.');
    const body = out.data.join('&');
    return { method: out.method || (body ? 'POST' : 'GET'), url: out.url, headers: out.headers, body };
  }

  /** curl → HarEntry (sin cuerpo de respuesta). */
  static toHarEntry(text) {
    const { method, url, headers, body } = CurlParser.parse(text);
    const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    const raw = {
      request: {
        method, url, headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
        postData: body ? { mimeType: ct || 'application/x-www-form-urlencoded', text: body } : undefined,
      },
      response: { status: 0, content: { mimeType: '', text: '' } },
    };
    return new HarEntry(raw, 0);
  }
}
