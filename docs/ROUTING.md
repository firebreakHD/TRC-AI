# Anfrage-Routing

| Route | Daten und Freigabe |
| --- | --- |
| Allgemeine KI | Modell aus dem Profil oder den Add-on-Optionen, sonst qwen3:4b-instruct über Ollama. |
| Wissensdatenbank | Vorhandene Hybridabfrage in PostgreSQL und Qdrant mit Quellen. Ein Chat aus der Dokumentbibliothek begrenzt die Suche auf den ausgewählten Pfad. |
| Dokumente | Anhänge desselben Chats oder bewusst dauerhaft veröffentlichte, eindeutig versionierte Dokumente. |
| Märkte | Kontrollierte SQL-Abfragen, Zeitstempel, Quelle, Währung, Einheit und Hinweis zur Aktualität. Historische Vergleiche erfordern dieselbe Quelle und Kursart. |
| Nachrichten, Forschung, Berichte und System | Letzte importierte Datensätze aus dem entsprechenden Workflow-Bereich. |
| Home Assistant | Ausschließlich freigegebene Zustandsentitäten. Schalten von freigegebenen Lichtern erfordert eine Bestätigung. |
| n8n | Optionaler, ausdrücklich konfigurierter Bericht-Webhook. Ausführung braucht Bestätigung und meldet die Annahme durch n8n. |
| Hermes | Vorhandener Gateway-Endpunkt mit OpenAI-kompatiblem Chat-Vertrag. Aktivierung separat je Assistentenprofil. |

Regeln verwenden den Modus, die Frage, einfache Schlüsselbegriffe, aktuelle Anhänge und den begrenzten Chatkontext. Dokumente und Modellantworten können keine neuen Aufrufe freigeben. Die App sendet keine Werkzeugdefinitionen mit Modellanfragen. Nur serverseitig validierte Aktionen werden ausgeführt. Türen, Alarme und weitere Geräteservices haben in dieser Version ausschließlich lesende Funktionen, soweit ihre Entitäten freigegeben sind.

Fehlende Daten, fehlende Freigaben und nicht erreichbare Dienste ergeben einen nachvollziehbaren Status. Allgemeine Ollama- und Home-Assistant-Anfragen innerhalb der laufenden App brauchen keine laufende Wissensdatenbank. Bei einem vollständigen TRC-Stopp stehen die separat eingerichteten Home-Assistant- und Ollama-Schnittstellen weiter bereit. Ein zusätzliches TRC-Add-on ist für diesen Entwicklungsstand nicht erforderlich.

Codex bleibt eine spätere Integration. Die vorhandene Hermes-Konfiguration wird ausschließlich über das bestehende Gateway eingebunden.

[API-Vertrag](../contracts/openapi.yaml)
