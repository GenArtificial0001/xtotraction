export const MASK = '••••••••';

const SENSITIVE = /^(authorization|cookie|set-cookie|proxy-authorization|x-requestdigest|x-csrf-token|x-xsrf-token)$|token|secret|api[-_]?key|password/i;

/**
 * Evita que las credenciales guardadas (tokens, cookies copiadas de un HAR) vuelvan al navegador:
 * se devuelven enmascaradas y, al guardar, un valor enmascarado conserva el original.
 */
export class SecretMasker {
  static isSensitive(headerName) { return SENSITIVE.test(headerName); }

  static #mapHeaders(headers, fn) {
    if (!headers || typeof headers !== 'object') return headers;
    return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, fn(k, v)]));
  }

  static mask(config) {
    const out = structuredClone(config);
    for (const role of ['source', 'target']) {
      if (out[role]?.headers) {
        out[role].headers = SecretMasker.#mapHeaders(out[role].headers, (k, v) => (SecretMasker.isSensitive(k) && v ? MASK : v));
      }
    }
    return out;
  }

  /** Sustituye los valores enmascarados de `incoming` por los reales de `stored`. */
  static restore(incoming, stored) {
    const out = structuredClone(incoming);
    if (!stored) return out;
    for (const role of ['source', 'target']) {
      const storedHeaders = stored[role]?.headers || {};
      if (out[role]?.headers) {
        out[role].headers = SecretMasker.#mapHeaders(out[role].headers, (k, v) => (v === MASK ? (storedHeaders[k] ?? '') : v));
      }
    }
    return out;
  }
}
