import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultRegistry } from './connectors/index.js';
import { FileConfigRepository } from './storage/ConfigRepository.js';
import { SyncService } from './core/SyncService.js';
import { WebApp } from './app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;
// Solo local por defecto: la herramienta guarda credenciales y hace peticiones a URLs configurables.
const host = process.env.HOST || '127.0.0.1';

const repository = new FileConfigRepository(process.env.DATA_DIR || path.join(ROOT, 'data'));
const service = new SyncService({ registry: createDefaultRegistry(), repository });
const server = new WebApp({ service, repository }).createServer();

server.listen(port, host, () => console.log(`Traction Sync escuchando en http://${host}:${port}`));
