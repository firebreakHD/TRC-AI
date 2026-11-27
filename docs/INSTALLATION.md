# Installation

## GitHub-App-Store

1. Öffne in Home Assistant **Einstellungen → Apps → App-Store → ⋮ → Repositories**. Füge `https://github.com/firebreakHD/TRC-AI#codex/backend-integration` hinzu, falls TRC-AI aus diesem Kanal noch fehlt. Für ein Update behältst du den vorhandenen Repository-Eintrag bei.
2. Aktualisiere den Store. Öffne **TRC-AI** und installiere oder aktualisiere die App.
3. Setze bei einer Neuinstallation ein Administrations-Token. `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'` erzeugt einen passenden Wert. Für n8n ist ein zweiter, unabhängiger Wert vorgesehen. Ein drittes Token ermöglicht optional einen eigenen Chat-Zugang.
4. Starte die App und öffne TRC Intelligence über die Home-Assistant-Seitenleiste.

[Upgrade](UPGRADE.md) · [Wissensdatenbank einrichten](KNOWLEDGE.md)

## Lokale Installation für isolierte Tests

1. Das Archiv des gewünschten GitHub-Releases mit einem berechtigten Konto herunterladen. Den darin enthaltenen Ordner `trc_ai` in den HAOS-Ordner für lokale Add-ons kopieren. Beispielsweise ist das die Freigabe `addons` des Samba-Add-ons.
2. In Home Assistant **Einstellungen → Apps** öffnen. Den Store aktualisieren, **TRC-AI** unter den lokalen Apps öffnen und installieren. Ältere HA-Versionen nennen den Bereich **Add-ons**.
3. Das Administrations-Token in der Add-on-Konfiguration setzen. Beispielsweise erzeugt `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'` einen passenden zufälligen Wert. Für n8n einen zweiten, unabhängigen Wert erzeugen.
4. Starten und im Menü **TRC Control Center** öffnen. Das Administrations-Token eingeben. Die Statusseite muss eine PostgreSQL-Version und aktuelle Ressourcenwerte anzeigen.

Nach dem Start das vorhandene Ollama unter **Netzwerk und Integrationen** hinterlegen und ein Testdokument hochladen. [Wissensdatenbank einrichten](KNOWLEDGE.md)

Für Updates aus dem privaten Repository den App-Ordner durch den Ordner des neueren Releases ersetzen und im Store die Metadaten neu laden. Das persistente `/data` im Supervisor gehört zur App und bleibt beim Update getrennt vom Quellordner. Vor Updates ein kaltes Add-on-Backup anlegen.

HAOS-Ingress belegt keinen HAOS-Host-Port. Unter **Netzwerk** kannst du einen freien Host-Port für direkten Zugriff zuordnen. Für interne Verbindungen zum App-Host oder einen Reverse-Proxy gilt der [n8n-Leitfaden](N8N_INTEGRATION.md).

## Lokale Prüfung

```sh
docker build --platform linux/amd64 -t trc-ai:0.3.0 trc_ai
bash tests/smoke.sh
```

Bei verwalteter TLS-Inspektion kann der lokale CA-Verbund über das BuildKit-Secret `--secret id=pip_ca,src=/etc/ssl/certs/ca-certificates.crt` übergeben werden. Das Zertifikatsbündel wird dabei nicht im Image gespeichert.
