# Künftige TRC-Schnittstellen

Der aktuelle Workflow-Vertrag erlaubt lesenden Systemstatus und idempotente Bereichsimporte. Für Dokumente wäre eine dokumentierte authentifizierte Übergabe aus dem Dateimonitor nötig, mit stabiler Quell-ID, Pfad oder Upload, Länge, Typ, ETag bzw. Prüfsumme, Idempotenz und anschließend abfragbarem Jobstatus. OCR, Docling, Chunking, Embeddings und Indexierung liegen auf Seiten von TRC-AI.

Für LiveSync-Indexierung wäre eine freigegebene Job-Schnittstelle mit Vault-/Quell-ID und Status nötig. Ein späteres Control Center zur n8n-Paketverwaltung braucht unterstützten Lese-/Schreibzugriff auf Konfiguration und klar getrennte Berechtigungen. Bis dahin dient die projektbezogene n8n Data Table als aktive Workflow-Konfiguration. Das Control Center für Diensteinstellungen trifft keine automatische n8n-Konfigurationsänderung.
