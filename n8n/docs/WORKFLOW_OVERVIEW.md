# Workflow-Übersicht

Das [Manifest](../MANIFEST.json) listet Zweck, Name, ID, Export, Zeitplan und Credentials je Workflow. Datenabrufe können per Zeitplan, manuell und als Unterworkflow laufen. Die Schreibworkflows akzeptieren nur ausdrücklich freigegebene Unterworkflow-Aufrufe.

| Bereich | Bedienung und Ergebnis |
| --- | --- |
| Gmail | Automatischer History-Abgleich. Unterworkflow mit Modus `search` plus `query`, `unread` oder `important`; Labels per Konfiguration. MIME-Klartext per `messageId` und `confirm`. Anhänge per `messageId`, `attachmentId`, `confirm`. Schreibaktionen `send` und `draft` mit Empfänger, Betreff und Text. |
| Calendar | `mode: "lists"` listet Kalender. SyncToken- und Agenda-Workflows dienen getrennt Änderungen und Zeitfenstern. Termine schreiben per `create`, `update` oder ausdrücklich erlaubtem `delete`. |
| Tasks | `mode: "lists"` für Tasklisten. `open`, `due`, `overdue`, `completed` für gefilterte Ansicht. Schreibaktionen `create`, `update`, `complete`. |
| Nextcloud | WebDAV-Überwachung konfigurierter Verzeichnisse. Download mit `path` und `confirm`, mit Längen- und ETag-Prüfung. Talk-Katalog per `mode: "lists"`, Chatabgleich je Raum, Versand per Raum mit Freigabe. |
| CouchDB, HA | Datenbankstatus des LiveSync-Servers und optionaler Markdown-Export nach WebDAV. HA-Entitäten einzeln oder Katalog per `mode: "states"`. HA-Aufrufe nur an freigegebene Services und Entitäten. |
| Märkte, Nachrichten, Forschung | Normalisierte Belege samt Quelle und Zeitpunkt. Watchlist und Filter aus den Startprofilen. |
| Berichte | Tages-, Wochen-, Monats-, Jahres-, freier Zeitraum, Markt, System, KI und Quantum. Belege werden lokal aggregiert und als `text`, `markdown`, `html` und strukturierte Felder ausgegeben. Geplante Monats- und Jahresberichte beziehen sich auf den abgeschlossenen Zeitraum. Manuelle Berichte akzeptieren `from` und `to` als lokale ISO-Daten, wobei `to` exklusiv ist. Optionaler TRC-Import und Zustellung. |
| Wartung und System | Bootstrap, Importstatus, manuelle Wiederaufnahme per `key` und `confirm`, Quellen- und Dienststatus, Speicherwarnung und Aufbewahrung. |

Für jede Schreibaktion eine eindeutige stabile `requestId` und `confirm: true` übergeben. Im Node `Ziel und Freigabe prüfen` bzw. im Modul [actions.js](../src/actions.js) stehen die je Aktion unterstützten Eingabefelder. Die erste Testzustellung an einen kontrollierten Empfänger über einen eigenen manuellen Aufrufer ausführen.
