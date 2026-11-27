# Änderungsverlauf

## 0.3.0

- Chat, Assistentenprofile, Dokumentanhänge und kontrolliertes Anfrage-Routing.
- Integrierte Administration mit getrenntem Chat-Zugang.
- Kompatible Workflow-API und fortbestehende Wissensdatenbank.

## 0.2.0

- Dokumentverarbeitung mit OCR, Word-Struktur über Docling, Excel-Normalisierung, segmentierten Quellen und persistenter Warteschlange.
- Hybride Wissenssuche, Quellenreferenzen, Qdrant-Abgleich und optionale Antworten mit vorhandenen Modellen.
- Kompatible n8n-Import-API mit zusätzlichem Admin-Lesepfad. Korrekte Wiener ISO-Daten im n8n-Generator.

- Native Optionen für getrennte interne und öffentliche Adressen, Proxy-Vertrauen, CA und Timeout.
- Control Center mit persistenten Dienstprofilen und lesenden Verbindungstests.
- Dokumentierte lokale, VPN-, Ingress- und HTTPS-Proxy-Betriebsarten.

## 0.1.0

- amd64-Entwicklungsgrundlage für HAOS mit Control Center und separaten Administrations- und Workflow-Tokens.
- PostgreSQL 18 über einen lokalen Socket, versionierte Migration und persistentes Datenverzeichnis. Qdrant 1.18.0 ist ausschließlich über Loopback erreichbar.
- Versionierte Status- und Workflow-Import-API mit transaktionaler Deduplizierung, Konflikterkennung und OpenAPI-Vertrag.
- Tests für Build, Start, Neustart, Persistenz und kalte Rücksicherung beider Datenbanken im Docker-Container.
