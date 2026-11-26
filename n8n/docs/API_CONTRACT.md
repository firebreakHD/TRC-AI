# TRC Workflow API

Die Workflows verwenden nur `GET /api/v1/system/status` und `POST /api/v1/workflow/records/{area}`. Anmeldung per separatem Workflow-Token. Der POST nutzt `Content-Type: application/json` und `Idempotency-Key`. Der Body ist durch den bestehenden Vertrag definiert.

[OpenAPI 0.1.0](../contracts/openapi.yaml) · [Workflow-Vertrag](../contracts/workflow-contract.md) · [Aufgabenbeispiel](../contracts/examples/tasks.json)
