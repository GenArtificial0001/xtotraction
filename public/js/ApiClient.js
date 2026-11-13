export class ApiError extends Error {}

/** Cliente de la API del servidor. */
export class ApiClient {
  async #json(method, url, body) {
    const res = await fetch(url, {
      method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Error HTTP ${res.status}`);
    return data;
  }

  meta() { return this.#json('GET', '/api/meta'); }
  listConfigs() { return this.#json('GET', '/api/configs'); }
  getConfig(id) { return this.#json('GET', `/api/configs/${encodeURIComponent(id)}`); }
  saveConfig(config) { return this.#json('POST', '/api/configs', config); }
  deleteConfig(id) { return this.#json('DELETE', `/api/configs/${encodeURIComponent(id)}`); }
  previewSource(id, source, limit = 5) { return this.#json('POST', '/api/source/preview', { id, source, limit }); }
  describeTarget(target) { return this.#json('POST', '/api/target/describe', { target }); }

  /** Ejecuta la sincronización y llama a onEvent por cada evento NDJSON recibido. */
  async run(config, { dryRun, limit }, onEvent, signal) {
    const res = await fetch('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ config, dryRun, limit: limit || undefined }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error || `Error HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onEvent(JSON.parse(line));
      }
    }
  }
}
