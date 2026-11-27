# TRC Intelligence

TRC Intelligence öffnet nach Anmeldung den Chat. Die Seitenleiste enthält frühere Unterhaltungen, Dokumente und die einklappbare Administration. Auf kleineren Bildschirmen öffnet sich die Leiste über das Menü. Hell, Dunkel und Systemdarstellung sind im Profilbereich wählbar. Der Browser merkt sich die Darstellung und die Navigation.

Nachrichten und Chateinstellungen liegen in einer lokalen SQLite-Datei mit WAL unter /data/config. Die Datei wächst unabhängig von PostgreSQL und Qdrant. Der Zugang gilt für einen lokalen Operator je Installation. Admin- und Chat-Token sind getrennte Berechtigungen desselben Operators. Das Admin-Token verwaltet Dienste und Profile. Das Chat-Token kann Unterhaltungen und freigegebene Werkzeuge verwenden. Den Workflow-Token verwendet allein die Integrations-API.

Chats lassen sich erstellen, durchsuchen, umbenennen, archivieren und löschen. Admin-Funktionen sind zusätzlich serverseitig geschützt. Ein Chat erhält einen Assistenten und einen Modus. Für Modellanfragen wird eine begrenzte Zahl vorheriger Nachrichten verwendet. Laufende Modellanfragen können abgebrochen werden. Ein Neustart markiert nicht abgeschlossene Anfragen als unterbrochen. Schreibaktionen können nach einer unklaren Ausführung nicht automatisch wiederholt werden.

Dateien können vor dem Absenden per Plus oder Drag-and-drop ausgewählt werden. Nach dem Senden zeigt die Oberfläche Upload und Verarbeitung. Ein privater Anhang speichert extrahierte Ausschnitte nur im aktuellen Chat. Beim Löschen des Chats werden diese Ausschnitte mitgelöscht. Rohdateien des privaten Uploads werden nach der Extraktion verworfen. Ungebundene Anhänge werden automatisch nach einem Tag beim nächsten Upload bereinigt. Bis zu vier Anhänge je Nachricht und 30 je Chat sind möglich. Größe und OCR richten sich nach den vorhandenen Grenzen.

Ein dauerhaft gespeicherter Anhang erfordert das Admin-Token und eine bewusste Auswahl. Er nutzt den vorhandenen Dokument-Worker mit Prüfsumme, Quelldatei und globalem Index. Entfernen eines Chats verändert die globale Dokumentbibliothek nicht. Eine Nachfrage zu einem dauerhaften Anhang kann erst nach seiner Indexierung Belege daraus abrufen.

Ollama sendet Text über seine Streaming-API. Die Oberfläche liest Zwischenstände während der Generierung. Wissensantworten und ihre Quellen werden nach Prüfung der Quellenmarken zusammen angezeigt.

[Routing](ROUTING.md) · [Administration](ADMINISTRATION.md)
