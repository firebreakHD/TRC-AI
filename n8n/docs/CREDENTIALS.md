# Zugangsdaten

Anzeigenamen aus dem Manifest in n8n anlegen und pro Node wirklich auswählen. Exportierte Namen sind Bezeichner. Versionswechsel und Web-Import können Zuordnungen lösen. Für Lese- und Schreibzugriffe getrennte Credentials verwenden, wo Anbieter und Berechtigungssystem das unterstützen.

| n8n-Typ | Nutzung |
| --- | --- |
| Generic OAuth2 API | Je ein Lese- und Schreibzugang für Gmail, Google Calendar und Google Tasks |
| Bearer Auth | TRC Workflow-API. Nur den Tokenwert eintragen. |
| Generic Header Auth | `Authorization: Bearer <Token>` für Home Assistant und Hermes |
| Generic Basic Auth | Nextcloud App-Passwort für WebDAV bzw. Talk, passender dedizierter CouchDB-Lesezugang |
| Generic Query Auth | Massive mit Feld `apiKey` |
| SMTP | Relay, TLS und Anmeldedaten direkt im Credential speichern |

Google im Authorization-Code-Verfahren mit `https://accounts.google.com/o/oauth2/v2/auth` und `https://oauth2.googleapis.com/token` einrichten. Für geplante Ausführungen beim Autorisieren Offline-Zugriff anfordern (`access_type=offline` und bei der Erstanmeldung gegebenenfalls `prompt=consent`). Im jeweiligen Google-Projekt die konkrete API aktivieren und die im n8n-Editor angezeigte Redirect-URL registrieren. Testnutzer und Gültigkeit der Refresh Tokens hängen von der OAuth-App-Konfiguration ab.

| Zugriff | Scope unter `https://www.googleapis.com/auth/` |
| --- | --- |
| Gmail lesen, Suche und Anhänge | `gmail.readonly` |
| Gmail senden und Entwürfe | `gmail.compose` |
| Kalenderliste und Termine lesen | `calendar.calendarlist.readonly calendar.events.readonly` mit vollständigem Präfix pro Scope |
| Termine erstellen, bearbeiten oder löschen | `calendar.events` |
| Aufgabenlisten und Aufgaben lesen | `tasks.readonly` |
| Aufgaben erstellen, ändern oder abschließen | `tasks` |

Öffentliche Kraken-, EZB-, Gold-API-, Standard-Bullion-, RSS- und arXiv-Abrufe benötigen keine verwalteten Zugangsdaten. Bei einem Fehler Token und Freigaben im Credential-Dialog prüfen. Keine Header, OAuth-Tokens oder Provider-Request-URLs mit Query-Credentials in Supportausgaben kopieren.

[Gmail-Scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) · [Calendar-Scopes](https://developers.google.com/workspace/calendar/api/auth) · [Google Tasks OAuth](https://developers.google.com/workspace/tasks/auth)
