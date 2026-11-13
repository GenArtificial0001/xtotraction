import { Mapper } from './Mapper.js';
import { SyncJob } from './SyncJob.js';
import { TransformRegistry } from './transforms.js';
import { SecretMasker } from '../storage/SecretMasker.js';

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; this.status = 400; }
}

/**
 * Fachada de aplicación: valida configuraciones, instancia conectores y ejecuta previsualizaciones y jobs.
 * Es lo único que conoce a la vez el registro, el repositorio y las transformaciones.
 */
export class SyncService {
  constructor({ registry, repository, transforms = TransformRegistry.withDefaults(), deps = {} }) {
    this.registry = registry;
    this.repository = repository;
    this.transforms = transforms;
    this.deps = deps; // dependencias inyectables a los conectores (p. ej. HttpClient)
  }

  meta() {
    return {
      sources: this.registry.descriptors('source'),
      targets: this.registry.descriptors('target'),
      transforms: this.transforms.list(),
    };
  }

  /** Reemplaza valores enmascarados por los guardados (si la config ya existe). */
  async resolve(config) {
    if (!config || typeof config !== 'object') throw new ValidationError('Configuración ausente');
    const stored = config.id ? await this.repository.get(config.id).catch(() => null) : null;
    return SecretMasker.restore(config, stored);
  }

  #build(role, cfg) {
    try { return this.registry.create(role, cfg, this.deps); }
    catch (err) { throw new ValidationError(`${role === 'source' ? 'Origen' : 'Destino'}: ${err.message}`); }
  }

  async preview(rawConfig, { limit = 5, signal } = {}) {
    const source = this.#build('source', (await this.resolve(rawConfig)).source);
    const { records, fields } = await source.discoverFields(Math.min(Math.max(limit, 1), 25), { signal });
    return { fields, records };
  }

  async describeTarget(config) {
    const target = this.#build('target', config);
    return { fields: target.describeFields() };
  }

  async buildJob(rawConfig, options = {}) {
    const config = await this.resolve(rawConfig);
    const source = this.#build('source', config.source);
    const target = this.#build('target', config.target);
    if (!Array.isArray(config.mappings) || !config.mappings.length) throw new ValidationError('No hay ningún mapeo definido');
    let mapper;
    try { mapper = new Mapper(config.mappings, this.transforms); }
    catch (err) { throw new ValidationError(`Mapeo: ${err.message}`); }
    const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : Infinity;
    return new SyncJob({
      source, target, mapper,
      options: {
        dryRun: options.dryRun !== false, limit,
        delayMs: Math.max(0, Number(config.options?.delayMs) || 0),
        stopOnError: Boolean(config.options?.stopOnError),
      },
    });
  }
}
