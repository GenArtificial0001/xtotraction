/**
 * Contrato de un DESTINO. Recibe un mapa {rutaDestino: valor} por registro y lo envía.
 */
export class TargetConnector {
  static get descriptor() {
    throw new Error('Los conectores deben definir static get descriptor()');
  }

  constructor(config = {}) {
    this.config = config;
  }

  validate() {}

  /** Campos destino conocidos (p. ej. deducidos de una plantilla). */
  describeFields() { return []; }

  /** Construye la petición que se enviaría, sin ejecutarla. */
  buildRequest(/* values */) {
    throw new Error(`${this.constructor.name} debe implementar buildRequest()`);
  }

  /** Envía un registro. Devuelve {ok, status, request, response?, error?}. */
  async send(/* values, { dryRun, signal } */) {
    throw new Error(`${this.constructor.name} debe implementar send()`);
  }
}
