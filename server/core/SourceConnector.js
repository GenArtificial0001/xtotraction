import { SchemaInferer } from '../../shared/SchemaInferer.js';

/**
 * Contrato de un ORIGEN de datos. Para soportar un origen nuevo (otra API, una base de datos,
 * un CSV…) basta con extender esta clase, implementar fetchRecords() y registrarla en el
 * ConnectorRegistry.
 */
export class SourceConnector {
  /** Metadatos para registrar el conector y generar su formulario en la interfaz. */
  static get descriptor() {
    throw new Error('Los conectores deben definir static get descriptor()');
  }

  constructor(config = {}) {
    this.config = config;
  }

  /** Lanza un Error si la configuración es inválida. */
  validate() {}

  /** Genera los registros del origen (objetos planos o anidados). */
  // eslint-disable-next-line require-yield
  async *fetchRecords(/* { limit, signal } */) {
    throw new Error(`${this.constructor.name} debe implementar fetchRecords()`);
  }

  /** Rutas de campo que no interesan al usuario (metadatos internos, etc.). */
  isNoiseField() { return false; }

  async sample(n = 5, opts = {}) {
    const out = [];
    for await (const rec of this.fetchRecords({ ...opts, limit: n })) {
      out.push(rec);
      if (out.length >= n) break;
    }
    return out;
  }

  async discoverFields(n = 5, opts = {}) {
    const records = await this.sample(n, opts);
    const inferer = new SchemaInferer();
    return { records, fields: inferer.inferFromRecords(records, { exclude: (p) => this.isNoiseField(p) }) };
  }
}
