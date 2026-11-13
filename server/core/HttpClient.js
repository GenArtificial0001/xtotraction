export class ConnectorError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.status = status;
    this.body = body;
  }
}

/** Envoltorio de fetch con timeout, validación de protocolo y cuerpo de respuesta como texto. */
export class HttpClient {
  constructor({ timeoutMs = 30_000, fetchImpl = globalThis.fetch } = {}) {
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async request({ url, method = 'GET', headers = {}, body, timeoutMs = this.timeoutMs, signal }) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new ConnectorError(`URL inválida: ${url}`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ConnectorError(`Protocolo no permitido: ${parsed.protocol}`);
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res;
    try {
      res = await this.fetchImpl(url, { method, headers, body: body || undefined, signal: sig });
    } catch (err) {
      if (timeout.aborted) throw new ConnectorError(`Tiempo de espera agotado (${timeoutMs} ms) al llamar a ${parsed.host}`);
      throw new ConnectorError(`No se pudo conectar con ${parsed.host}: ${err.cause?.message || err.message}`);
    }
    const text = await res.text();
    return {
      ok: res.ok, status: res.status, statusText: res.statusText,
      headers: Object.fromEntries(res.headers), text,
    };
  }
}

export const snippet = (text, n = 300) => (text || '').replace(/\s+/g, ' ').trim().slice(0, n);
