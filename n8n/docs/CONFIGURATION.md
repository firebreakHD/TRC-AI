# Konfiguration und Adresswechsel

In `trc_config` jeweils das JSON in `value_json` einer bestehenden Zeile bearbeiten. Der Bootstrap legt alle Standardwerte an. Die Dateien unter [config](../config) dokumentieren das Startprofil, Watchlist, Quellen, Berichte, Aufbewahrung und Zeiten. Sie enthalten keine Zugangsdaten.

| Einstellung | Ort |
| --- | --- |
| Interne TRC-URL für Worker und Status | `trc.baseUrl` |
| Interne Nextcloud-, HA- und CouchDB-URL | `addresses.nextcloud`, `addresses.homeAssistant`, `addresses.couchDb` |
| Gesundheitsprüfungen weiterer Dienste | `health.services` mit `name`, vollständigem `url` und optional `expect` (`http`, `nextcloud`, `couchdb`, `ollama`) |
| Google Konten, SMTP, Zugangsschlüssel | n8n-Credentials am jeweiligen Node |
| Quellen, Ordner, IDs und Filter | In der Zeile der jeweiligen Integration, etwa `calendar.calendarIds`, `talk.rooms`, `dav.directories` |
| Lokale Verarbeitung und optionaler TRC-Import | `enabled` und gegebenenfalls `importTrc` je Quelle |
| Berichte, Zustellung und Priorität | `reports`, `dispatch` und freigegebene Kanalzeile |
| Wiederholung und Speicher | `trc.maxAttempts`, `trc.batchLimit`, `maintenance` |
| Warnungen und Erholung | `alerts.minutes`, `alerts.sourceMaxAgeHours`, `alerts.recovery`, `alerts.delivery` |
| Zeitpläne | Schedule Trigger im Editor oder `schedules.example.json` vor erneuter Erzeugung der Exporte |

Interne URLs enthalten Schema, Host, optionalen Port und gegebenenfalls Dienstpfad. Für TRC zum Beispiel `http://trc-host:8099`, ohne `/api/v1`. Subpfade werden von der Konfiguration übernommen, wenn der jeweilige Dienst sie offiziell bedient. Ein lokales Netz oder VPN braucht keine öffentliche TRC-URL. Zugangsdaten und URLs bleiben bei deaktivierten Integrationen ohne automatische Abrufe. Zeitpläne verwenden standardmäßig Europe/Vienna.

## n8n selbst hinter einem Proxy

Die Laufzeiteinstellungen gehören in die Konfiguration der tatsächlich installierten n8n-Instanz. Ein Beispiel hinter genau einem HTTP-Proxy mit HTTPS-Abschluss unter einer eigenen Subdomain:

```dotenv
N8N_HOST=n8n.example.invalid
N8N_PORT=5678
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://n8n.example.invalid/
WEBHOOK_URL=https://n8n.example.invalid/
N8N_PROXY_HOPS=1
```

`N8N_PORT` ist der n8n-Listener. Ein HAOS-Host-Port wird in dessen Netzwerkansicht separat zugeordnet. Den Listener über Firewall, privates Container-Netz oder LAN nur vom passenden Proxy aus erreichbar machen, wenn Proxy-Header vertraut werden. Die dokumentierten `X-Forwarded-For`, `X-Forwarded-Host` und `X-Forwarded-Proto` am Proxy kontrolliert setzen. WebSocket-Upgrades bzw. SSE ohne Pufferung weiterleiten, wenn die installierte n8n-Version sie verwendet. Die Beispielwerte sind keine Installationsvorgabe. Bei direktem LAN- oder VPN-Zugriff die tatsächlich erreichbare Adresse und `N8N_PROXY_HOPS=0` verwenden. HTTPS ist für die öffentlich erreichbare Anmeldung und Google OAuth vorgesehen. Den systemweiten Vertrauensspeicher verwenden, bei eigener CA den n8n-Prozess und Runner gemäß Add-on-Dokumentation mit `NODE_EXTRA_CA_CERTS` und vertrauenswürdig gemounteter CA starten. Zertifikatsprüfung eingeschaltet lassen.

Subdomain-Betrieb vermeidet die von n8n dokumentierten Probleme bei `N8N_PATH` hinter einem Reverse Proxy. Nur bei erfolgreich geprüfter Unterstützung durch die konkrete Installation einen Subpfad konfigurieren. HA Ingress ist ein Zugriffspfad für Home Assistant und kein öffentlich erreichbarer OAuth-Callback.

## Domain, Port oder Host wechseln

1. Die öffentliche n8n-URL und Proxy-Konfiguration aktualisieren, n8n neu starten und die **OAuth Redirect URL** in jeder OAuth-Credential prüfen. Die angezeigte neue URL beim Anbieter registrieren. Falls der Anbieter die bestehende Autorisierung nicht mehr akzeptiert, Credential im Editor erneut verbinden. Der Workflow-Export ändert weder die OAuth-Anbietereinstellungen noch Zugangsdaten.
2. Externe Aufrufer dokumentierter Webhooks mit der vom Editor angezeigten neuen Produktions-URL aktualisieren. Die Paketworkflows selbst öffnen keine öffentlichen Webhooks. Öffentliche Basis-URLs im TRC-Control-Center betreffen dessen Startkonfiguration und Verbindungstests.
3. Wenn auch die interne TRC-Adresse wechselt, einmalig `trc.baseUrl` bearbeiten. Cache, Cursor, Queue, Credentials und Schlüssel bleiben im persistenten Profil. Die identische UUID und der gespeicherte Body werden beim nächsten Retry an dieselbe TRC-Datenbank gesendet. Bei einem Serverwechsel ist dafür die vorherige Wiederherstellung der TRC-Datenbank nötig.

[Proxy- und Webhook-Einstellungen](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/) · [Deployment-Variablen](https://docs.n8n.io/hosting/configuration/environment-variables/deployment/)
