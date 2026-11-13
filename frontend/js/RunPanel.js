import { h, clear, icon } from './dom.js';

/** Ejecución: simulacro (no envía) o envío real, con resultados en tiempo real. */
export class RunPanel {
  constructor({ state, api, toast }) {
    this.state = state;
    this.api = api;
    this.toast = toast;
    this.abort = null;
    this.root = h('section', { class: 'panel', id: 'panel-run', 'aria-labelledby': 'h-run' });
    state.on(['all'], () => this.render());
    this.render();
  }

  render() {
    clear(this.root);
    const opts = this.state.config.options;
    this.limit = h('input', { type: 'number', min: 1, placeholder: 'todos', 'aria-label': 'Límite de registros' });
    this.dry = h('button', { class: 'btn', type: 'button', onclick: () => this.#run(true) }, icon('play'), 'Simulacro (no envía nada)');
    this.real = h('button', { class: 'btn primary', type: 'button', onclick: () => this.#run(false) }, icon('send'), `Enviar a ${this.state.targetName()}`);
    this.stop = h('button', { class: 'btn danger', type: 'button', hidden: true, onclick: () => this.abort?.abort() }, icon('stop'), 'Detener');
    this.summary = h('div', { class: 'summary', role: 'status', 'aria-live': 'polite' });
    this.tbody = h('tbody');
    this.root.append(
      h('div', { class: 'panel-head' }, h('div', {},
        h('h2', { id: 'h-run' }, 'Ejecutar'),
        h('p', { class: 'muted' }, `Primero haz un simulacro: muestra exactamente qué se enviaría a ${this.state.targetName()}, registro por registro, sin enviar nada.`))),
      h('div', { class: 'run-controls' },
        h('label', { class: 'field inline' }, h('span', {}, 'Límite de registros'), this.limit),
        h('label', { class: 'field inline' }, h('span', {}, 'Pausa entre envíos (ms)'),
          h('input', { type: 'number', min: 0, value: opts.delayMs || 0, onchange: (e) => { opts.delayMs = Number(e.target.value) || 0; this.state.dirty = true; } })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.stopOnError, onchange: (e) => { opts.stopOnError = e.target.checked; this.state.dirty = true; } }), 'Detener al primer error'),
      ),
      h('div', { class: 'actions' }, this.dry, this.real, this.stop),
      this.summary,
      h('div', { class: 'table-wrap' }, h('table', { class: 'results-table' },
        h('thead', {}, h('tr', {}, ['#', 'Registro', 'Resultado', 'Detalle'].map((t) => h('th', {}, t)))), this.tbody)),
    );
  }

  async #run(dryRun) {
    const cfg = this.state.config;
    if (!cfg.mappings.length) { this.toast('Define al menos un vínculo en el paso Mapeo', 'error'); return; }
    const limit = Number(this.limit.value) || 0;
    if (!dryRun && !window.confirm(`Se enviarán ${limit ? `hasta ${limit}` : 'TODOS los'} registros a ${this.state.targetName()} y no se puede deshacer desde aquí.\n\n¿Continuar? (Recomendado: haz antes un simulacro)`)) return;

    clear(this.tbody);
    this.abort = new AbortController();
    this.#busy(true);
    this.summary.className = 'summary busy';
    this.summary.textContent = dryRun ? 'Simulando…' : 'Enviando…';
    try {
      await this.api.run(cfg, { dryRun, limit }, (ev) => this.#onEvent(ev), this.abort.signal);
    } catch (err) {
      if (err.name !== 'AbortError') { this.summary.className = 'summary error'; this.summary.textContent = err.message; }
      else { this.summary.className = 'summary warn'; this.summary.textContent = 'Detenido por el usuario.'; }
    } finally { this.#busy(false); this.abort = null; }
  }

  #busy(on) {
    this.dry.disabled = on; this.real.disabled = on; this.stop.hidden = !on;
  }

  #onEvent(ev) {
    if (ev.type === 'record') {
      const status = ev.ok ? (ev.dryRun ? 'sim' : 'ok') : 'fail';
      const label = { sim: 'SIMULADO', ok: 'ENVIADO', fail: 'ERROR' }[status];
      const detail = ev.request ? h('details', {}, h('summary', {}, ev.ok ? `${ev.request.method} ${ev.request.url}` : ev.error),
        h('pre', {}, JSON.stringify(ev.request.body, null, 2)), ev.response && h('pre', { class: 'resp' }, `Respuesta: ${ev.response}`)) : ev.error;
      this.tbody.append(h('tr', { class: `r-${status}` },
        h('td', {}, ev.index + 1), h('td', {}, ev.label || '—'),
        h('td', {}, h('span', { class: `badge ${status}` }, label, ev.status ? ` ${ev.status}` : '')),
        h('td', {}, detail, ev.warnings?.map((w) => h('div', { class: 'muted small' }, `Aviso: ${w}`)))));
      this.tbody.lastChild.scrollIntoView({ block: 'nearest' });
    } else if (ev.type === 'error') {
      this.summary.className = 'summary error';
      this.summary.textContent = ev.error;
    } else if (ev.type === 'done') {
      const bad = ev.failed > 0;
      this.summary.className = `summary ${bad ? 'warn' : 'ok'}`;
      this.summary.textContent = `${ev.dryRun ? 'Simulacro' : 'Envío'} terminado: ${ev.total} registro(s) · ${ev.ok} correctos · ${ev.failed} con error${ev.aborted ? ' · interrumpido' : ''}`;
    }
  }
}
