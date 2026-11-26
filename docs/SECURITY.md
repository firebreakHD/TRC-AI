# Sicherheit

Das API-Paket läuft als eigener, unprivilegierter Benutzer. PostgreSQL lauscht nur am lokalen Unix-Socket und akzeptiert die zugeordnete lokale Rolle über Peer-Authentifizierung. Qdrant läuft unter einer eigenen Systemkennung, bindet nur an IPv4-Loopback und deaktiviert gRPC, Clusterbetrieb und Telemetrie. Der Supervisor besitzt die für den lokalen Benutzerwechsel nötigen Rechte. Privilegierte Add-on-Optionen, Host-Netzwerk und Zugriff auf den Docker-Socket sind nicht erforderlich.

Jede geschützte API prüft ein Rollen-Token. Das Workflow-Token kann Workflow-Daten einliefern und Status lesen. Das Administrations-Token verwaltet Einstellungen und liest Status. HAOS speichert die Token als Add-on-Optionen. Zur Laufzeit liegt die Kopie nur in einer Datei mit Lesezugriff für die Anwendung. Die Oberfläche hält das eingegebene Token im Arbeitsspeicher der Seite.

Begrenzte JSON-Requests, parametrisierte SQL-Abfragen, eine Content Security Policy und die Verwendung von Textknoten für UI-Werte reduzieren die Angriffsfläche. Reine Status- und Fehlercodes werden ohne ungeprüfte Payloads an Clients ausgegeben. Workflow-Inhalte werden als Daten gespeichert. Automatische Kommunikation und die Ausführung externer Aktionen sind in dieser Version nicht implementiert.

Den Direktport ausschließlich in einem isolierten Dienstnetz oder hinter HTTPS bereitstellen. Sicherungen enthalten private Daten und möglicherweise Token. Speicher und Zugriff entsprechend absichern.
