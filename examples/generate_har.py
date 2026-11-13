"""Regenera los HAR de ejemplo:  python examples/generate_har.py"""
import json
from pathlib import Path

HERE = Path(__file__).parent
LIST = "http://127.0.0.1:4001/sites/logistica/_api/web/lists(guid'11111111-1111-1111-1111-111111111111')/items"
HEADERS = [{"name": "Authorization", "value": "Bearer demo-token"}, {"name": "Accept", "value": "application/json"},
           {"name": "User-Agent", "value": "Mozilla/5.0"}, {"name": "Accept-Encoding", "value": "gzip, deflate"},
           {"name": ":authority", "value": "127.0.0.1"}, {"name": "sec-fetch-mode", "value": "cors"}]

sp_body = {"odata.metadata": "demo", "value": [
    {"ID": 1, "Id": 1, "Title": "vision-ai", "Descripcion": "<p>Visión por <b>computador</b></p>", "Estado": "Activo", "FechaInicio": "2025-03-01T08:00:00Z", "Presupuesto": "12000,50", "Responsable": "Ana Pérez", "Email": "ana@contoso.com"},
    {"ID": 2, "Id": 2, "Title": "portal-clientes", "Descripcion": "<p>Portal de autoservicio</p>", "Estado": "En pausa", "FechaInicio": "2025-05-15T08:00:00Z", "Presupuesto": "8000", "Responsable": "Luis Gómez", "Email": "luis@contoso.com"}],
    "odata.nextLink": LIST + "?$skip=2"}
traction_body = {"name": "ejemplo", "description": "", "status": "active", "startDate": "2025-01-01T00:00:00.000Z", "budget": 0,
                 "owner": {"name": "Nombre", "email": "correo@ejemplo.com"}, "tags": ["importado"]}


def har(entries):
    return {"log": {"version": "1.2", "creator": {"name": "ejemplo-traction-sync", "version": "1"}, "entries": entries}}


(HERE / "origen-demo.har").write_text(json.dumps(har([
    {"startedDateTime": "2025-11-01T10:00:00Z", "request": {"method": "GET", "url": LIST, "headers": HEADERS},
     "response": {"status": 200, "content": {"mimeType": "application/json", "text": json.dumps(sp_body)}}},
    {"startedDateTime": "2025-11-01T10:00:01Z", "request": {"method": "GET", "url": "http://127.0.0.1:4001/favicon.ico", "headers": []},
     "response": {"status": 404, "content": {"mimeType": "text/html", "text": "not found"}}}]), indent=2, ensure_ascii=False), "utf-8")

(HERE / "destino-demo.har").write_text(json.dumps(har([
    {"startedDateTime": "2025-11-01T10:05:00Z", "request": {"method": "GET", "url": "http://127.0.0.1:4002/api/projects", "headers": HEADERS},
     "response": {"status": 200, "content": {"mimeType": "application/json", "text": "[]"}}},
    {"startedDateTime": "2025-11-01T10:05:10Z", "request": {"method": "POST", "url": "http://127.0.0.1:4002/api/projects",
     "headers": HEADERS + [{"name": "Content-Type", "value": "application/json"}, {"name": "Content-Length", "value": "200"}],
     "postData": {"mimeType": "application/json", "text": json.dumps(traction_body)}},
     "response": {"status": 201, "content": {"mimeType": "application/json", "text": json.dumps({"id": 1, **traction_body})}}}]), indent=2, ensure_ascii=False), "utf-8")
print("HAR de ejemplo generados en examples/")
