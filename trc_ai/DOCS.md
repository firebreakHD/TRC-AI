# TRC-AI 0.1.0

Setze vor dem ersten Start ein zufälliges `admin_token` mit 32–128 Zeichen aus Buchstaben, Ziffern, Unterstrich und Bindestrich. Ein eigenes `workflow_token` ermöglicht den n8n-Import. Leere oder ungültige Tokens deaktivieren die jeweils geschützte Schnittstelle. Änderungen an Tokens werden beim Neustart übernommen.

Öffne das Control Center über die Home-Assistant-Seitenleiste und melde dich mit dem Administrations-Token an. Der direkte Netzwerkport ist standardmäßig deaktiviert. Für einen externen n8n-Zugriff den Port nur in einem vertrauenswürdigen Dienstnetz oder hinter einem HTTPS-Reverse-Proxy aktivieren.

Home Assistant erstellt ein kaltes Add-on-Backup und stoppt TRC-AI während der Sicherung. Die Datenbanken liegen unter `/data/postgresql` und `/data/qdrant`. Der Dokumentenindex und der eigenständige Assistenz-Chat folgen in späteren Entwicklungsständen.
