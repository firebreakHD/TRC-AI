# Architektur

Die Quellen lesen öffentliche oder freigegebene APIs und normalisieren Belege. Der Persistenz-Unterworkflow stellt optionale TRC-Importe in die Data Table, aktualisiert anschließend den Cache und speichert zuletzt den Cursor. Der Queue-Worker sendet über die dokumentierte TRC-API. Ausfälle können unabhängig von Abrufen, Cache und Berichten verarbeitet werden. Journal, Cache und Zustellungen bleiben bei n8n-Neustarts im selben Profil erhalten.

Pro Batch höchstens 100 Belege und 512 KiB. Deterministische IDs stammen aus Bereich und den tatsächlichen Body-Bytes. Eine für `pending` fällige Zeile wird seriell verarbeitet. Begrenzte Wiederholung mit Backoff gilt für Transportfehler, temporäre HTTP-Fehler und Rate Limits. Permanente Konflikte und ungültige Daten landen in `dead`. Nach Sichtprüfung löscht ein manueller Retry weder UUID noch Body. Aufräumen betrifft zeitlich abgelaufene Cache- und abgeschlossene Einträge.

Eine freigegebene Schreibaktion reserviert die Anforderungs-ID vor der Übertragung, damit Ausfälle nicht zu wiederholten Nachrichten führen. Bei Transportabbrüchen oder unklaren Antworten bleibt der Ausgang prüfpflichtig. Fallback kommt erst nach expliziter Ablehnung infrage. Deduplizierung setzt genau einen produktiven n8n-Worker und getrennte manuelle Schreibausführungen voraus.

Die Vertragskopien unter `contracts/` stammen aus `firebreakHD/TRC-AI` bei Revision `4841fec`. n8n-Workflow-Nodes verwenden die dokumentierten Schnittstellen bzw. Node-Parameter der gepinnten Version. Es wurde kein Quellcode aus Fremdprojekten übernommen.
