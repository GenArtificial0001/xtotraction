import { h, clear, truncate, headersToText, textToHeaders, debounce } from './dom.js';

/**
 * Panel de un conector (origen o destino). El formulario se genera a partir del
 * «descriptor» que declara cada conector en el servidor, así un conector nuevo
 * aparece en la interfaz sin tocar el frontend.
 */
export class ConnectorPanel {
  constructor({ role, state, api, harModal, toast }) {
    this.role = role;
    this.state = state;
    this.api = api;
    this.harModal = harModal;
    this.toast = toast;
    this.root = h('section', { class: 'panel', id: `panel-${role}`, 'aria-labelledby': `h-${role}` });
    this.notes = [];
    this.describeTarget = debounce(() => this.#describeTarget(), 500);
    state.on([role, 'all'], () => this.render());
    state.on(['fields'], () => this.#renderFields());
  }

  get cfg() { return this.state.config[this.role]; }
  get isSource() { return this.role === 'source'; }

  render() {
    const d = this.state.descriptor(this.role);
    const types = this.isSource ? this.state.meta.sources : this.state.meta.targets;
    clear(this.root);
    this.status = h('p', { class: 'status-line', role: 'status', 'aria-live': 'polite' });
    this.fieldsBox = h('div', { class: 'fields-box' });

    this.root.append(
      h('div', { class: 'panel-head' },
        h('div', {},
          h('h2', { id: `h-${this.role}` }, this.isSource ? '1 · Origen de los datos' : '2 · Destino (Traction)'),
          h('p', { class: 'muted' }, d.description),
        ),
        d.supportsHar && h('button', { class: 'btn', type: 'button', onclick: () => this.#importHar() }, '📥 Importar .har'),
      ),
      types.length > 1 && h('label', { class: 'field' }, h('span', {}, 'Tipo de conector'),
        h('select', { onchange: (e) => this.state.setType(this.role, e.target.value) },
          types.map((t) => h('option', { value: t.type, selected: t.type === this.cfg.type }, t.label)))),
      h('div', { class: 'form-grid' }, d.fields.map((f) => this.#renderField(f))),
      h('div', { class: 'actions' },
        this.isSource
          ? h('button', { class: 'btn primary', type: 'button', onclick: (e) => this.#testSource(e.currentTarget) }, '🔌 Probar y traer campos')
          : h('button', { class: 'btn primary', type: 'button', onclick: () => this.#describeTarget(true) }, '🔍 Analizar plantilla'),
        this.status,
      ),
      this.fieldsBox,
    );
    this.#renderNotes();
    this.#renderFields();
  }

  #renderField(f) {
    const value = this.cfg[f.name] ?? f.default ?? '';
    const set = (v) => { this.state.setSetting(this.role, f.name, v); };
    let input;
    if (f.type === 'select') {
      input = h('select', { onchange: (e) => set(e.target.value) },
        f.options.map((o) => h('option', { value: o, selected: o === value }, o)));
      if (this.cfg[f.name] === undefined) this.cfg[f.name] = value;
    } else if (f.type === 'headers') {
      input = h('textarea', { rows: 4, spellcheck: false, class: 'mono', value: headersToText(this.cfg.headers),
        placeholder: 'Authorization: Bearer …\nAccept: application/json', oninput: (e) => set(textToHeaders(e.target.value)) });
    } else if (f.type === 'textarea' || f.type === 'json') {
      const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
      const err = h('small', { class: 'error' });
      input = h('div', {}, h('textarea', {
        rows: f.type === 'json' ? 9 : 3, spellcheck: false, class: 'mono', value: text,
        oninput: (e) => {
          set(e.target.value);
          if (f.type === 'json') {
            try { if (e.target.value.trim()) JSON.parse(e.target.value); err.textContent = ''; if (!this.isSource) this.describeTarget(); }
            catch { err.textContent = 'JSON no válido'; }
          }
        },
      }), err);
    } else {
      input = h('input', { type: 'text', value, placeholder: f.placeholder || '', spellcheck: false, oninput: (e) => set(e.target.value) });
      if (f.default !== undefined && this.cfg[f.name] === undefined) this.cfg[f.name] = f.default;
    }
    return h('label', { class: `field ${['headers', 'textarea', 'json'].includes(f.type) ? 'wide' : ''}` },
      h('span', {}, f.label, f.required && h('b', { class: 'req', title: 'obligatorio' }, ' *')),
      input, f.help && h('small', { class: 'muted' }, f.help));
  }

  #importHar() {
    this.harModal.open(this.role, (draft) => {
      if (!draft.config.url) delete draft.config.url;
      const noise = this.state.descriptor(this.role).noisePattern;
      if (noise) draft.fields = draft.fields.filter((f) => !new RegExp(noise, 'i').test(f.path));
      this.state.applyDraft(this.role, draft);
      this.notes = draft.warnings.map((w) => ({ kind: 'warn', text: w }));
      const n = draft.fields.length;
      if (n) this.notes.unshift({ kind: 'ok', text: `HAR importado: ${n} campo(s) detectado(s). Revisa las cabeceras/credenciales.` });
      this.#renderNotes();
    });
  }

  #renderNotes() {
    this.root.querySelector('.notes')?.remove();
    if (!this.notes.length) return;
    this.root.querySelector('.actions').before(h('div', { class: 'notes' },
      this.notes.map((n) => h('p', { class: `note ${n.kind}` }, n.text))));
  }

  setStatus(text, kind = '') {
    this.status.textContent = text;
    this.status.className = `status-line ${kind}`;
  }

  async #testSource(btn) {
    btn.disabled = true;
    this.setStatus('Conectando…', 'busy');
    try {
      const { fields, records } = await this.api.previewSource(this.state.config.id, this.cfg, 5);
      this.state.setFields('source', fields);
      this.notes = [];
      this.#renderNotes();
      this.setStatus(records.length ? `✔ ${records.length} registro(s) de muestra · ${fields.length} campos` : 'La consulta funcionó pero no devolvió registros.', records.length ? 'ok' : 'warn');
    } catch (err) {
      this.setStatus(`✖ ${err.message}`, 'error');
    } finally { btn.disabled = false; }
  }

  async #describeTarget(verbose = false) {
    try {
      const { fields } = await this.api.describeTarget(this.cfg);
      this.state.setFields('target', fields);
      if (verbose) this.setStatus(`✔ ${fields.length} campos destino detectados`, 'ok');
    } catch (err) {
      if (verbose) this.setStatus(`✖ ${err.message}`, 'error');
    }
  }

  #renderFields() {
    if (!this.fieldsBox) return;
    clear(this.fieldsBox);
    const fields = this.isSource ? this.cfg.fields : this.state.targetFields();
    if (!fields.length) {
      this.fieldsBox.append(h('p', { class: 'empty' }, this.isSource
        ? 'Aún no hay campos. Importa un .har o pulsa «Probar y traer campos».'
        : 'Aún no hay campos destino. Importa el .har de la petición que crea un proyecto, o pega una plantilla JSON.'));
      return;
    }
    this.fieldsBox.append(
      h('h3', {}, `Campos ${this.isSource ? 'de origen' : 'de destino'} (${fields.length})`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'fields-table' },
        h('thead', {}, h('tr', {}, ['Campo', 'Tipo', 'Ejemplo'].map((t) => h('th', {}, t)))),
        h('tbody', {}, fields.map((f) => h('tr', {},
          h('td', { class: 'mono' }, f.path.replace(/\\\./g, '.')), h('td', {}, h('span', { class: `type t-${f.type}` }, f.type)),
          h('td', { class: 'muted' }, truncate(f.sample, 60))))))),
    );
  }
}
