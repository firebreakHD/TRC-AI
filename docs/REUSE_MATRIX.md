# Wiederverwendungsmatrix

| Baustein | Herkunft | Verwendung | Freigabe und Prüfung |
| --- | --- | --- | --- |
| Gateway, PostgreSQL, Qdrant, Supervisor und Cold Backup | TRC-AI v0.1.0 und Basis-PR #1 | Laufzeit, bestehende Migration und Idempotenz übernommen | Projektintern. Docker-Abnahme deckt Altvertrag und Persistenz ab. |
| Netzwerk, Credentials, Ingress | TRC-AI PR #3, 292a74a | Startoptionen, Control Center und Dienstprofile übernommen. Modellclients nutzen dieselben Profile. | Projektintern. TLS und Proxy mit isolierten Fixtures geprüft. |
| n8n Paket und Vertrag | TRC-AI PR #4, 7a7a931 | Bestehende 53 Exporte und zentrale ISO-Datumsfunktion. | Projektintern. Exporte und Node-Tests sowie Backend-Kompatibilität geprüft. |
| Parser und Chunking | WDB-RAG-Referenz v1.1.0, independent-implementation/wdb/extract.py | Struktursegmentierung, Formatparser und Enrichment unter trc/rag/extract.py angepasst. | Durch Backend-Auftrag für Wiederverwendung freigegeben. ZIP-Prüfsummen und synthetische Dokumentformate geprüft. |
| Watcher und Suche | WDB-RAG-Referenz v1.1.0, independent-implementation/wdb/store.py und schema.sql | SQL-Verbindung, Migration 002, RRF, Quellen, Upload und Steuerung. | Eigenständige Referenz. Add-on-Rundlauf mit PostgreSQL und Qdrant. |
| Modellclients und Projektion | WDB-RAG-Referenz v1.1.0, independent-implementation/wdb/providers.py | Dienstprofile, Vektorkompatibilität, optionale LLM-Fassade und lokaler Fallback. | Frühere Modelltests der Referenz und Adapterprüfung des Add-ons mit isoliertem Testdienst. |
| Dokumentbibliotheken | Docling Slim MIT, pdfplumber MIT, Python-Docx MIT, OpenPyXL MIT, Tesseract Apache-2.0, Poppler GPL | Upstream-Distributionen mit Versions- und Hashbindung der Python-Pakete. | Upstream-Lizenzen gelten. Parser und OCR im amd64-Container ausgeführt. |

Die Integration übernimmt ausschließlich Projektcode und die vom Nutzer freigegebene eigenständige Referenz.
