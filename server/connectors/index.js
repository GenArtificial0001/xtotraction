import { ConnectorRegistry } from '../core/ConnectorRegistry.js';
import { HttpSource } from './HttpSource.js';
import { SharePointListSource } from './SharePointListSource.js';
import { HttpTarget } from './HttpTarget.js';

/**
 * Punto único donde se registran los conectores. Para añadir un origen/destino nuevo:
 * crea la clase (extiende SourceConnector / TargetConnector) y añádela aquí.
 */
export function createDefaultRegistry() {
  return new ConnectorRegistry()
    .register(HttpSource)
    .register(SharePointListSource)
    .register(HttpTarget);
}
