# Testbericht für TRC-AI 0.1.0

## Lokal bestanden

| Prüfung | Ergebnis |
| --- | --- |
| Build | Linux/amd64-Docker-Image. Abhängigkeiten aus der Hash-Lockdatei installiert. |
| Metadaten und Vertrag | YAML, JSON, OpenAPI 3.1, n8n-Beispiel und Versionskonsistenz validiert. JavaScript und Shell auf Syntax geprüft. |
| Start und PostgreSQL | PostgreSQL 18.7 erreichbar, SQL-Migration angewendet, automatischer PostgreSQL-Wiederanlauf mit geänderter Prozess-ID beobachtet. |
| Qdrant | Qdrant 1.18.0 erreicht, neue Collection und Vektor geschrieben und ausgelesen. PostgreSQL- und Qdrant-Ports waren über die Container-Netzwerkschnittstelle nicht erreichbar. |
| Workflow-API | Rollen, ungültige Eingaben, HTTP-Inhaltstyp, Größenlimit, Deduplizierung, paralleler Retry, Schlüsselkonflikt und verspätete Updates geprüft. |
| Control Center | Chromium mit Desktop- und Mobil-Viewport, heller und dunkler Systemmodus. Ungültige und gültige Anmeldung, Live-Status, Konfigurationsspeicherung und Abmeldung geprüft. |
| Stopp, Neustart, Wiederherstellung | Geordneter Stopp und Neustart. Kaltes Archiv in ein neues Volume entpackt. PostgreSQL-Daten, Qdrant-Vektor, Konfiguration und Idempotenzbeleg anschließend überprüft. |
| Python-Abhängigkeiten | `pip-audit` meldete für den Lockfile-Stand keine bekannten Schwachstellen. |

Die Inventur führte außerdem 10 Tests des bestehenden JARVIS-Repos, 3 statische Beeper-Tests und 19 Hermes-Talk-Tests lokal aus. Alle waren erfolgreich. Die Tests arbeiteten ausschließlich mit lokalen Fixtures und bestätigen keinen produktiven Betrieb.

## Ausstehende Abnahme

HAOS-Live-Tests stehen aus. Dazu gehören Installation durch Supervisor, Ingress, Upgrade-Migration, Rücksicherung des Supervisor-Backups und die Zielhardware-Messung. Dokumentenindexierung, OCR und Office-Verarbeitung, der unabhängige TRC-Chat und sein Betrieb bei gestopptem Add-on, Ollama, Hermes, MCP, produktive n8n-Workflows, Sprachdienste und Telefonie sind in der Zielumgebung offen.
