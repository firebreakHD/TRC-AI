# Testbericht

Hier werden Docker- und HAOS-Tests getrennt erfasst.

HAOS-Live-Tests stehen aus. Das betrifft die Installation durch Supervisor, den Ingress, Update-Migration, die Rücksicherung des Supervisor-Backups und die Zielhardware-Messung. RAG, Qdrant, Chat, Ollama, Hermes, MCP, n8n-Workflows, Sprachdienste und Telefonie sind in der laufenden Zielumgebung noch nicht geprüft. Der Docker-Test für die Workflow-HTTP-API verwendet echte PostgreSQL-Transaktionen.
