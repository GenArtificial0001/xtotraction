/** Estado único de la aplicación. Los componentes escuchan eventos «change» con un topic. */
export class AppState extends EventTarget {
  constructor(meta) {
    super();
    this.meta = meta;
    this.config = AppState.blank(meta);
    this.dirty = false;
  }

  static blank(meta) {
    return {
      name: 'Nueva sincronización',
      source: { type: meta.sources[0].type, fields: [] },
      target: { type: meta.targets[0].type, fields: [], customFields: [] },
      mappings: [],
      options: { delayMs: 0, stopOnError: false },
    };
  }

  emit(topic, { dirty = true } = {}) {
    if (dirty) this.dirty = true;
    this.dispatchEvent(new CustomEvent('change', { detail: { topic } }));
  }

  on(topics, fn) {
    const list = Array.isArray(topics) ? topics : [topics];
    this.addEventListener('change', (e) => { if (list.includes(e.detail.topic) || e.detail.topic === 'all') fn(e.detail.topic); });
  }

  load(config) {
    this.config = { options: { delayMs: 0, stopOnError: false }, mappings: [], ...config };
    this.config.target.customFields ||= [];
    this.config.source.fields ||= [];
    this.config.source.fields ||= [];
    this.config.target.fields ||= [];
    this.dirty = false;
    this.emit('all', { dirty: false });
  }

  reset() { this.load(AppState.blank(this.meta)); }

  descriptor(role) {
    const list = role === 'source' ? this.meta.sources : this.meta.targets;
    return list.find((d) => d.type === this.config[role].type) || list[0];
  }

  setName(name) { this.config.name = name; this.dirty = true; }

  /** Cambia un ajuste del conector sin redibujar (para no perder el foco al escribir). */
  setSetting(role, key, value) {
    this.config[role][key] = value;
    this.dirty = true;
  }

  setType(role, type) {
    const prev = this.config[role];
    // Se conserva lo reutilizable (cabeceras, nombre del destino); lo demás depende del tipo de conector.
    this.config[role] = { type, fields: [], headers: prev.headers || {}, ...(role === 'target' ? { name: prev.name, customFields: prev.customFields || [] } : {}) };
    this.emit(role);
    this.emit('fields');
  }

  /** Aplica un borrador generado desde un HAR (config + campos). */
  applyDraft(role, draft) {
    Object.assign(this.config[role], draft.config, { fields: draft.fields });
    this.emit(role);
    this.emit('fields');
  }

  setFields(role, fields, { prune = false } = {}) {
    this.config[role].fields = fields;
    if (prune && role === 'source') {
      const known = new Set(fields.map((f) => f.path));
      this.config.mappings = this.config.mappings.filter((m) => !m.source || known.has(m.source));
    }
    this.emit('fields');
    if (prune) this.emit('mappings');
  }

  /** Etiqueta legible de un campo de origen (p. ej. el nombre de la columna en SharePoint). */
  sourceLabel(path) {
    return this.config.source.fields.find((f) => f.path === path)?.label || null;
  }

  targetName() { return (this.config.target.name || '').trim() || 'el destino'; }

  /** Campos destino = los de la plantilla + los añadidos a mano. */
  targetFields() {
    const known = new Set(this.config.target.fields.map((f) => f.path));
    const custom = (this.config.target.customFields || []).filter((p) => !known.has(p)).map((p) => ({ path: p, type: 'manual', sample: null, custom: true }));
    return [...this.config.target.fields, ...custom];
  }

  addCustomTargetField(path) {
    const p = path.trim();
    if (!p || this.targetFields().some((f) => f.path === p)) return false;
    this.config.target.customFields.push(p);
    this.emit('fields');
    return true;
  }

  mappingFor(targetPath) { return this.config.mappings.find((m) => m.target === targetPath); }

  mapField(sourcePath, targetPath) {
    const m = this.mappingFor(targetPath);
    if (m) { m.source = sourcePath; delete m.constant; }
    else this.config.mappings.push({ source: sourcePath, target: targetPath, transform: 'none' });
    this.emit('mappings');
  }

  setConstant(targetPath, value) {
    const m = this.mappingFor(targetPath);
    if (value === '') { if (m && !m.source) this.unmap(targetPath); return; }
    if (m) { if (!m.source) m.constant = value; else return; }
    else this.config.mappings.push({ source: null, constant: value, target: targetPath, transform: 'none' });
    this.dirty = true;
    this.emit('mappings-quiet');
  }

  setTransform(targetPath, transform) {
    const m = this.mappingFor(targetPath);
    if (m) { m.transform = transform; this.dirty = true; }
  }

  unmap(targetPath) {
    this.config.mappings = this.config.mappings.filter((m) => m.target !== targetPath);
    this.emit('mappings');
  }

  clearMappings() {
    this.config.mappings = [];
    this.emit('mappings');
  }

  /**
   * Empareja campos por nombre sin distinguir mayúsculas/acentos y con sinónimos comunes (Title≈name, Estado≈status…).
   * Respeta la jerarquía: «Responsable.Title» se empareja con «owner.name», pero no con un «name» de primer nivel.
   */
  autoMap() {
    const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const groups = [['title', 'titulo', 'name', 'nombre'], ['description', 'descripcion', 'desc'], ['status', 'estado'],
      ['startdate', 'fechainicio', 'start'], ['enddate', 'fechafin', 'end'], ['email', 'correo', 'mail'],
      ['owner', 'responsable', 'manager'], ['budget', 'presupuesto']];
    const canon = (s) => { const n = norm(s); return (groups.find((g) => g.includes(n)) || [n])[0]; };
    const key = (path) => {
      const segs = path.split('.');
      return `${segs.slice(0, -1).map(canon).join('.')}/${canon(segs.at(-1))}`;
    };
    let added = 0;
    for (const t of this.targetFields()) {
      if (this.mappingFor(t.path)) continue;
      const match = this.config.source.fields.find((s) => key(s.path) === key(t.path));
      if (match) { this.config.mappings.push({ source: match.path, target: t.path, transform: 'none' }); added++; }
    }
    this.emit('mappings');
    return added;
  }

  isStepComplete(step) {
    const c = this.config;
    if (step === 'source') return c.source.fields.length > 0;
    if (step === 'target') return this.targetFields().length > 0;
    if (step === 'mapping') return c.mappings.length > 0;
    return false;
  }
}
