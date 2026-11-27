# TRC-AI 0.2.0

Setze vor dem ersten Start ein zufälliges `admin_token` mit 32–128 Zeichen aus Buchstaben, Ziffern, Unterstrich und Bindestrich. Ein eigenes `workflow_token` ermöglicht den n8n-Import. Leere oder ungültige Tokens deaktivieren die jeweils geschützte Schnittstelle. Änderungen an Tokens werden beim Neustart übernommen.

Öffne das Control Center über die Home-Assistant-Seitenleiste und melde dich mit dem Administrations-Token an. Der direkte Netzwerkport ist standardmäßig deaktiviert. Für einen externen n8n-Zugriff den Port nur in einem vertrauenswürdigen Dienstnetz oder hinter einem HTTPS-Reverse-Proxy aktivieren.

Home Assistant erstellt ein kaltes Add-on-Backup und stoppt TRC-AI während der Sicherung. Die Datenbanken liegen unter `/data/postgresql` und `/data/qdrant`. Der Dokumentenindex und der eigenständige Assistenz-Chat folgen in späteren Entwicklungsständen.

Konfiguration von LAN, VPN, Ingress, Reverse Proxy und Dienstprofilen siehe [Netzwerk und Integrationen](https://github.com/firebreakHD/TRC-AI/blob/main/docs/NETWORK.md).

Im Control Center das vorhandene Ollama unter **Netzwerk und Integrationen** hinterlegen. Das Modell bge-m3 muss für die Indexierung erreichbar sein. Eine Datei unter **Dokumente** hochladen und nach der Indexierung in **Wissensdatenbank** suchen. 8099 ist der interne Port. Für LAN-Zugriff optional einen freien HAOS-Host-Port wählen.
