# Traction Sync

Lleva datos de **cualquier origen** (una lista de SharePoint, otra web…) a **Traction u otro destino**, uniendo cada campo con
**drag & drop** (o con un toque, en el celular). Frontend en HTML/CSS/JavaScript y backend en **Python + FastAPI**.

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --port 3000                  # abre http://127.0.0.1:3000
```
Para probar sin credenciales reales: `python examples/mock_servers.py` (un «SharePoint» logístico en :4001 y un destino en :4002).
Pruebas: `pip install -r requirements-dev.txt && pytest` (y `cd frontend && npm test` para los módulos del navegador, solo necesita Node).

## Cómo se usa

1. **Origen**: elige una de estas formas.
   - **Cualquier web o API (importar .har / curl)**: sube el `.har` (o pega un `curl`) de la petición que trae los datos. Se cargan URL, cabeceras y campos.
   - **SharePoint · sitio**: escribe la URL del sitio (p. ej. `https://empresa.sharepoint.com/sites/logistica`), pulsa **Conectar y listar las listas**
     y elige la **lista principal**: se cargan **todas sus columnas** (con su nombre visible). **No hace falta un HAR.**
     - *Microsoft Graph*: autenticación con una app de Azure AD (tenant, client id y secreto) o un token. Recomendado para uso continuo.
     - *REST con sesión*: pegas las cabeceras (`Authorization`/`Cookie`) de tu sesión, copiadas de un HAR/curl; caducan.
2. **Destino**: sube el `.har` (o pega el `curl`) de la petición que **crea** un registro. Su cuerpo es la plantilla y sus campos son los campos destino.
   El destino no está fijo: cambia el HAR cuando cambie la web.
3. **Mapeo**: arrastra un campo de origen al casillero del campo destino, o toca **Elegir campo**. Cada vínculo admite una transformación
   (quitar HTML, a número, fecha ISO…) o un **valor fijo**.
4. **Ejecutar**: *Simulacro* muestra la petición exacta de cada registro sin enviar nada; *Enviar* la ejecuta con progreso en vivo.

Las configuraciones se guardan en `data/` (un JSON por sincronización, permisos 0600).

## Arquitectura orientada a objetos

```
backend/core/
  connectors.py     SourceConnector · TargetConnector         (contratos; el origen puede «descubrir» colecciones y columnas)
  registry.py       ConnectorRegistry                         (catálogo por rol y tipo)
  mapper.py         MappingRule · Mapper                      (registro de origen → valores de destino)
  transforms.py     Transform · TransformRegistry             (extensible)
  sync_job.py       SyncJob                                   (origen → mapper → destino, emite eventos en vivo)
  service.py        SyncService                               (fachada: valida, instancia conectores, ejecuta)
  schema.py · object_path.py · http_client.py
backend/connectors/
  http_source.py    ApiSource → HttpSource                    (cualquier API JSON; configurable con un HAR)
  sharepoint.py     SharePointSiteSource → …GraphSource / …RestSource   (sitio → listas → columnas → elementos)
  http_target.py    HttpTarget                                (plantilla de cuerpo + valores mapeados, {{campo}} en la URL)
  __init__.py       ← único sitio donde se registran conectores
backend/storage/    ConfigRepository · FileConfigRepository · SecretMasker
backend/main.py     API FastAPI + sirve frontend/
frontend/           HTML/CSS/JS (AppState, ConnectorPanel, MappingBoard, RunPanel…); shared/ analiza HAR y curl en el navegador
```

### Añadir un origen nuevo (otra API, base de datos, CSV…)
```python
class MiOrigen(SourceConnector):
    @classmethod
    def descriptor(cls):     # la interfaz genera el formulario a partir de esto
        return {"type": "mi-origen", "role": "source", "label": "Mi origen",
                "fields": [{"name": "url", "label": "URL", "type": "text"}]}
    async def fetch_records(self, limit=None):
        yield {...}          # un registro por iteración
```
Regístralo en `backend/connectors/__init__.py` y aparece en la interfaz. Si además implementa `list_collections()` y
`collection_schema()`, la interfaz le ofrece listar y elegir la colección principal, igual que en SharePoint. Igual para destinos
(`TargetConnector`) y transformaciones (`Transform`).

## Seguridad y límites
- **Microsoft Graph** necesita registrar una app en Azure AD con el permiso de aplicación `Sites.Read.All` (o `Sites.Selected`) y consentimiento de un administrador.
  Eso no se puede hacer desde esta herramienta. Sin eso, usa el modo REST con las cabeceras de tu sesión (caducan).
- El HAR/curl se analiza **en el navegador**; solo se guarda la petición elegida. Los secretos (cabeceras sensibles, `clientSecret`) se guardan
  en `data/` y salen **enmascarados** (`••••`) hacia la interfaz.
- El servidor no tiene login: escucha en `127.0.0.1` por defecto y hace peticiones a URLs configurables. No lo expongas a internet sin añadir autenticación.
- No hay detección de duplicados: enviar dos veces crea dos registros. Usa el *Simulacro* y el *Límite* primero.
