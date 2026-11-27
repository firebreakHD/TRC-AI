# Entwicklungsstand und Fortsetzung

Version 0.2.0 führt das 0.1.0-Fundament, die Netzwerk-Erweiterung aus PR #3 und das n8n-Paket aus PR #4 in einem Backend-Entwicklungsbranch zusammen. Ein amd64-Add-on enthält Gateway, PostgreSQL, den Qdrant-Index und den lokalen Worker mit OCR und Docling. Status- und Schreibvertrag für n8n bleiben kompatibel. Lokale Dokumente und Uploads können indexiert und mit Quellen durchsucht werden.

Nächster Schritt ist ein Test auf einer separaten HAOS-Instanz oder in einem vorab gesicherten Testfenster am Fujitsu. Admin-Ingress, die interne Ollama-Route mit BGE-M3 und einem bestehenden Antwortmodell sowie die Rücksicherung über den Supervisor prüfen. Die n8n-Installation des Betreibers umfasst nach dessen Bericht Version 2.47.3, 53 Workflows, sechs Data Tables und 21 manuelle Fachtests. Die Generator-Korrektur für ISO-Daten lässt sich bei einem späteren Paketupdate gezielt übernehmen.

Danach Nextcloud-Dateiquellen und lokal synchronisierte Obsidian-Vaults mit eigenen Zugangsregeln anbinden. JARVIS und FRIDAY sind als spätere Assistentenprofile vorbereitet. Beeper folgt nach der Abnahme der übrigen Integrationen.

[Testbericht](TEST_REPORT.md) · [Offene Punkte](OPEN_ISSUES.md)
