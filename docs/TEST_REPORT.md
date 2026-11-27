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

## Netzwerkeinstellungen und Control Center 0.2.0

| Szenario | Ergebnis im isolierten Test |
| --- | --- |
| LAN ohne öffentliche Domain | Docker-Hostport und direkter Zugriff geprüft. |
| Home Assistant Ingress | Relativer UI-/API-Pfad hinter simuliertem Ingress-Präfix geprüft. Home Assistant Supervisor vor Ort offen. |
| HTTPS hinter Proxy und eigener Hostname | Lokaler HTTPS-Reverse-Proxy mit Test-CA und getrennten Test-Hostnamen geprüft. Öffentliche DNS-/ACME-Validierung offen. |
| Domain, interne Adresse und Port ändern | Geänderte Basisadresse mit Add-on-Neustart und persistente Dienstprofile geprüft. Zwei TCP-Ports in der lokalen Testumgebung geprüft. |
| Daten und Einstellungen nach Neustart und Rücksicherung | PostgreSQL-Belege, Qdrant, Präferenzen sowie maskierte Integrations-Credentials im neuen Docker-Volume geprüft. |
| Fehlerhafte Dienstadresse oder Zertifikat | Authentifizierter lokaler Dienst, nicht erreichbarer Port, Redirect-Abwehr, unbekannte CA und falscher Zertifikatsname geprüft. |
| Nicht vertrauenswürdige Forwarded-Header | Middleware mit vertrauenswürdigem und unberechtigtem Peer geprüft, ebenso Header-Überschreibung im HTTPS-Testproxy. |
| Editor, OAuth, Webhooks, WebSockets und SSE von n8n | Separate n8n-Abnahme in dessen Paket. Freigaben des tatsächlichen Google-Projekts und HAOS-Proxy-Abnahme vor Ort offen. |

Die Docker- und Chromium-Smokes verwenden ausschließlich Testdaten und kurzlebige Volumes. Das Netzwerkprofil wurde auf Desktop- und Mobilansicht getestet.

## Integriertes Backend 0.2.0

| Bereich | Nachweis |
| --- | --- |
| Container und Migration | amd64-Build mit PostgreSQL und Qdrant. Der CI-Smoke baut zusätzlich v0.1.0, schreibt einen synthetischen Bestandsdatensatz und prüft dessen Erhalt nach Migration. |
| Dokumente | Acht synthetische Uploads in Markdown, TXT, Digital-PDF, Scan-PDF, DOCX, XLSX, CSV und PNG. Word-Absatz und Docling-Tabelle, Excel-Tabelle und OCR-Belege werden abgefragt. Ein zusätzlicher Vault-Watcher-Fall prüft die Beibehaltung indexierter Quellen bei fehlendem Ordner. |
| Suche | Dauerhafte Chunks, Qdrant-Vektoren, Quellen und Ersatz einer Version. Lokales Reranking, leere Treffer und Fallback bei Modellfehler. Ollama-Protokoll im Backend-Test mit isolierten 1024-dimensionalen Vektoren und synthetischer Antwort. |
| Kompatibilität | Bestehendes n8n-Status- und Schreibformat, Replay, Konflikt, Admin-Lesen, Pagination und getrennte Rollen im Smoke. Generator und 53 n8n-Exporte werden separat geprüft. |
| Betrieb | Chromium Desktop/Mobil, HTTPS-Proxy mit simulierter Ingress-Route, PostgreSQL-Wiederanlauf, kaltes Archiv mit neuem Volume. Der Smoke fordert nach Entfernen der Testprojektion den Indexabgleich über die API an. |
| Sicherheit | Begrenztes Format und Upload, Ressourcenlimits, Ausschluss ungültiger Namen, TLS-Prüfung, Hashbindung. Python-Abhängigkeitsprüfung ohne bekannte Treffer im geprüften Lockfile. |
| Tatsächliche Modelle | Die WDB-RAG-Referenz v1.1.0 protokolliert echte BGE-M3-Vektoren mit 1024 Dimensionen und einen CPU-ONNX-Reranker. Die Add-on-Prüfung benutzt eine Protokoll-Fixture. OpenAI-kompatible externe Dienste und das installierte Ollama des Zielsystems sind gesondert zu testen. |
| Vor Ort offen | Installation über den echten HAOS-Supervisor, vorhandenes Ollama, Zielhardware unter gleichzeitiger Last und HAOS-Wiederherstellungsdialog. |

Die dokumentierten Befehle unter Installation verwenden ausschließlich synthetische Testdaten. Benachrichtigungen und Produktionszugänge sind dafür nicht erforderlich.

[Abnahmelauf in GitHub Actions](https://github.com/firebreakHD/TRC-AI/actions)
