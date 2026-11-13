import { h, clear, icon } from './dom.js';
import { ApiClient } from './ApiClient.js';
import { AppState } from './AppState.js';
import { HarModal } from './HarModal.js';
import { ConnectorPanel } from './ConnectorPanel.js';
import { MappingBoard } from './MappingBoard.js';
import { RunPanel } from './RunPanel.js';

/** Raíz de la aplicación: barra superior (guardar/cargar), pasos y paneles. */
class App {
  constructor(api, meta) {
    this.api = api;
    this.state = new AppState(meta);
    this.harModal = new HarModal();
    this.toastBox = document.getElementById('toasts');
    const toast = (m, k) => this.toast(m, k);
    this.panels = {
      source: new ConnectorPanel({ role: 'source', state: this.state, api, harModal: this.harModal, toast }),
      target: new ConnectorPanel({ role: 'target', state: this.state, api, harModal: this.harModal, toast }),
      mapping: new MappingBoard({ state: this.state, toast }),
      run: new RunPanel({ state: this.state, api, toast }),
    };
    this.step = 'source';
    this.#mount();
    this.state.on(['fields', 'mappings', 'mappings-quiet', 'all'], () => this.#renderSteps());
    this.state.on(['all'], () => { this.nameInput.value = this.state.config.name; this.#refreshConfigs(); });
    this.state.emit('all', { dirty: false });
    window.addEventListener('beforeunload', (e) => { if (this.state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  toast(message, kind = 'info') {
    const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
    this.toastBox.append(el);
    setTimeout(() => el.remove(), 4000);
  }

  #mount() {
    this.nameInput = document.getElementById('cfg-name');
    this.nameInput.addEventListener('input', () => this.state.setName(this.nameInput.value));
    this.select = document.getElementById('cfg-select');
    this.select.addEventListener('change', () => this.#loadSelected());
    document.getElementById('btn-new').addEventListener('click', () => this.#confirmDiscard() && (this.state.reset(), this.#goto('source')));
    document.getElementById('btn-save').addEventListener('click', () => this.#save());
    document.getElementById('btn-delete').addEventListener('click', () => this.#delete());
    this.stepsNav = document.getElementById('steps');
    this.main = document.getElementById('main');
    Object.entries(this.panels).forEach(([k, p]) => { p.root.hidden = k !== this.step; this.main.append(p.root); });
    this.#renderSteps();
  }

  #goto(step) {
    this.step = step;
    Object.entries(this.panels).forEach(([k, p]) => { p.root.hidden = k !== step; });
    this.#renderSteps();
  }

  #renderSteps() {
    const defs = [['source', 'Origen'], ['target', 'Destino'], ['mapping', 'Mapeo'], ['run', 'Ejecutar']];
    clear(this.stepsNav);
    defs.forEach(([key, label], i) => this.stepsNav.append(h('button', {
      type: 'button', class: `step ${this.step === key ? 'active' : ''} ${this.state.isStepComplete(key) ? 'done' : ''}`,
      'aria-current': this.step === key ? 'step' : null, onclick: () => this.#goto(key),
    }, h('span', { class: 'step-n' }, this.state.isStepComplete(key) ? icon('check') : String(i + 1)), h('span', { class: 'step-t' }, label))));
  }

  #confirmDiscard() { return !this.state.dirty || window.confirm('Hay cambios sin guardar. ¿Descartarlos?'); }

  async #refreshConfigs() {
    const list = await this.api.listConfigs().catch(() => []);
    clear(this.select);
    this.select.append(h('option', { value: '' }, list.length ? 'Configuraciones guardadas…' : 'Sin configuraciones guardadas'));
    list.forEach((c) => this.select.append(h('option', { value: c.id, selected: c.id === this.state.config.id }, c.name)));
    document.getElementById('btn-delete').disabled = !this.state.config.id;
  }

  async #loadSelected() {
    const id = this.select.value;
    if (!id) return;
    if (!this.#confirmDiscard()) { this.#refreshConfigs(); return; }
    try { this.state.load(await this.api.getConfig(id)); this.toast('Configuración cargada'); }
    catch (err) { this.toast(err.message, 'error'); }
  }

  async #save() {
    try {
      const saved = await this.api.saveConfig(this.state.config);
      this.state.load(saved);
      this.toast('Configuración guardada', 'ok');
    } catch (err) { this.toast(err.message, 'error'); }
  }

  async #delete() {
    const { id, name } = this.state.config;
    if (!id || !window.confirm(`¿Eliminar «${name}»?`)) return;
    try { await this.api.deleteConfig(id); this.state.reset(); this.toast('Configuración eliminada'); }
    catch (err) { this.toast(err.message, 'error'); }
  }
}

const api = new ApiClient();
api.meta().then((meta) => new App(api, meta)).catch((err) => {
  document.getElementById('main').replaceChildren(h('p', { class: 'error' }, `No se pudo contactar con el servidor: ${err.message}`));
});
