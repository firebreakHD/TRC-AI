# Integrationen und Bestandsaufnahme

| Repository oder Dienst | Geprüfter Stand | Folgeschritt |
| --- | --- | --- |
| `firebreakHD/HermesAI-ha` | `main` bei `f3a796ec1f24241b0fbe440df721d02885222975`, weitere Branches `codex/jarvis-friday-talk`, `codex/nextcloud-talk`, `docs/nextcloud-talk-hermes`, `feature/b1-ha-ingress` | OpenAI-kompatible API auf 8642, API-Schlüssel und Codex-Browserlogin im bestehenden Hermes übernehmen. Authentifizierten Modell- und Texttest planen. |
| `firebreakHD/JARVIS-ala-Busy` | `main` bei `5df427676d9df6678bca890ce7d0c54de9d06b80`, vorhandener Hermes-Chat mit Streaming und Browser-TTS, optional Whisper.cpp | Bestehenden Chat separat weiter nutzen und als Ausgangspunkt für den unabhängigen TRC Chat prüfen. Piper ist eine separate Integration. |
| Nextcloud Talk | `HermesAI-ha/hermes_assistant/talk/` enthält getrennte Pfade für Text, Sprachnachrichten und Anrufe sowie Profile für JARVIS und FRIDAY. | Pro Medienart einen Live-Test durchführen. Für Anrufe beide Audiorichtungen prüfen. |
| Beeper | `HermesAI-ha/hermes_assistant/beeper-desktop.sh` startet eine vorhandene Desktop-Installation. Das Hermes-Repo dokumentiert den Bereitschaftstest der Desktop-API. | Nachrichten-API, Authentifizierung, Netzwerke und Anhänge an der installierten Version prüfen. Eigenständige n8n-Anbindung nach Schnittstellennachweis. |
| MCP und Google | Hermes enthält MCP-Konfiguration und lokale Tools. Das vorgesehene separate MCP-Panel und Google-Arbeitspaket konnten im zugänglichen Bestand keinem eindeutigen Repo zugeordnet werden. `MCPanelHAOS` ist ein Minecraft-Panel. | Repo-Link bzw. tatsächlich verwendete MCP-Endpunkte erfragen. |
| `firebreakHD/MA_Alexa` | Branch `main`, ergänzende Home-Assistant-Sprachintegration | Relevanz und Freigabe vor einer Übernahme klären. |
| Ollama, HA, n8n, Whisper/Piper, Nextcloud WebDAV, Obsidian LiveSync | Kein freigegebener Live-Testzugang in der Arbeitsumgebung | Installierte Versionen, Erreichbarkeit und Piper-Stimmen feststellen. Ein Vault-Dateipfad ist getrennt vom CouchDB-Zugang zu ermitteln. |
