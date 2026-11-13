import { ObjectPath } from '../../shared/ObjectPath.js';
import { TransformRegistry } from './transforms.js';

/** Una regla: campo de origen (o valor fijo) → campo de destino, con transformación opcional. */
export class MappingRule {
  constructor({ source = null, target, transform = null, constant = undefined }) {
    if (!target) throw new Error('Cada regla necesita un campo destino');
    if (!source && constant === undefined) throw new Error(`El destino «${target}» no tiene origen ni valor fijo`);
    this.source = source || null;
    this.target = target;
    this.transform = transform || 'none';
    this.constant = constant;
  }
  get isConstant() { return !this.source; }
}

/** Convierte un registro del origen en {rutaDestino: valor} aplicando las reglas. */
export class Mapper {
  constructor(rules, transforms = TransformRegistry.withDefaults()) {
    this.rules = rules.map((r) => (r instanceof MappingRule ? r : new MappingRule(r)));
    this.transforms = transforms;
    for (const r of this.rules) this.transforms.get(r.transform); // falla pronto si no existe
  }

  map(record) {
    const values = {};
    const warnings = [];
    for (const rule of this.rules) {
      let value;
      if (rule.isConstant) {
        value = rule.constant;
      } else {
        value = ObjectPath.get(record, rule.source);
        if (value === undefined) { warnings.push(`El origen «${rule.source}» no existe en este registro`); continue; }
      }
      values[rule.target] = this.transforms.get(rule.transform).apply(value);
    }
    return { values, warnings };
  }
}
