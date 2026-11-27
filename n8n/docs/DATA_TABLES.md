# Native Data Tables

| Tabelle | Zweck | Schlüssel |
| --- | --- | --- |
| `trc_config` | JSON-Einstellungen je Bereich | Bereich |
| `trc_state` | Cursor und Warnzustand | Integration, Quelle und Ziel bzw. technischer Name |
| `trc_cache` | Normalisierte Belege mit Quellzeitpunkt | Deterministischer Quellbelegschlüssel |
| `trc_queue` | Unveränderliche Body-Kopie und Retry-Zustand | UUID des vollständigen Batches |
| `trc_delivery` | Schreibreservierung und Versandstatus | Kanal und Anforderungskennung |
| `trc_events` | Ausführungs- und Speichermeldungen | Ereigniskennung |

[Schema](../data-tables/schema.json) und [Startzeilen](../data-tables/config-default.json) werden vom Bootstrap ausgewertet. Statuszeiten und ISO-Vergleiche verwenden UTC. `trc_queue.body` bleibt bei Retry unverändert. `pending` und `dead` bleiben bei Bereinigung erhalten. Die feste Spaltenstruktur erlaubt spätere geprüfte Migrationen ohne Neuanlage. Data Tables werden von n8n verwaltet.

n8n 2.49.7 enthält ein Standardlimit von 200 MiB für Data Tables einer Instanz. Die Wartung liefert Stichprobenzahlen und eine grobe JSON-Größenschätzung, während die Kapazitätsanzeige der Instanz maßgeblich bleibt. Schutz bei begrenztem RAM erfolgt zusätzlich über Quellen-, Abruf-, Batch- und Cachegrenzen. Bei vollem Speicher zuerst sichern, die tatsächliche Belegung feststellen und die konfigurierten Aufbewahrungsfristen prüfen.
