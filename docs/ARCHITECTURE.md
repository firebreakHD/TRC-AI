# Architektur

Der Startprozess initialisiert beim ersten Start PostgreSQL unter `/data/postgresql/cluster`. Supervisor führt PostgreSQL, Qdrant und FastAPI/Uvicorn unter getrennten Systembenutzern aus. Die API verbindet sich über einen lokalen Unix-Socket mit Peer-Authentifizierung. Migrationen laufen unter einer Transaktionssperre. Wird ein späterer Migrationsstand mit einem älteren Image gestartet, liefert der Dienst für Datenbankoperationen einen Fehler.

Das Control Center lädt statische Dateien aus dem Add-on und bezieht Daten ausschließlich aus der Management-API. Relative Pfade erlauben den Einsatz hinter Home-Assistant-Ingress. Browser und Automatisierung haben eigene Zugriffsschlüssel. Datenimporte schreiben Inhalt und Idempotenzbeleg gemeinsam nach PostgreSQL.

Das Add-on hängt für Start, Datenbank und Verwaltung von keinem Agenten ab. Die bestehenden Home-Assistant-, Ollama-, n8n- und Hermes-Dienste bleiben eigenständig. Die weitere Assistenzausbaustufe nutzt verfügbare Home-Assistant-Konversationsagenten und prüft die Wiederverwendung des vorhandenen JARVIS-Chats. Der neu zu integrierende Anfrageverteiler und Chat gehören außerhalb des TRC-AI-Add-ons. Qdrant bleibt auf IPv4-Loopback beschränkt. Die Dokumentenverarbeitung und produktive Collection-Schemata folgen nach Prüfung der freigegebenen RAG-Quellen.
