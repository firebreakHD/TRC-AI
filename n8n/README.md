# TRC-AI-Workflows für n8n

Das Paket nutzt n8n Community Edition 2.49.7 und sechs native Data Tables. Abrufe und Berichte funktionieren lokal mit n8n. Ein optionaler Worker überträgt Belege über die TRC-AI Workflow API 0.1.0. Sämtliche Workflow-Exporte sind unveröffentlicht und Integrationen standardmäßig deaktiviert.

1. [Installation, Import und Sicherung](docs/INSTALLATION.md)
2. [Adressen, Zeitpläne und Freigaben](docs/CONFIGURATION.md)
3. [Zugangsdaten und Google OAuth](docs/CREDENTIALS.md)
4. [Workflows und Data Tables](docs/WORKFLOW_OVERVIEW.md)
5. [Tatsächlicher Prüfstand](docs/TEST_REPORT.md)

[MANIFEST.json](MANIFEST.json) enthält den vollständigen Importkatalog. Exporte nach Änderungen mit `node n8n/scripts/build.mjs` neu erzeugen.
