# Änderungsverlauf

## 0.1.0

- amd64-Entwicklungsgrundlage für HAOS mit Control Center und separaten Administrations- und Workflow-Tokens.
- PostgreSQL 18 über einen lokalen Socket, versionierte Migration und persistentes Datenverzeichnis. Qdrant 1.18.0 ist ausschließlich über Loopback erreichbar.
- Versionierte Status- und Workflow-Import-API mit transaktionaler Deduplizierung, Konflikterkennung und OpenAPI-Vertrag.
- Tests für Build, Start, Neustart, Persistenz und kalte Rücksicherung beider Datenbanken im Docker-Container.
