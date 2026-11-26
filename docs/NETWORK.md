# Netzwerk und Integrationen

Die festen Listener bleiben intern bei Port 8099 für TRC-AI, am Unix-Socket für PostgreSQL und auf Loopback für Qdrant. Der Host-Port für TRC-AI ist in HAOS standardmäßig unzugeordnet. Über **Einstellungen → Apps → TRC-AI → Netzwerk** kann bei LAN-, VPN- oder Proxy-Bedarf ein freier Host-Port auf `8099/tcp` gelegt werden. Home Assistant verwaltet Ingress separat. Die UI verwendet relative URLs und funktioniert über einen vom Ingress korrekt weitergeleiteten Pfad.

## Native Startoptionen

| Option | Bedeutung |
| --- | --- |
| `network_public_url` | Optionale öffentliche HTTPS-Basisadresse. Sichtbar im Control Center. |
| `network_internal_url` | Optionale interne Basisadresse. Für den lokalen Selbsttest wird andernfalls Loopback verwendet. |
| `network_proxy_mode` | `direct` ist der Standard. `trusted_proxy` interpretiert Forwarded-Header nur vom eingetragenen Socket-Peer. |
| `network_trusted_proxies` | Konkrete IPv4-, IPv6-Adressen oder eng begrenzte CIDRs. Wildcards sind unzulässig. |
| `network_tls_mode` | `lan_http` für internen HTTP-Transport, `proxy_https` für externen HTTPS-Abschluss. Letzterer setzt HTTPS-Basisadresse und Proxy-Vertrauen voraus. |
| `network_ca_file` | Name einer PEM- oder CRT-Datei unter dem schreibgeschützten `/ssl`. Die eigene CA erweitert die Systemvertrauensliste für explizit umgestellte ausgehende Prüfungen. |
| `network_timeout_seconds` | Standardwert für Netzwerkprüfungen, 1 bis 30 Sekunden. |

Native Änderungen über Home Assistant speichern und das Add-on neu starten. Öffentliches HTTPS terminiert am Reverse Proxy. Das Add-on selbst und seine internen Komponenten bleiben im privaten Netz.

## Dienstprofile

Im Control Center unter **Netzwerk und Integrationen** interne und öffentliche Adressen und den benötigten Zugriff pflegen. Die native Konfiguration ist für die beiden TRC-Adressen maßgeblich. Der Verbindungstest benutzt die gespeicherte interne Adresse. Öffentliche Adressen können als Referenz für Nutzer dokumentiert werden. Änderung eines Profils und lesender Verbindungstest wirken sofort. Die Oberfläche zeigt den letzten erfolgreichen Test und den jüngsten Prüfstatus.

Passwörter oder Tokens werden einmal eingegeben und danach nur als Vorhandenseinsindikator angezeigt. Leeres Geheimnis beim Speichern erhält den vorhandenen Wert. Zum Wechsel der Authentifizierung ein passendes neues Geheimnis eingeben oder ausdrücklich entfernen. Die separate Referenz benennt ein Credential im jeweiligen Dienst und löst keine Secrets in Fremdsystemen auf. n8n läuft mit eigenen, verschlüsselten Credentials und eigenen Data Tables. Profiltests sind manuell. Aktivierung einer Dienstverbindung startet keine Workflows.

HTTP-Testendpunkte folgen den jeweiligen Dienstschnittstellen. Home Assistant prüft `/api/`, Hermes `/health/detailed`, n8n `/healthz/readiness`, Ollama `/api/version`, Nextcloud `/status.php` und Talk die OCS-App-Kapazitäten. CouchDB meldet sich über das Haupt-API. Obsidian-LiveSync-Server bevorzugt als CouchDB prüfen. SMTP prüft mittels STARTTLS oder implizitem TLS Anmeldebereitschaft und NOOP. Ein erfolgreicher Test öffentlicher Readiness-Endpunkte prüft Erreichbarkeit. Eigene Profile können einen vollständigen lesenden Probe-Pfad als interne Adresse angeben.

