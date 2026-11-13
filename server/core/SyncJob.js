
const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * Orquesta una sincronización: lee del origen, mapea y envía al destino.
 * run() es un generador asíncrono de eventos, de modo que quien lo consuma
 * (HTTP, CLI, tests) puede mostrar el progreso en tiempo real.
 */
export class SyncJob {
  constructor({ source, target, mapper, options = {} }) {
    this.source = source;
    this.target = target;
    this.mapper = mapper;
    this.options = { dryRun: true, limit: Infinity, delayMs: 0, stopOnError: false, ...options };
  }

  async *run(signal) {
    const { dryRun, limit, delayMs, stopOnError } = this.options;
    yield { type: 'start', dryRun };
    const totals = { total: 0, ok: 0, failed: 0 };
    let aborted = false;
    try {
      for await (const record of this.source.fetchRecords({ limit, signal })) {
        if (signal?.aborted) { aborted = true; break; }
        const index = totals.total++;
        const { values, warnings } = this.mapper.map(record);
        const label = this.#label(values);
        let result;
        try {
          result = await this.target.send(values, { dryRun, signal });
        } catch (err) {
          result = { ok: false, error: err.message };
        }
        if (result.ok) totals.ok++; else totals.failed++;
        yield { type: 'record', index, label, warnings, ...result };
        if (!result.ok && stopOnError) { aborted = true; break; }
        if (totals.total >= limit) break;
        if (delayMs && !dryRun) await sleep(delayMs, signal);
      }
    } catch (err) {
      yield { type: 'error', error: err.message };
      aborted = true;
    }
    yield { type: 'done', ...totals, aborted, dryRun };
  }

  #label(values) {
    const first = Object.values(values).find((v) => typeof v === 'string' && v) ?? Object.values(values)[0];
    return first === undefined ? '' : String(first).slice(0, 80);
  }
}

