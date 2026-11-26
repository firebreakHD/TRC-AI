# Backup und Wiederherstellung

Die HAOS-App ist für kalte Backups konfiguriert. Der Supervisor stoppt TRC-AI vor dem Archivieren von `/data`. Damit liegen der PostgreSQL-Cluster, das Migrationsjournal, die Qdrant-Daten und die Control-Center-Einstellungen in einem konsistenten Stand vor.

1. In Home Assistant ein Backup der App anlegen. Bei extern gespeicherten Sicherungen den Zugriff beschränken.
2. Im Wiederherstellungsdialog das gewünschte Backup und die TRC-AI-App auswählen und die Wiederherstellung bestätigen.
3. Status und PostgreSQL-Version öffnen, das Abfrageintervall kontrollieren und einen bereits importierten Testbatch mit demselben Idempotenzschlüssel wiederholen.
4. Nach einem Major-Upgrade eine Sicherung mit dem passenden PostgreSQL-Major verwenden. Die Entwicklungsfassung 0.1.0 verwendet PostgreSQL 18.

Der lokale Smoke-Test stoppt den Container, archiviert das persistente Verzeichnis, entpackt es in ein neues Volume und prüft PostgreSQL-Daten, Idempotenz, Qdrant-Punkte und Konfiguration. Der Supervisor-Wiederherstellungsdialog bleibt ein HAOS-Live-Test.