Profile liegen mit Dateirechten 0600 im privaten Add-on-Verzeichnis. HAOS-Backups können diese sensiblen Daten enthalten. Die Zugriffsrechte des Sicherungsspeichers entsprechend setzen. HAOS-Hostport, Zertifikate, Firewall, n8n-Schlüssel und dessen externe Datenbank in getrennte Sicherungsschritte einbeziehen.

## Reverse Proxy

Die Proxy-Adresse aus Sicht des TRC-Listeners in `network_trusted_proxies` aufnehmen. Den Backend-Port auf den Proxy, das LAN oder das VPN beschränken. Der erste vertrauenswürdige Proxy überschreibt vom Client kommende Forwarded-Header. In einer Proxy-Kette nur kontrollierte Zwischenstationen hinzufügen. TLS-Zertifikate der externen Subdomains müssen deren DNS-Namen enthalten. Interne Belege und Queue nutzen weiterhin die interne URL.

| Proxy | Einstellungen |
| --- | --- |
| Nginx | HTTP-Backend zur privaten TRC-Adresse, `proxy_set_header Host $host`, `X-Forwarded-Host $http_host`, `X-Forwarded-Proto $scheme`, am öffentlichen ersten Hop `X-Forwarded-For $remote_addr`. Für n8n WebSocket-Upgrades und bei Streaming `proxy_buffering off` einrichten. |
| Nginx Proxy Manager | Public Subdomain, internes Forward-Ziel und HTTPS-Zertifikat einstellen. Bei n8n WebSockets aktivieren und erzeugte Forwarded-Header am Backend verifizieren. |
| Caddy | `reverse_proxy <interne-Adresse>` mit passendem Site-Namen. Caddy setzt X-Forwarded-Header und unterstützt WebSocket-Upgrades automatisch. Für eine zusätzliche vorgeschaltete Instanz konkrete `trusted_proxies` verwenden. |
| Traefik | HTTPS-Router mit Host-Regel und internem HTTP-Service verwenden. `forwardedHeaders.trustedIPs` nur für einen tatsächlich vorgelagerten Proxy setzen. |
| HAProxy | In TLS-Frontend ursprünglichen Host und `X-Forwarded-Host` weitergeben, `X-Forwarded-Proto` aus TLS ableiten und am ersten Hop `X-Forwarded-For` aus `src` setzen. Für WebSockets und SSE passende Tunnel-/Server-Zeitouts wählen. |

Die Beispielregeln betreffen Subdomains. HAOS-Ingress leitet seinen eigenen Präfix weiter. Bei anderen Subpfaden muss der Proxy Präfixe konsistent entfernen, die Basisroute mit abschließendem Schrägstrich öffnen und statische Inhalte und API gemeinsam weiterleiten. Bei n8n dessen dokumentierte Einschränkungen beachten. Cookie-Sicherheit, CSRF und CORS von n8n oder OAuth-Anbietern nicht abschalten. Das TRC-Control-Center nutzt einen Bearer-Header im selben Origin und keine Sitzungs-Cookies. Für öffentliche TRC-Anbindungen den Zugriff auf Verwaltungsrouten am Proxy auf LAN/VPN oder autorisierte Quellnetze begrenzen. Die Workflow-API begrenzt JSON-Uploads auf 512 KiB. Der Proxy sollte diese Requests bis zum Anwendungslimit durchlassen und genügend Wartezeit für die Statusprüfung geben.

Bei Domainwechsel öffentliche Adresse und Zertifikat ändern. Für interne Adress- oder Portwechsel das Zielprofil aktualisieren. PostgreSQL, Qdrant und Profildaten liegen in ihrem bisherigen Datenverzeichnis. Domainwechsel verändern keine Datenbankmigration. OAuth- und Webhook-Adressen in der betroffenen n8n-Instanz prüfen und externe Aufrufer bzw. registrierte Redirect-URLs aktualisieren.

[HAOS-App-Konfiguration](https://developers.home-assistant.io/docs/apps/configuration/) · [n8n hinter Proxy](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/) · [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) · [Traefik Forwarded Headers](https://doc.traefik.io/traefik/routing/entrypoints/) · [Hermes Gateway](https://github.com/firebreakHD/HermesAI-ha/blob/main/hermes_assistant/DOCS.md)
