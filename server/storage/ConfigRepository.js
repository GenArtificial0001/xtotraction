import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Contrato de persistencia de configuraciones. Cambia la implementación (BD, nube…) sin tocar el resto. */
export class ConfigRepository {
  async list() { throw new Error('not implemented'); }
  async get(/* id */) { throw new Error('not implemented'); }
  async save(/* config */) { throw new Error('not implemented'); }
  async delete(/* id */) { throw new Error('not implemented'); }
}

/** Guarda cada configuración como un JSON en un directorio. */
export class FileConfigRepository extends ConfigRepository {
  constructor(dir) {
    super();
    this.dir = dir;
  }

  static isValidId(id) { return typeof id === 'string' && ID_RE.test(id); }

  #file(id) {
    if (!FileConfigRepository.isValidId(id)) {
      throw Object.assign(new Error('Identificador inválido'), { status: 400 });
    }
    return path.join(this.dir, `${id}.json`);
  }

  async list() {
    await fs.mkdir(this.dir, { recursive: true });
    const names = (await fs.readdir(this.dir)).filter((n) => n.endsWith('.json'));
    const items = [];
    for (const n of names) {
      try {
        const c = JSON.parse(await fs.readFile(path.join(this.dir, n), 'utf8'));
        items.push({ id: c.id, name: c.name || '(sin nombre)', updatedAt: c.updatedAt });
      } catch { /* archivo corrupto: se ignora */ }
    }
    return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async get(id) {
    try { return JSON.parse(await fs.readFile(this.#file(id), 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  }

  async save(config) {
    await fs.mkdir(this.dir, { recursive: true });
    const id = config.id || randomUUID();
    const saved = { ...config, id, updatedAt: new Date().toISOString() };
    const file = this.#file(id);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(saved, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
    return saved;
  }

  async delete(id) {
    try { await fs.unlink(this.#file(id)); return true; }
    catch (err) { if (err.code === 'ENOENT') return false; throw err; }
  }
}
