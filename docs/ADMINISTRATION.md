# Administration

Das Administrationsmenü ist standardmäßig geschlossen. Es enthält das vorherige Control Center mit Systemübersicht, Dienstprofilen, Ressourcen, Modellen, Datenbanken, Indexabgleich und Backup-Hinweisen. Die Dokumentbibliothek und Wissenssuche sind für Administratoren direkt in der Seitenleiste erreichbar.

**Routing und Assistenten** verwaltet Kontextlänge, Anfragezeit, Profile und erlaubte Ziele. Für Zustandsabfragen je Zeile Alias und Entitäts-ID erfassen, beispielsweise Wohnzimmerlicht = light.wohnzimmer. Schaltfreigaben sind auf die ausdrücklich aufgeführten Licht-Entitäten beschränkt. Der Dienst Home Assistant muss unter Netzwerk und Integrationen gewählt und mit einem gültigen Diensttoken konfiguriert sein. Die Aktion bestätigt der Operator pro Nachricht.

Ein n8n-Webhook wird unter Routing und Assistenten mit dem genauen Pfad eingetragen. Basis-URL und Zugangsdaten stehen im bestehenden n8n-Dienstprofil. Der Webhook arbeitet unabhängig von der Importwarteschlange. In der Routing-Historie erscheinen nur Route, Zustand und Zeitpunkt.
