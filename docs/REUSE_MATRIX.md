# Wiederverwendungsmatrix

| Komponente | Quellpfad | Ziel | Verwendung und Grund | Teststatus | Freigabe |
| --- | --- | --- | --- | --- | --- |
| RAG, Embedding, Reranking | Vorhandene Compose- und Service-Dateien noch anzufordern | Wissensdienste im Add-on | API-Verträge und CPU-Eignung nach Quellprüfung bewerten | Ausstehend | Ausstehend |
| OCR, Office, Chunking, Enrichment, Watcher | RAG-Quelldateien noch anzufordern | Dokumentenverarbeitung | Vorhandene Pipeline bevorzugen | Ausstehend | Ausstehend |
| PostgreSQL-Schema, Qdrant-Index und Backups | RAG-Migrationen und Skripte noch anzufordern | Wissens- und Metadatenmodule | Eigene Migration in 0.1.0 beschränkt sich auf Workflow-Importe | Workflow-Schema lokal geprüft | RAG-Freigabe ausstehend |
| Hermes, Codex, Talk | `HermesAI-ha/hermes_assistant/{config.yaml,run.sh,talk/}` | Bestehendes Hermes-Add-on | Vorhandene Dienste per API anbinden | Quellcode gesichtet, Live-Test ausstehend | Kein Code kopiert |
| Beeper | `HermesAI-ha/hermes_assistant/beeper-desktop.sh` | Vorhandene Beeper-Installation | Bestehende Desktop-API für einen dünnen unabhängigen Adapter prüfen | Quellcode gesichtet, Live-Test ausstehend | Kein Code kopiert |
| Chat | `JARVIS-ala-Busy/jarvis/` | Unabhängiges Chat-Frontend | Bestehenden Hermes-Client als Ausgangspunkt prüfen | Quellcode gesichtet, Live-Test ausstehend | Repo hat keine über GitHub erkennbare Lizenz; ausdrückliche Freigabe erforderlich |
| PostgreSQL, Qdrant, Supervisor, FastAPI, Uvicorn | Upstream-Pakete und offizielle PostgreSQL- und Qdrant-Containerimages | HAOS-Fundament | Standardkomponenten über ihre vorgesehenen Schnittstellen verwenden | Docker-Integration in diesem Repo | Upstream-Lizenzen der Abhängigkeiten |
