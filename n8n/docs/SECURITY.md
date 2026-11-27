# Betrieb und Berechtigungen

Nur Admins bearbeiten zentrale Adressen, Credential-Bindungen, Zeitpläne und Freigaben. Die Datenbankverbindungen bleiben innerhalb ihrer jeweiligen Dienste. Externe Abrufe verwenden HTTPS, Redirects werden von Workflow-Nodes abgelehnt. Private Dienstverbindungen können in einem kontrollierten LAN oder VPN liegen. HTTP mit lokalen Zugangsdaten setzt ein entsprechend geschütztes Netzwerk voraus.

Mailtexte und Anhänge nur für den tatsächlich benötigten Umfang freigeben. Externe Inhalte sind Daten, HTML wird escaped. Ausführungsdaten werden standardmäßig nicht dauerhaft gespeichert. Bei der Fehlersuche keine Ausführungsdaten mit Inhalten oder Headern teilen. Backups enthalten möglicherweise vertrauliche Tabellenwerte und erfordern dieselbe Zugriffskontrolle wie die Live-Daten.

Schreibziele sind unter anderem nach Empfänger, Talk-Raum, Kalender, Taskliste, Pfad, HA-Dienst und Entität begrenzt. `enabled`, `writesEnabled`, Allowlist und eine explizite Bestätigung sind gemeinsam erforderlich. Bei `reserved` oder `uncertain` am Ziel zuerst nachsehen, bevor ein neuer Auftrag freigegeben wird.
