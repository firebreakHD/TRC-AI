# Funktionen in 0.1.0

| Bereich | Stand |
| --- | --- |
| Control Center | Anmeldung, Übersicht mit PostgreSQL- und Qdrant-Status, CPU-Sichtbarkeit, Systemlast, RAM und freiem Speicher, persistentes Abfrageintervall |
| Dienstlaufzeit | Drei Prozesse, Healthcheck, geordneter Stopp und PostgreSQL-Wiederanlauf |
| Datenbank | PostgreSQL 18 mit transaktionalen Migrationen, Qdrant 1.18.0 mit persistenter Ablage und Loopback-Schnittstelle |
| n8n-Vertrag | Authentifizierter Status und generischer Import in neun Bereiche, Idempotenz und Zeitstempelprüfung |
| Backup | HAOS-Metadaten für kalte Sicherung, Rücksicherung mit einem lokalen Docker-Datenvolume geprüft |
| Erweiterungen | Wissenssuche, Chat, Gedächtnis, Sprach- und sonstige Live-Integrationen sowie Berichte folgen |
