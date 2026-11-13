import { h, clear, truncate } from './dom.js';
import { HarParser } from '/shared/HarParser.js';

/**
 * Diálogo de importación de .har. El archivo se interpreta en el navegador
 * (no se sube entero al servidor: puede contener cookies y tokens).
 */
export class HarModal {
  constructor() {
    this.doc = null;
    this.role = 'source';
    this.onPick = null;
    this.dialog = h('dialog', { class: 'har-modal', 'aria-labelledby': 'har-title' });
    document.body.append(this.dialog);
  }

  open(role, onPick) {
    this.role = role;
    this.onPick = onPick;
    this.doc = null;
    this.render();
    this.dialog.showModal();
  }

  close() { this.dialog.close(); }

  async #loadFile(file) {
    try {
      this.doc = HarParser.parse(await file.text());
      this.error = null;
      this.fileName = file.name;
    } catch (err) {
      this.doc = null;
      this.error = err.message;
    }
    this.render();
  }

  render() {
    const isTarget = this.role === 'target';
    clear(this.dialog);
    const fileInput = h('input', { type: 'file', accept: '.har,application/json', id: 'har-file', onchange: (e) => e.target.files[0] && this.#loadFile(e.target.files[0]) });
    const drop = h('label', { class: 'har-drop', for: 'har-file',
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) this.#loadFile(e.dataTransfer.files[0]); },
    }, h('strong', {}, this.doc ? `📄 ${this.fileName}` : 'Elige o arrastra un archivo .har'),
    h('span', { class: 'muted' }, this.doc ? `${this.doc.entries.length} peticiones — elige otro archivo para reemplazarlo` : 'Exporta desde DevTools → Red → «Guardar todo como HAR con contenido»'));

    const header = h('header', {},
      h('h2', { id: 'har-title' }, isTarget ? 'Importar HAR del destino (Traction)' : 'Importar HAR del origen'),
      h('p', { class: 'muted' }, isTarget
        ? 'Elige la petición que CREA un registro (POST/PUT). Su cuerpo se usa como plantilla y sus campos serán los campos destino.'
        : 'Elige la petición que DEVUELVE la lista de registros. Su URL, cabeceras y los campos de la respuesta se cargan automáticamente.'),
      h('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Cerrar', onclick: () => this.close() }, '✕'),
    );

    const body = h('div', { class: 'har-body' }, drop, this.error && h('p', { class: 'error' }, this.error));
    if (this.doc) body.append(this.#renderList());
    this.dialog.append(h('form', { method: 'dialog' }, header, fileInput, body));
    this.dialog.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
  }

  #renderList() {
    const isTarget = this.role === 'target';
    const state = { text: '', onlyJson: !isTarget, onlyBody: isTarget };
    const tbody = h('tbody');
    const count = h('span', { class: 'muted' });
    const refresh = () => {
      clear(tbody);
      const rows = this.doc.filter({ text: state.text, onlyJson: state.onlyJson, onlyWithRequestBody: state.onlyBody });
      count.textContent = `${rows.length} de ${this.doc.entries.length}`;
      rows.slice(0, 200).forEach((e) => tbody.append(h('tr', {},
        h('td', {}, h('span', { class: `method m-${e.method}` }, e.method)),
        h('td', {}, h('span', { class: `status ${e.status >= 400 ? 'bad' : ''}` }, e.status || '—')),
        h('td', { class: 'url', title: e.url }, truncate(e.url, 90)),
        h('td', { class: 'muted' }, e.mimeType || '—'),
        h('td', {}, h('button', { class: 'btn small primary', type: 'button', onclick: () => this.#pick(e) }, 'Usar')),
      )));
      if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: 5, class: 'muted center' }, 'Ninguna petición coincide con el filtro.')));
    };
    const filters = h('div', { class: 'har-filters' },
      h('input', { type: 'search', placeholder: 'Filtrar por URL o método (p. ej. _api, projects)…', 'aria-label': 'Filtrar peticiones', oninput: (e) => { state.text = e.target.value; refresh(); } }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.onlyJson, onchange: (e) => { state.onlyJson = e.target.checked; refresh(); } }), 'Solo respuestas JSON'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.onlyBody, onchange: (e) => { state.onlyBody = e.target.checked; refresh(); } }), 'Solo con cuerpo en la petición'),
      count,
    );
    refresh();
    return h('div', {}, filters, h('div', { class: 'har-table-wrap' }, h('table', { class: 'har-table' },
      h('thead', {}, h('tr', {}, ['Método', 'Estado', 'URL', 'Tipo', ''].map((t) => h('th', {}, t)))), tbody)));
  }

  #pick(entry) {
    const draft = this.role === 'target' ? entry.toTargetDraft() : entry.toSourceDraft();
    this.close();
    this.onPick?.(draft, entry);
  }
}
