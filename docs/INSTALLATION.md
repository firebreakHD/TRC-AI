# Installation

## Privates HAOS-Repository

1. Das Archiv des gewünschten GitHub-Releases mit einem berechtigten Konto herunterladen. Den darin enthaltenen Ordner `trc_ai` in den HAOS-Ordner für lokale Add-ons kopieren. Beispielsweise ist das die Freigabe `addons` des Samba-Add-ons.
2. In Home Assistant **Einstellungen → Apps** öffnen. Den Store aktualisieren, **TRC-AI** unter den lokalen Apps öffnen und installieren. Ältere HA-Versionen nennen den Bereich **Add-ons**.
3. Das Administrations-Token in der Add-on-Konfiguration setzen. Beispielsweise erzeugt `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'` einen passenden zufälligen Wert. Für n8n einen zweiten, unabhängigen Wert erzeugen.
4. Starten und im Menü **TRC Control Center** öffnen. Das Administrations-Token eingeben. Die Statusseite muss eine PostgreSQL-Version und aktuelle Ressourcenwerte anzeigen.

Für Updates aus dem privaten Repository den App-Ordner durch den Ordner des neueren Releases ersetzen und im Store die Metadaten neu laden. Das persistente `/data` im Supervisor gehört zur App und bleibt beim Update getrennt vom Quellordner. Vor Updates ein kaltes Add-on-Backup anlegen.

Falls das Repository später für die Supervisor-Instanz lesbar ist, kann die Repository-URL im Add-on-Store eingerichtet werden. Der Direktzugriff auf die API über den Host-Port 8099 ist standardmäßig deaktiviert. Für interne Verbindungen zum App-Host oder einen Reverse-Proxy den [n8n-Leitfaden](N8N_INTEGRATION.md) verwenden.

## Lokale Prüfung

```sh
docker build --platform linux/amd64 -t trc-ai:0.1.0 trc_ai
bash tests/smoke.sh
```

Bei verwalteter TLS-Inspektion kann der lokale CA-Verbund über das BuildKit-Secret `--secret id=pip_ca,src=/etc/ssl/certs/ca-certificates.crt` übergeben werden. Das Zertifikatsbündel wird dabei nicht im Image gespeichert.
