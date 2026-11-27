# Architektur

Ein gemeinsames HAOS-Add-on betreibt PostgreSQL 18, Qdrant 1.18, die FastAPI/Uvicorn-Gateway-API und einen Dokument-Worker unter Supervisor. PostgreSQL nutzt einen Unix-Socket mit Peer-Authentifizierung. Qdrant bindet IPv4-Loopback. Die App bietet HAOS-Ingress und einen unbelegten Host-Port. Änderungen an der Proxy-Vertrauensliste gelten nach Neustart.

Ein Upload landet nach Validierung von Größe, Dateiname und Prüfsumme atomar im privaten Eingang. Der Watcher erfasst stabil lesbare Dateien aus dem Eingang und einem schreibgeschützten Unterordner von /share. PostgreSQL vergibt zeitlich begrenzte Auftragsleases. Der Worker startet einen begrenzten Parserprozess. Tesseract und Poppler kommen bei Bildern oder Scan-Seiten zum Einsatz. Docling Slim verarbeitet Word. Die Segmente erhalten Abschnitts-, Blatt- oder Seitenreferenzen und werden über das konfigurierte Ollama eingebettet.

PostgreSQL hält Dokumentrevision, Metadaten, Chunktext und Vektoren. Qdrant ist eine abgeleitete Cosine-Projektion. Die API prüft Qdrant-Treffer gegen die aktuelle SQL-Revision. Fehlende Punkte lassen sich aus SQL wiederherstellen. PostgreSQL-Volltextsuche und Qdrant-Dense-Suche werden per Reciprocal Rank Fusion und begrenztem Reranking zusammengeführt.

Ein konfiguriertes Ollama- oder OpenAI-kompatibles Antwortmodell erhält die Belegauswahl bei einer expliziten Antwortanfrage. JARVIS und FRIDAY sind als Antwortprofile vorbereitet. Chat-Verlauf, Sprache und Kanäle gehören zur späteren Assistenten-Integration.

Die Workflow-API behält ihr Schreibformat und den Idempotenzschlüssel. Eine Admin-Lesefunktion gibt strukturierte Daten seitenweise aus. Home Assistant, Hermes, Sprache und n8n laufen eigenständig. Die API startet auch bei einem Ausfall des Modellanbieters.

[Konfiguration](KNOWLEDGE.md) · [API](BACKEND_API.md) · [Backups](BACKUP_RESTORE.md)
