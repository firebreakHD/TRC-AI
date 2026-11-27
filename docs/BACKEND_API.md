# Backend-API 0.2.0

Alle neuen Funktionen erfordern das Admin-Token im Authorization-Header. Status und Schreibvertrag für n8n bleiben kompatibel. Das Workflow-Token berechtigt zu Status und bestehendem Import.

| Methode und Pfad unter `/api/v1` | Verwendung |
| --- | --- |
| `GET /system/status` | Bestehender Systemstatus für beide Rollen. |
| `POST /workflow/records/{area}` | Bestehender idempotenter Import mit UUID im `Idempotency-Key`. |
| `GET /workflow/records/{area}` | Strukturierte Datensätze lesend abrufen, optional `source` filtern. `limit` bis 50. `next` als `cursor` für die nächste Seite verwenden. |
| `GET /knowledge/status` | Aufträge, Worker-Herzschlag, Fehleranzahlen und wirksame Startoptionen. |
| `GET /knowledge/documents` | Dokumentpfade, Versionen und Jobstatus. Optionalen Cursor `next` als `after` übernehmen. |
| `PUT /knowledge/documents/{name}` | Binäre Datei mit `Content-Type: application/octet-stream` hochladen. `202` mit Pfad, Hash und `queued`. |
| `POST /knowledge/query` | JSON mit `question` und optional `prefix`, `limit`, `answer` und `profile`. |
| `POST /knowledge/retry` | JSON mit `path` und optional `reindex: true` für bereits indexierte Dokumente. |
| `PUT /knowledge/worker` | JSON `{"paused":true}` oder `{"paused":false}`. |
| `POST /knowledge/index/repair` | Indexabgleich asynchron vormerken. |

`prefix` ist ein genauer Pfad wie `upload/mein-dokument.md` oder ein Unterordner-Präfix im Namensraum `local`. Suche gibt Belege mit stabilen Chunk-IDs zurück. Die optionalen Profile `jarvis` und `friday` setzen unterschiedlich formulierte Antwortvorgaben für diese Wissensabfrage. Sitzungen und Kanäle sind für eine spätere Assistenten-Integration vorgesehen.

[OpenAPI](../contracts/openapi.yaml) · [Workflow-Vertrag](../contracts/workflow-contract.md)
