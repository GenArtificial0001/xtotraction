import { h, clear, truncate } from './dom.js';
import { FieldPicker } from './FieldPicker.js';

const display = (path) => path.replace(/\\\./g, '.');

/**
 * Tablero de mapeo: campos de origen (izquierda, arrastrables) → casilleros de destino (derecha).
 * Arrastra un campo hasta un casillero. Alternativa accesible: pulsa un campo y luego el casillero.
 */
export class MappingBoard {
  constructor({ state, toast }) {
    this.state = state;
    this.toast = toast;
    this.selected = null;
    this.search = '';
    this.picker = new FieldPicker();
    this.root = h('section', { class: 'panel', id: 'panel-mapping', 'aria-labelledby': 'h-mapping' });
    state.on(['mappings', 'fields', 'all'], () => this.render());
    state.on(['mappings-quiet'], () => this.#renderCounter());
  }

  render() {
    const s = this.state;
    clear(this.root);
    this.counter = h('span', { class: 'counter' });
    this.root.append(
      h('div', { class: 'panel-head' },
        h('div', {},
          h('h2', { id: 'h-mapping' }, '3 · Une origen y destino'),
          h('p', { class: 'muted' }, 'Arrastra un campo de origen hasta el casillero del campo destino, o toca «Elegir campo» en el casillero (ideal en celular).'),
        ),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => { const n = s.autoMap(); this.toast(n ? `${n} campo(s) emparejados por nombre` : 'No se encontraron coincidencias por nombre'); } }, '✨ Auto-mapear'),
          h('button', { class: 'btn', type: 'button', onclick: () => s.clearMappings() }, 'Limpiar'),
        ),
      ),
    );
    if (!s.config.source.fields.length || !s.targetFields().length) {
      this.root.append(h('p', { class: 'empty' }, `Falta cargar los campos de ${!s.config.source.fields.length ? 'origen' : 'destino'} (pasos 1 y 2).`));
      return;
    }
    this.root.append(h('div', { class: 'board' }, this.#renderSources(), this.#renderTargets()));
    this.#renderCounter();
  }

  #renderCounter() {
    if (!this.counter) return;
    const total = this.state.targetFields().length;
    this.counter.textContent = `${this.state.config.mappings.length} de ${total} campos destino con valor`;
  }

  #renderSources() {
    const s = this.state;
    const mapped = new Set(s.config.mappings.map((m) => m.source).filter(Boolean));
    const list = h('div', { class: 'chip-list', role: 'list' });
    const draw = () => {
      clear(list);
      const q = this.search.toLowerCase();
      s.config.source.fields.filter((f) => !q || f.path.toLowerCase().includes(q)).forEach((f) => {
        const chip = h('button', {
          type: 'button', class: `chip ${mapped.has(f.path) ? 'is-mapped' : ''} ${this.selected === f.path ? 'is-selected' : ''}`,
          draggable: true, role: 'listitem', title: 'Arrastra al destino', 'aria-pressed': this.selected === f.path ? 'true' : 'false',
          ondragstart: (e) => { e.dataTransfer.setData('text/plain', f.path); e.dataTransfer.setData('application/x-source-field', f.path); e.dataTransfer.effectAllowed = 'copy'; chip.classList.add('dragging'); },
          ondragend: () => chip.classList.remove('dragging'),
          onclick: () => { this.selected = this.selected === f.path ? null : f.path; draw(); this.#markTargets(); },
        },
        h('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'),
        h('span', { class: 'chip-main' }, h('span', { class: 'chip-name mono' }, display(f.path)), h('span', { class: 'chip-sample' }, truncate(f.sample, 36))),
        h('span', { class: `type t-${f.type}` }, f.type));
        list.append(chip);
      });
      if (!list.children.length) list.append(h('p', { class: 'muted' }, 'Sin resultados'));
    };
    draw();
    return h('div', { class: 'col' },
      h('h3', {}, 'Campos de origen'),
      h('input', { type: 'search', placeholder: 'Buscar campo…', 'aria-label': 'Buscar campo de origen', oninput: (e) => { this.search = e.target.value; draw(); } }),
      list);
  }

  #markTargets() {
    this.root.querySelectorAll('.slot').forEach((el) => el.classList.toggle('armed', Boolean(this.selected)));
  }

  #renderTargets() {
    const s = this.state;
    const addInput = h('input', { type: 'text', placeholder: 'p. ej. owner.name', 'aria-label': 'Nuevo campo destino', class: 'mono',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
    const add = () => { if (s.addCustomTargetField(addInput.value)) addInput.value = ''; };
    return h('div', { class: 'col' },
      h('h3', {}, 'Campos de destino ', this.counter),
      h('div', { class: 'slot-list' }, s.targetFields().map((t) => this.#renderSlot(t))),
      h('div', { class: 'add-field' }, addInput, h('button', { class: 'btn small', type: 'button', onclick: add }, '＋ Añadir campo destino')));
  }

  #renderSlot(t) {
    const s = this.state;
    const m = s.mappingFor(t.path);
    const assign = (src) => { this.selected = null; s.mapField(src, t.path); };
    const slot = h('div', {
      class: `slot ${m ? 'filled' : ''} ${this.selected ? 'armed' : ''}`, dataset: { target: t.path },
      ondragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; slot.classList.add('over'); },
      ondragleave: (e) => { if (!slot.contains(e.relatedTarget)) slot.classList.remove('over'); },
      ondrop: (e) => {
        e.preventDefault(); slot.classList.remove('over');
        const src = e.dataTransfer.getData('application/x-source-field') || e.dataTransfer.getData('text/plain');
        if (src && s.config.source.fields.some((f) => f.path === src)) assign(src);
      },
      onclick: (e) => { if (this.selected && !e.target.closest('select,input,button')) assign(this.selected); },
    });

    const label = h('div', { class: 'slot-label' },
      h('span', { class: 'mono slot-name' }, display(t.path)),
      h('span', { class: `type t-${t.type}` }, t.type),
      t.custom && h('button', { class: 'icon-btn tiny', type: 'button', title: 'Quitar campo manual', 'aria-label': `Quitar ${t.path}`,
        onclick: (e) => { e.stopPropagation(); s.config.target.customFields = s.config.target.customFields.filter((p) => p !== t.path); s.unmap(t.path); s.emit('fields'); } }, '✕'));

    const pick = () => this.picker.open({ targetPath: t.path, fields: s.config.source.fields, current: m?.source, onPick: (src) => assign(src) });
    let drop;
    if (m && m.source) {
      const sf = s.config.source.fields.find((f) => f.path === m.source);
      drop = h('div', { class: 'drop has-value' },
        h('button', { type: 'button', class: 'chip static', title: 'Cambiar campo de origen', 'aria-label': `Cambiar el origen de ${t.path} (ahora ${m.source})`, onclick: pick },
          h('span', { class: 'chip-name mono' }, display(m.source)), sf && h('span', { class: 'chip-sample' }, truncate(sf.sample, 28))),
        h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
        h('select', { 'aria-label': `Transformación para ${t.path}`, onchange: (e) => s.setTransform(t.path, e.target.value) },
          s.meta.transforms.map((tr) => h('option', { value: tr.id, selected: tr.id === (m.transform || 'none') }, tr.label))),
        h('button', { class: 'icon-btn unmap', type: 'button', title: 'Quitar vínculo', 'aria-label': `Quitar vínculo de ${t.path}`, onclick: () => s.unmap(t.path) }, '✕'));
    } else {
      drop = h('div', { class: 'drop' },
        h('button', { type: 'button', class: 'btn small pick-btn', onclick: pick }, 'Elegir campo ▾'),
        h('span', { class: 'placeholder' }, 'o suelta aquí un campo'),
        h('input', { type: 'text', class: 'constant', placeholder: 'o escribe un valor fijo', value: m?.constant ?? '', 'aria-label': `Valor fijo para ${t.path}`,
          oninput: (e) => s.setConstant(t.path, e.target.value) }));
    }
    slot.append(label, drop);
    return slot;
  }
}
