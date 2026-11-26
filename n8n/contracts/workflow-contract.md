# TRC-AI Workflow API 0.1.0

Die [OpenAPI-Datei](openapi.yaml) beschreibt die implementierten n8n-Pfade unter `/api/v1`. Das Workflow-Token gehört in den Bearer-Header und wird getrennt vom Administrations-Token eingerichtet. Der Statuspfad akzeptiert beide Rollen. Das Beispiel für einen Aufgabenimport liegt unter [examples/tasks.json](examples/tasks.json).

## Identität und Wiederholung

Ein Datensatz ist durch Datenbereich, stabile Quellkennung und externe ID identifiziert. Bei mehreren Konten in einem Bereich braucht jedes Konto eine eigene Quellkennung. `observed_at` ist die Zeit des Quellstands. Ein neuerer Zeitstempel ersetzt den gesamten bisherigen Datensatz. Gleiche und ältere Stände bleiben unverändert. Datumswerte werden für Vergleich und Speicherung nach UTC normalisiert.

Erzeuge pro abzusendendem Batch eine UUID und speichere sie zusammen mit dem Request. Ein Retry verwendet denselben Schlüssel, Datenbereich und Body. Erfolgreiche Wiederholungen geben das ursprüngliche Ergebnis zurück. Die Reihenfolge der Objektschlüssel ist unerheblich. Eine geänderte Datensatzreihenfolge gilt als anderer Batch. Dieselbe UUID mit geänderten Daten liefert `409 idempotency_conflict`. Ein Import schreibt alle Datensätze und sein Ergebnis in derselben Transaktion. Die Datenbank bewahrt Idempotenzschlüssel in diesem Stand dauerhaft auf.

## Fehler

| HTTP | Code | Behandlung |
| --- | --- | --- |
| 401 | `unauthorized` | Bearer-Token und Rolle prüfen. |
| 409 | `idempotency_conflict` | UUID und gespeicherten Body abgleichen. |
| 413 | `payload_too_large` | Batch aufteilen und neue UUIDs erzeugen. |
| 415 | `unsupported_media_type` | `Content-Type: application/json` setzen. |
| 422 | `invalid_request` oder `invalid_idempotency_key` | Eingabe korrigieren. |
| 503 | `database_unavailable` | `Retry-After` beachten und begrenzt erneut versuchen. |

Netzwerkfehler und Timeouts sind mit derselben UUID wiederholbar. Je nach Umgebung mit 10–15 Sekunden HTTP-Timeout beginnen. Bei Verbindungsfehler oder `503` mit 5, 15 und 45 Sekunden Verzögerung wiederholen. Nach dem dritten Retry den Batch für die spätere Prüfung behalten.

`payload` nimmt ein JSON-Objekt ohne bereichsspezifische Felder an. Fachliche Schemata, lesende Datenschnittstellen, Löschereignisse, Dokumentenindexierung und Knowledge API stehen aus. Ein Import löst keine Nachrichten, Agenten- oder Home-Assistant-Aktionen aus.
