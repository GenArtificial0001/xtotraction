import { h, clear, truncate } from './dom.js';

/** Hoja inferior (en celular) / diálogo (en escritorio) para elegir un campo de origen sin arrastrar. */
export class FieldPicker {
  constructor() {
    this.dialog = h('dialog', { class: 'picker', 'aria-labelledby': 'picker-title' });
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    document.body.append(this.dialog);
  }

  open({ targetPath, fields, current, onPick }) {
    clear(this.dialog);
    const list = h('div', { class: 'picker-list', role: 'listbox' });
    const draw = (q = '') => {
      clear(list);
      const items = fields.filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase()));
      items.forEach((f) => list.append(h('button', {
        type: 'button', role: 'option', class: `picker-item ${f.path === current ? 'current' : ''}`, 'aria-selected': f.path === current ? 'true' : 'false',
        onclick: () => { this.dialog.close(); onPick(f.path); },
      }, h('span', { class: 'picker-main' }, h('span', { class: 'mono' }, f.path.replace(/\\\./g, '.')), h('span', { class: 'chip-sample' }, truncate(f.sample, 50))),
      h('span', { class: `type t-${f.type}` }, f.type))));
      if (!items.length) list.append(h('p', { class: 'muted center' }, 'Ningún campo coincide.'));
    };
    draw();
    this.dialog.append(h('div', { class: 'picker-box' },
      h('div', { class: 'picker-head' },
        h('div', {}, h('h2', { id: 'picker-title' }, 'Elige el campo de origen'), h('p', { class: 'muted small' }, 'Para ', h('span', { class: 'mono' }, targetPath.replace(/\\\./g, '.')))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => this.dialog.close() }, '✕')),
      h('input', { type: 'search', placeholder: 'Buscar campo…', 'aria-label': 'Buscar campo de origen', oninput: (e) => draw(e.target.value) }),
      list));
    this.dialog.showModal();
  }
}
