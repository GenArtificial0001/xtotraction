# Traction Sync

Envía datos de **cualquier origen** (p. ej. una lista de SharePoint con tus proyectos) a **Traction** u otra API,
uniendo campo a campo con **drag & drop** y usando archivos **.har** para descubrir URLs, cabeceras y campos.

```
npm start            # http://127.0.0.1:3000   (Node ≥ 20, sin dependencias)
npm run demo         # «SharePoint» y «Traction» de mentira en :4001 / :4002 para probar el flujo completo
npm test
```

## Cómo se usa

1. **Origen** — elige *Lista de SharePoint* (o *API HTTP genérica*) y pulsa **Importar .har**: elige la petición que devuelve
   la lista; se cargan URL, cabeceras y los campos con valores de ejemplo. «Probar y traer campos» consulta el origen en vivo.
2. **Destino** — **Importar .har** y elige la petición que *crea* un proyecto en Traction (POST). Su cuerpo pasa a ser la
   plantilla; sus campos son los campos destino (puedes añadir más a mano).
3. **Mapeo** — arrastra `Title` (origen) al casillero `name` (destino). Cada vínculo admite una transformación
   (quitar HTML, a número, fecha ISO…) o puedes escribir un **valor fijo** en un casillero. «Auto-mapear» empareja por nombre.
4. **Ejecutar** — *Simulacro* muestra la petición exacta de cada registro sin enviar nada; *Enviar* la ejecuta con
   progreso en vivo y errores por registro.

Las configuraciones se guardan en `data/` (un JSON por sincronización).

Ejemplo para probar sin credenciales: `npm run demo`, `npm start`, y en la app importa `examples/sharepoint-demo.har` (origen,
tipo «Lista de SharePoint») y `examples/traction-demo.har` (destino, la petición POST).

## Arquitectura orientada a objetos

```
shared/                  (se ejecuta en navegador y servidor)
  HarParser.js           HarParser → HarDocument → HarEntry   (.har → borradores de origen/destino)
  SchemaInferer.js       deduce campos y la lista de registros de un JSON
  ObjectPath.js          get/set por ruta "a.b.0.c" (protegido contra prototype pollution)
server/core/
  SourceConnector.js     ◄ contrato de ORIGEN   (fetchRecords, descriptor…)
  TargetConnector.js     ◄ contrato de DESTINO  (buildRequest, send…)
  ConnectorRegistry.js   catálogo de conectores por rol/tipo
  Mapper.js              MappingRule + Mapper (registro origen → valores destino)
  transforms.js          Transform + TransformRegistry (extensible)
  SyncJob.js             orquesta origen → mapper → destino; emite eventos (async generator)
  SyncService.js         fachada: valida, instancia conectores, ejecuta
server/connectors/
  HttpSource.js          cualquier API JSON (paginable por subclase)
  SharePointListSource.js  extends HttpSource: URL REST, OData nometadata/verbose, paginación, oculta metadatos
  HttpTarget.js          plantilla de cuerpo + valores mapeados, marcadores {{campo}} en la URL
  index.js               ← único sitio donde se registran conectores
server/storage/          ConfigRepository (interfaz) · FileConfigRepository · SecretMasker
public/js/               AppState · ApiClient · ConnectorPanel · HarModal · MappingBoard · RunPanel
```

### Añadir un origen nuevo (otra API, CSV, base de datos…)

```js
export class MiOrigen extends SourceConnector {
  static get descriptor() {            // la interfaz genera el formulario a partir de esto
    return { type: 'mi-origen', role: 'source', label: 'Mi origen', fields: [{ name: 'url', label: 'URL', type: 'text' }] };
  }
  async *fetchRecords({ limit, signal }) { /* yield { ...registro } */ }
}
```
Regístralo en `server/connectors/index.js` y aparece en la interfaz. Igual para destinos (`TargetConnector`) y
transformaciones (`Transform`).

## Seguridad y límites a tener en cuenta

- **Credenciales caducan.** Un HAR trae el `Authorization`/`Cookie` de tu sesión del navegador: sirven un rato. Cuando el origen o el
  destino respondan 401/403 pega cabeceras nuevas (la app lo avisa). Para uso continuo hace falta un token estable
  (p. ej. app registrada en Azure AD / API key de Traction); es un cambio solo de cabeceras o de un conector nuevo.
- El `.har` se lee **en el navegador**; solo la petición elegida se guarda. En disco (`data/*.json`, permisos 0600) las cabeceras se
  guardan tal cual; hacia el navegador salen **enmascaradas** (`••••`) y se conservan al guardar.
- El servidor escucha solo en `127.0.0.1` y no tiene login: no lo expongas a la red sin añadir autenticación (hace peticiones a URLs configurables).
- No hay detección de duplicados: enviar dos veces crea dos registros (salvo que el destino lo impida). Usa *Límite* y *Simulacro* primero.
