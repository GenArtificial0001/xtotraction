import { h, clear, truncate, headersToText, textToHeaders, debounce, icon } from './dom.js';

const TYPE_ICON = { http: 'file', 'sharepoint-graph': 'cloud', 'sharepoint-rest': 'list' };

/**
 * Panel de un conector (origen o destino). El formulario se genera a partir del «descriptor» que declara
 * cada conector en el servidor: un conector nuevo aparece en la interfaz sin tocar el frontend.
 * Admite dos formas de configurar un origen: importando un .har/curl (cualquier web) o, si el conector
 * soporta descubrimiento (SharePoint por sitio), listando sus listas y eligiendo la principal.
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
    this.collections = null;
    this.collectionFilter = '';
    this.describeTarget = debounce(() => this.#describeTarget(), 500);
    state.on([role, 'all'], (topic) => { if (topic === 'all') this.collections = null; this.render(); });
    state.on(['fields'], () => this.#renderFields());
  }

  get cfg() { return this.state.config[this.role]; }
  get isSource() { return this.role === 'source'; }

  // ---------------------------------------------------------------- render
  render() {
    const d = this.state.descriptor(this.role);
    if (this.collectionsType !== this.cfg.type) { this.collections = null; this.collectionsType = this.cfg.type; }
    clear(this.root);
    this.status = h('p', { class: 'status-line', role: 'status', 'aria-live': 'polite' });
    this.fieldsBox = h('div', { class: 'fields-box' });
    this.collectionsBox = h('div', { class: 'collections-box' });

    this.root.append(...[
      h('div', { class: 'panel-head' },
        h('div', {},
          h('h2', { id: `h-${this.role}` }, this.isSource ? 'Origen de los datos' : 'Destino de los datos'),
          h('p', { class: 'muted' }, this.isSource
            ? 'De dónde se leen los registros: cualquier web o API (con un .har o curl) o un sitio de SharePoint.'
            : 'A qué web o API se envía cada registro. Puede ser Traction u otra: cambia cuando quieras.'),
        ),
        d.supportsHar && h('button', { class: 'btn', type: 'button', onclick: () => this.#importHar() }, icon('upload'), 'Importar .har / curl'),
      ),
      this.#renderTypeCards(d),
      d.description && h('p', { class: 'type-desc' }, d.description),
      this.#renderForm(d),
      h('div', { class: 'actions' },
        this.#primaryAction(d),
        this.status,
      ),
      this.collectionsBox,
      this.fieldsBox,
    ].filter(Boolean));
    this.#renderNotes();
    this.#renderCollections();
    this.#renderFields();
  }

  #renderTypeCards(current) {
    const types = this.isSource ? this.state.meta.sources : this.state.meta.targets;
    if (types.length < 2) return null;
    return h('div', { class: 'type-cards', role: 'radiogroup', 'aria-label': this.isSource ? 'Tipo de origen' : 'Tipo de destino' },
      types.map((t) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': t.type === current.type ? 'true' : 'false',
        class: `type-card ${t.type === current.type ? 'is-on' : ''}`, onclick: () => t.type !== current.type && this.state.setType(this.role, t.type),
      }, icon(TYPE_ICON[t.type] || 'file'), h('span', {}, t.label))));
  }

  #primaryAction(d) {
    if (!this.isSource) return h('button', { class: 'btn primary', type: 'button', onclick: () => this.#describeTarget(true) }, icon('search'), 'Analizar plantilla');
    if (d.supportsDiscovery) return h('button', { class: 'btn primary', type: 'button', onclick: (e) => this.#listCollections(e.currentTarget) }, icon('plug'), `Conectar y listar las ${d.collectionLabel || 'colecciones'}s`);
    return h('button', { class: 'btn primary', type: 'button', onclick: (e) => this.#testSource(e.currentTarget) }, icon('plug'), 'Probar y traer campos');
  }

  #isVisible(f) {
    if (!f.showIf) return true;
    return Object.entries(f.showIf).every(([k, v]) => {
      const def = this.state.descriptor(this.role).fields.find((x) => x.name === k)?.default;
      return (this.cfg[k] ?? def) === v;
    });
  }

  #renderForm(d) {
    const visible = d.fields.filter((f) => this.#isVisible(f));
    const normal = visible.filter((f) => !f.advanced);
    const advanced = visible.filter((f) => f.advanced);
    return h('div', {},
      h('div', { class: 'form-grid' }, normal.map((f) => this.#renderField(f, d))),
      advanced.length > 0 && h('details', { class: 'advanced' }, h('summary', {}, 'Opciones avanzadas'),
        h('div', { class: 'form-grid' }, advanced.map((f) => this.#renderField(f, d)))));
  }

  #renderField(f, d) {
    const value = this.cfg[f.name] ?? f.default ?? '';
    const set = (v) => this.state.setSetting(this.role, f.name, v);
    const id = `f-${this.role}-${f.name}`;
    const controls = new Set(d.fields.flatMap((x) => Object.keys(x.showIf || {})));
    let input;
    if (f.type === 'select') {
      input = h('select', { id, onchange: (e) => { set(e.target.value); if (controls.has(f.name)) this.render(); } },
        f.options.map((o) => h('option', { value: o, selected: o === value }, f.optionLabels?.[o] || o)));
      if (this.cfg[f.name] === undefined) this.cfg[f.name] = value;
    } else if (f.type === 'headers') {
      input = h('textarea', { id, rows: 4, spellcheck: false, class: 'mono', value: headersToText(this.cfg.headers),
        placeholder: 'Authorization: Bearer …\nAccept: application/json', oninput: (e) => set(textToHeaders(e.target.value)) });
    } else if (f.type === 'textarea' || f.type === 'json') {
      const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
      const err = h('small', { class: 'error' });
      input = h('div', {}, h('textarea', {
        id, rows: f.type === 'json' ? 9 : 3, spellcheck: false, class: 'mono', value: text,
        oninput: (e) => {
          set(e.target.value);
          if (f.type === 'json') {
            try { if (e.target.value.trim()) JSON.parse(e.target.value); err.textContent = ''; if (!this.isSource) this.describeTarget(); }
            catch { err.textContent = 'JSON no válido'; }
          }
        },
      }), err);
    } else {
      input = h('input', { id, type: f.type === 'password' ? 'password' : 'text', value, placeholder: f.placeholder || '', spellcheck: false,
        autocomplete: f.type === 'password' ? 'new-password' : 'off', oninput: (e) => set(e.target.value) });
      if (f.default !== undefined && this.cfg[f.name] === undefined) this.cfg[f.name] = f.default;
    }
    return h('div', { class: `field ${['headers', 'textarea', 'json'].includes(f.type) ? 'wide' : ''}` },
      h('label', { for: id }, f.label, f.required && h('b', { class: 'req', title: 'obligatorio' }, ' *')),
      input, f.help && h('small', { class: 'muted' }, f.help));
  }

  // ---------------------------------------------------------------- HAR / curl
  #importHar() {
    this.harModal.open(this.role, (draft) => {
      const d = this.state.descriptor(this.role);
      this.notes = [];
      if (d.harImports) {
        // Conectores con descubrimiento: del HAR solo se aprovechan las credenciales y el sitio.
        const patch = {};
        if (d.harImports.includes('headers')) patch.headers = draft.config.headers;
        const site = /^(.*?)\/_api\//.exec(draft.config.url || '');
        if (d.harImports.includes('siteUrl') && site) patch.siteUrl = site[1];
        Object.assign(this.cfg, patch);
        this.state.emit(this.role);
        this.notes.push({ kind: 'ok', text: `Importado: ${Object.keys(patch).join(' y ') || 'nada utilizable'}. Pulsa «Conectar» para listar las listas del sitio.` });
      } else {
        if (!draft.config.url) delete draft.config.url;
        this.state.applyDraft(this.role, draft);
        if (draft.fields.length) this.notes.push({ kind: 'ok', text: `Importado: ${draft.fields.length} campo(s) detectado(s). Revisa las cabeceras y credenciales.` });
        draft.warnings.forEach((w) => this.notes.push({ kind: 'warn', text: w }));
      }
      this.#renderNotes();
    });
  }

  #renderNotes() {
    this.root.querySelector('.notes')?.remove();
    if (!this.notes.length) return;
    this.root.querySelector('.actions').before(h('div', { class: 'notes' }, this.notes.map((n) => h('p', { class: `note ${n.kind}` }, n.text))));
  }

  setStatus(text, kind = '') {
    this.status.textContent = text;
    this.status.className = `status-line ${kind}`;
  }

  // ---------------------------------------------------------------- origen genérico
  async #testSource(btn) {
    btn.disabled = true;
    this.setStatus('Conectando…', 'busy');
    try {
      const { fields, records } = await this.api.previewSource(this.state.config.id, this.cfg, 5);
      this.state.setFields('source', fields);
      this.notes = [];
      this.#renderNotes();
      this.setStatus(records.length ? `${records.length} registro(s) de muestra · ${fields.length} campos` : 'La consulta funcionó pero no devolvió registros.', records.length ? 'ok' : 'warn');
    } catch (err) {
      this.setStatus(err.message, 'error');
    } finally { btn.disabled = false; }
  }

  // ---------------------------------------------------------------- origen con descubrimiento
  async #listCollections(btn) {
    btn.disabled = true;
    this.setStatus('Conectando con el sitio…', 'busy');
    try {
      const { collections } = await this.api.collections(this.state.config.id, this.cfg);
      this.collections = collections;
      this.collectionFilter = '';
      this.notes = [];
      this.#renderNotes();
      this.#renderCollections();
      const label = this.state.descriptor('source').collectionLabel || 'colección';
      this.setStatus(`${collections.length} ${label}s encontradas. Elige la ${label} principal.`, 'ok');
    } catch (err) {
      this.setStatus(err.message, 'error');
    } finally { btn.disabled = false; }
  }

  async #chooseCollection(c) {
    const prev = { id: this.cfg.collectionId, title: this.cfg.collectionTitle };
    this.cfg.collectionId = c.id;
    this.cfg.collectionTitle = c.title;
    this.state.dirty = true;
    this.#renderCollections();
    this.setStatus(`Cargando todas las columnas de «${c.title}»…`, 'busy');
    try {
      const { fields, records } = await this.api.schema(this.state.config.id, this.cfg, 5);
      this.state.setFields('source', fields, { prune: true });
      this.setStatus(`Lista principal: ${c.title} · ${fields.length} columnas listas para mapear · ${records.length} registro(s) de muestra`, 'ok');
    } catch (err) {
      this.cfg.collectionId = prev.id;
      this.cfg.collectionTitle = prev.title;
      this.#renderCollections();
      this.setStatus(err.message, 'error');
    }
  }

  #renderCollections() {
    if (!this.collectionsBox) return;
    clear(this.collectionsBox);
    const d = this.state.descriptor(this.role);
    if (!this.isSource || !d.supportsDiscovery) return;
    const label = d.collectionLabel || 'colección';
    const chosen = this.cfg.collectionId;

    if (!this.collections) {
      if (chosen) {
        this.collectionsBox.append(h('div', { class: 'principal' },
          h('span', { class: 'pill ok' }, icon('check'), `${label} principal`), h('strong', {}, this.cfg.collectionTitle || chosen),
          h('span', { class: 'muted' }, `${this.cfg.fields.length} columnas`),
          h('button', { class: 'btn small', type: 'button', onclick: (e) => this.#listCollections(e.currentTarget) }, `Cambiar de ${label}`)));
      }
      return;
    }
    const q = this.collectionFilter.toLowerCase();
    const items = this.collections.filter((c) => !q || c.title.toLowerCase().includes(q));
    this.collectionsBox.append(...[
      h('div', { class: 'collections-head' },
        h('h3', {}, `Listas del sitio (${this.collections.length})`),
        this.collections.length > 8 && h('input', { type: 'search', placeholder: 'Buscar…', 'aria-label': 'Buscar lista', value: this.collectionFilter,
          oninput: (e) => { this.collectionFilter = e.target.value; this.#renderCollections(); const i = this.collectionsBox.querySelector('input'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); } })),
      h('div', { class: 'collections', role: 'radiogroup', 'aria-label': `Elige la ${label} principal` },
        items.map((c) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': c.id === chosen ? 'true' : 'false', class: `coll ${c.id === chosen ? 'is-on' : ''}`,
          onclick: () => this.#chooseCollection(c),
        },
        h('span', { class: 'coll-top' }, h('strong', {}, c.title), c.id === chosen && h('span', { class: 'pill ok' }, icon('check'), 'Principal')),
        h('span', { class: 'coll-meta' }, h('span', { class: 'pill' }, c.kind), c.count != null && h('span', { class: 'muted' }, `${c.count} elementos`)),
        c.description && h('span', { class: 'coll-desc muted' }, truncate(c.description, 70))))),
      !items.length && h('p', { class: 'muted' }, 'Ninguna lista coincide.')].filter(Boolean));
  }

  // ---------------------------------------------------------------- destino
  async #describeTarget(verbose = false) {
    try {
      const { fields } = await this.api.describeTarget(this.cfg);
      this.state.setFields('target', fields);
      if (verbose) this.setStatus(`${fields.length} campos destino detectados`, 'ok');
    } catch (err) {
      if (verbose) this.setStatus(err.message, 'error');
    }
  }

  // ---------------------------------------------------------------- campos
  #renderFields() {
    if (!this.fieldsBox) return;
    clear(this.fieldsBox);
    const fields = this.isSource ? this.cfg.fields : this.state.targetFields();
    if (!fields.length) {
      this.fieldsBox.append(h('p', { class: 'empty' }, this.isSource
        ? (this.state.descriptor('source').supportsDiscovery ? 'Conecta con el sitio, elige la lista principal y aquí aparecerán todas sus columnas.' : 'Aún no hay campos. Importa un .har o curl, o pulsa «Probar y traer campos».')
        : 'Aún no hay campos destino. Importa el .har o curl de la petición que crea un registro, o pega una plantilla JSON.'));
      return;
    }
    const hasLabels = fields.some((f) => f.label);
    this.fieldsBox.append(
      h('h3', {}, `${this.isSource ? 'Campos de origen' : 'Campos de destino'} (${fields.length})`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'fields-table' },
        h('thead', {}, h('tr', {}, [hasLabels && 'Columna', 'Campo', 'Tipo', 'Ejemplo'].filter(Boolean).map((t) => h('th', {}, t)))),
        h('tbody', {}, fields.map((f) => h('tr', {},
          hasLabels && h('td', {}, f.label || ''),
          h('td', { class: 'mono' }, f.path.replace(/\\\./g, '.')), h('td', {}, h('span', { class: `type t-${f.type}` }, f.type)),
          h('td', { class: 'muted' }, truncate(f.sample, 60))))))),
    );
  }
}
