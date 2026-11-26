# Fehlerbehebung

| Ergebnis | Prüfung |
| --- | --- |
| Unbekannte Data Table | Bootstrap im laufenden Editor des Zielprojekts starten. Workflow und Tabellen müssen im selben Projekt liegen. |
| Subworkflow fehlt | ID und Zielprojekt anhand des Manifests prüfen, im Editor neu verknüpfen und Unterworkflows zuerst veröffentlichen. |
| Keine geplanten Abrufe | Freigabe in der Config und Veröffentlichung des Schedule Triggers prüfen. |
| Code-Node scheitert am Import von crypto oder url | Built-in-Allowlist des tatsächlich verwendeten JavaScript-Runners prüfen und den Runner neu starten. |
| TRC-Auftrag bleibt pending | `next_at`, Statuscode, interne URL und Workflow-Credential prüfen. Die Body-Kopie beibehalten. |
| Dauerhaft fehlerhafter Import | Status in `queue-status` prüfen. Bei korrigierter Umgebung den Auftrag über `queue-retry` freigeben. Bei fehlerhaftem Body einen neu erzeugten Auftrag mit neuem Schlüssel verwenden. |
| OAuth-Callback nach Umzug veraltet | Die im Credential angezeigte Redirect URL beim OAuth-Anbieter eintragen und bei Bedarf neu autorisieren. |
| Unerwartete Versandantwort | Ziel auf eine bereits zugestellte Nachricht prüfen. `uncertain` wird nicht automatisch erneut versendet. |
