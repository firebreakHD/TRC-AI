# Upgrade auf 0.3.0

1. Eine HAOS-Sicherung der laufenden 0.2.0-App anlegen und die bestehende Repository-Adresse notieren.
2. Für ein direktes Store-Update dieselbe Repository-Adresse und denselben Branch-Kanal behalten. Ein anderer Repository-Eintrag ergibt eine andere App-ID. Die veröffentlichte 0.3.0-Version baut auf dem Tag v0.2.0 auf.
3. Updates übernehmen das bisherige Datenverzeichnis. PostgreSQL, Qdrant, Dokumente und Schlüssel bleiben im bestehenden App-Speicher. Die Chat-Datenbank wird bei der ersten Ausführung daneben angelegt.
4. Mit dem vorhandenen Admin-Token anmelden. Bei Bedarf in der HAOS-Konfiguration ein separates Chat-Token setzen und die App neu starten.
5. Eine vorhandene Quelle suchen, einen Chat in allgemeiner KI öffnen und den bestehenden n8n-Importstatus kontrollieren.

Ist die alte App mitsamt Daten entfernt worden, kann eine passende Sicherung vor dem Löschen den alten Stand wiederherstellen. Ohne Sicherung neuen Admin- und Workflow-Token einrichten, Ollama verbinden und benötigte Dokumente erneut importieren. Bei neuem Workflow-Token den Bearer-Wert im vorhandenen n8n-Credential anpassen. Bereits erfolgreich übertragene n8n-Aufträge werden nicht automatisch erneut gesendet.

[Installation](INSTALLATION.md) · [Backup](BACKUP_RESTORE.md)
