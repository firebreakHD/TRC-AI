# Testbericht

## Geprüfter Stand

| Stufe | Ergebnis |
| --- | --- |
| Reproduzierbare Exporte | 53 deaktivierte Workflows. JSON, Referenzen, Verbindungen, Credential-Platzhalter und JavaScript geprüft. |
| Unit-Tests | 11 Fälle zu Batch-Grenzen, UUID, Backoff, Calendar 410, Aufgaben, Gmail-Klartext und Suche, Wiener Zeitzone, Berichtsgrenzen, HTML, Währungen, Feinunze, Schutzregeln und Quelldaten. |
| n8n 2.49.7 | Import von 53 Workflows, Node-Versionen aus der installierten Registrierung, Anlegen von sechs nativen Data Tables, erneuter Bootstrap, Subworkflow-Aufruf und persistenter Cursor geprüft. |
| Eigenständige Workflows | Authentifizierter WebDAV-PROPFIND und Talk-OCS-Abruf gegen isolierte Protokoll-Fixtures. Tagesbericht aus lokalem Cache während die TRC-Fixture auf HTTP 503 eingestellt war. |
| TRC-Warteschlange | Wiederanlauf über getrennte n8n-Prozesse, identische UUID und Body nach HTTP 503, Deduplizierung, HTTP 422 in der Fehlerwarteschlange, Statusansicht ohne Inhalte und Wechsel über die einzige interne TRC-Adresszeile. |
| LAN und Proxy | Direkter n8n-Betrieb ohne DNS-Eintrag. HTTPS-Testproxy mit eigener CA, Webhook-Ausführung und n8n-WebSocket bzw. SSE geprüft. Wechsel zwischen zwei Hostnamen mit aktualisierten Editor-, Webhook- und OAuth-Callback-URLs im selben Profil geprüft. |
| Live öffentlich | 18 HTTP-Abrufe mit geprüftem Antwortformat. Kraken, EZB, Gold API XAU/XAG, Standard Bullion XAU/XAG und Händlerfeed, arXiv sowie zehn RSS-/Atom-Feeds. |
| Benutzerzugänge | Keine echten Google-, Massive-, SMTP- oder sonstigen privaten Dienstzugänge verwendet. Entsprechend keine produktive Zustellung oder Löschung ausgeführt. |
| Physische Installation | Tatsächliches HAOS-Add-on, Supervisor-Ingress, öffentliches DNS und OAuth-Freigabe beim Anbieter bleiben vor Ort zu prüfen. |

Die Test-Fixtures simulieren Protokolle und Fehlerzustände. Für WebDAV und Talk lief dabei kein Nextcloud-Server. Die isolierte TRC-Fixture simulierte die Antworten der versionierten API. Der echte TRC-Importvertrag wird zusätzlich durch die API-Tests des Add-on-Repositories geprüft.

## Wiederholen

1. `node n8n/tests/validate.mjs`
2. `node --test n8n/tests/unit.mjs`
3. `TRC_N8N_BIN=/pfad/zu/node_modules/.bin/n8n node n8n/tests/runtime.mjs` mit n8n 2.49.7 aus einem lokalen npm-Präfix, Node 24 und OpenSSL. Der Test nutzt ein kurzlebiges SQLite-Profil sowie Loopback-Listener.
4. `python n8n/tests/public_sources.py` für die öffentlichen, lesenden Abrufe.

Stand 26. November 2026. Der Abschluss eigener Credentials und die Aktivierung produktiver Zeitpläne erfolgen im jeweiligen Zielprojekt.
