/** Catálogo de conectores disponibles, indexados por rol (source|target) y tipo. */
export class ConnectorRegistry {
  #classes = { source: new Map(), target: new Map() };

  register(ConnectorClass) {
    const { type, role } = ConnectorClass.descriptor;
    if (!this.#classes[role]) throw new Error(`Rol de conector desconocido: ${role}`);
    this.#classes[role].set(type, ConnectorClass);
    return this;
  }

  has(role, type) { return Boolean(this.#classes[role]?.has(type)); }

  create(role, config, deps = {}) {
    const Cls = this.#classes[role]?.get(config?.type);
    if (!Cls) throw new Error(`Tipo de ${role === 'source' ? 'origen' : 'destino'} desconocido: ${config?.type}`);
    const instance = new Cls(config, deps);
    instance.validate();
    return instance;
  }

  descriptors(role) {
    return [...this.#classes[role].values()].map((c) => c.descriptor);
  }
}
