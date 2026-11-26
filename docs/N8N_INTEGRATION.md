# n8n anbinden

1. Im Add-on ein eigenes `workflow_token` konfigurieren und das Add-on neu starten. Für den Datenimport eine dedizierte n8n-Credential mit dem Header `Authorization: Bearer …` anlegen.
2. Aus der n8n-Laufzeit die Erreichbarkeit von `GET /api/v1/system/status` prüfen. Der Zielserver muss aus dem n8n-Netz erreichbar sein. Für Zugriff außerhalb eines isolierten Dienstnetzes einen HTTPS-Reverse-Proxy einsetzen. Home-Assistant-Ingress dient dem Browserzugang.
3. Beim HTTP-Request-Knoten JSON, `POST /api/v1/workflow/records/tasks` und den Header `Idempotency-Key` konfigurieren. Den Body und dessen UUID gemeinsam behalten. Beim Retry denselben Request wiederverwenden.
4. Mit einem Testdatensatz aus dem [Vertrag](../contracts/workflow-contract.md) beginnen. Zweimal dieselbe UUID senden. Beide Antworten müssen dasselbe Ergebnis melden.

Der Workflow-Vertrag umfasst zunächst Import und Status. Nachrichtenversand und Home-Assistant-Aktionen laufen unabhängig. Praktische Tests mit n8n und den Workflow-Dateien erfolgen in der Testumgebung, sobald sie verfügbar sind.
