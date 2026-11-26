# Konfiguration

| Einstellung | Ort | Format |
| --- | --- | --- |
| `admin_token` | HAOS-Optionen | Zufallswert mit 32–128 Zeichen aus `A–Z a–z 0–9 _ -`, Neustart erforderlich |
| `workflow_token` | HAOS-Optionen | Separater Zufallswert im selben Format, leer deaktiviert den Import, Neustart erforderlich |
| Port | HAOS-Netzwerk | Optionaler Host-Port zu Container-Port 8099 |
| Aktualisierungsintervall | Control Center → System | 5 bis 120 Sekunden, Standard 15 |

Das Backend liefert das versionierte Einstellungsschema an die Oberfläche. Bei Speicherung wird eine validierte Datei atomar ausgetauscht. Bei einer bereits beschädigten Datei liefert das Control Center validierte Standardwerte. Die Datei bleibt bis zur nächsten gültigen Speicherung für die Diagnose erhalten.

Ressourcenstatus und eigentliche Limits sind getrennt. PostgreSQL läuft mit 64 MiB Shared Buffers und maximal 20 Verbindungen. Linux-Systemspeicher, Systemlast und sichtbare logische CPUs stellen keine zugesicherte Container-Kapazität dar.
