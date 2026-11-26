# Entwicklungsstand und Fortsetzung

Version 0.1.0 liefert ein Management-Fundament mit PostgreSQL und Qdrant. Bestandsrepos wurden lesend gesichtet. Der veröffentlichte n8n-Vertrag umfasst die tatsächlich implementierten Pfade für Status und Datenimporte. Diese Fassung führt keine RAG- oder Agentenfunktionen aus.

Nach Bereitstellung der freigegebenen RAG-Dateien zuerst deren AGENTS.md und Compose-Overrides lesen. Service-Entrypoints, Schnittstellen, Migrationen und Lizenz je Komponente zur Matrix hinzufügen. An vorhandenen Fixtures Embedding-Dimension und Qdrant-Verträge reproduzieren, bevor eine Collection oder Migration entworfen wird. Danach die kleinste durchgängige Markdown-Verarbeitung mit Update, Quellenreferenz und Rücksicherung in einem neuen Datenvolume aufbauen.

Sobald eine getrennte HAOS-Testinstanz zugänglich ist, 0.1.0 lokal installieren. Ingress, Schlüsselwechsel, HAOS-Backup sowie Neuinstallation und Wiederherstellung in dieser Instanz protokollieren. Danach unabhängige HA-/Ollama- und Hermes-Konversationen bei gestopptem Add-on prüfen. Die [Abnahmeübersicht](TEST_REPORT.md) dokumentiert die verbleibenden Tests.

Das eigenständige n8n-Paket liegt in [n8n/](../n8n/README.md). Die Workflows nutzen den veröffentlichten Import- und Statusvertrag 0.1.0. Setup, Credential-Bindung, konfigurierbare Adressen und die reale Importprüfung sind dort dokumentiert. Nächster Schritt ist der geführte Import in einer separaten n8n-/HAOS-Instanz mit freigegebenen Testkonten.
