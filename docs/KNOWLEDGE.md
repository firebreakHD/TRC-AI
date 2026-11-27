# Wissensdatenbank und Dokumentverarbeitung

## Inbetriebnahme

1. In Home Assistant eine kalte Sicherung der bestehenden App anlegen. Beim Upgrade die bisherigen Tokens, die Netzwerkeinstellungen und das Datenverzeichnis beibehalten.
2. Im Control Center unter **Netzwerk und Integrationen** das bestehende Ollama als Dienst aktivieren und seine **interne** Basis-URL eintragen. Die Verbindung testen. In Ollama muss `bge-m3` bereits verfügbar sein. Die Standardeinstellung erwartet 1024 Dimensionen. Das Add-on installiert keine Modelle in Ollama.
3. Im Bereich **Dokumente** eine Testdatei hochladen. Bei Bedarf den Worker-Status unter **Dienste und Datenbanken** aktualisieren. Sobald das Dokument indexiert ist, einen charakteristischen Begriff in **Wissensdatenbank** suchen.
4. Für generierte Antworten zusätzlich ein bereits verfügbares Modell in `rag_chat_model` eintragen und die App neu starten. Die Auswahl für Ollama übernimmt das vorhandene Dienstprofil. Für `openai_compatible` das separate Profil **OpenAI-kompatible LLM-Fassade** mit Basisadresse und Berechtigung konfigurieren. Die Fassade nutzt dann `/v1/chat/completions`. Erst das Ankreuzen von **Antwort mit konfiguriertem Modell erzeugen** sendet die ausgewählten Belege an diesen Antwortanbieter. Dokumente und Suchanfragen werden für Embeddings an das konfigurierte Ollama gesendet.

Der Host-Port ist standardmäßig aus. Nutze den Admin-Ingress auch wenn Nextcloud den HAOS-Hostport 8099 belegt. Für den optionalen direkten Zugriff wählst du unter **Netzwerk** einen nachweislich freien Host-Port, beispielsweise 18099. Der interne Listener im Add-on bleibt bei 8099. Für internen Zugriff anderer Add-ons kann der private Add-on-Hostname verwendet werden. Nur für Clients außerhalb des privaten Netzes ist eine geeignete Weiterleitung erforderlich. [Netzwerk](NETWORK.md)

## Dokumentquellen

| Quelle | Konfiguration |
| --- | --- |
| Upload | Private, persistente Ablage unter `/data/documents`. Über die UI oder einen authentifizierten binären PUT hochladen. |
| Lokales Dokumentverzeichnis | `rag_shared_dir` als relativen Unterordner unter dem schreibgeschützten `/share` angeben. Aktivierung nach Add-on-Neustart. |
| Obsidian-Vault | Aus einem lokalen Vault-Ordner ein lesbares Abbild in den gewählten `/share`-Unterordner bereitstellen. LiveSync/CouchDB dient weiterhin dem separaten Abgleich. Der Status der CouchDB sagt nichts über die Extraktion verschlüsselter oder fragmentierter Notizen aus. |
| Nextcloud | Dateien in den lokalen Eingangsordner spiegeln oder aus einer freigegebenen WebDAV-Verbindung über die Upload-API übergeben. Eine spätere direkte Synchronisation kann über dieselbe Pfad-/Hash-Schnittstelle einsortiert werden. |

Dateiformate sind Markdown, UTF-8 TXT, digitale PDFs, Scan-PDFs, DOCX, XLSX, CSV/TSV und einzelne PNG-, JPEG- und TIFF-Bilder. Bei DOCX extrahiert Docling Slim Struktur und Tabellen. XLSX wird im Read-only-Modus und mit gespeicherten Tabellenwerten verarbeitet. Ein optional konfiguriertes Docling Serve verarbeitet **digitale PDFs** über `POST /v1/convert/file`. Ohne aktives externes Profil bleiben digitale PDFs vollständig lokal. Scanseiten werden mit Poppler gerastert und mit Tesseract verarbeitet.

Ein stabiler relativer Pfad und SHA-256 identifizieren eine Dokumentversion. Bei erneutem Upload derselben Version bleibt der Auftrag einmalig. Der Worker übernimmt neue Versionen transaktional. Der vorherige erfolgreiche Stand bleibt verfügbar, bis die neue Version fertig ist. Vorübergehend fehlende Quellen löschen keine Belege. Letzte Fehler und Wiederholung stehen unter **Dokumente** bereit.

## Betrieb und Grenzen

- Ein Dokumentauftrag gleichzeitig. BGE-M3 standardmäßig mit vier Segmenten pro Batch. Ein Upload und eine Wissensabfrage gleichzeitig.
- Upload standardmäßig 20 MiB, einstellbar bis 32 MiB. Private Upload-Ablage standardmäßig 1 GiB. Der lesende Ordner verarbeitet bis zu 4000 Kandidaten je Durchlauf.
- PDF bis 150 Seiten und maximal 12 OCR-Seiten je Auftrag. Lokaler Parser mit 1 GiB Adressraum und höchstens 205 Sekunden Laufzeit. OCR rastert höchstens 2400 px an der langen Bildseite pro PDF-Seite. Office-Dateien werden vor der Extraktion begrenzt.
- PostgreSQL läuft mit 256 MiB `shared_buffers` und höchstens 20 Verbindungen. Die räumliche Begrenzung der Gesamtdatenmenge hängt zusätzlich von der Kapazität des persistenten Datenträgers ab.
- Native Volltextsuche liefert Sparse-Treffer. Qdrant liefert Cosine-Treffer aus den normalisierten Dense-Vektoren. RRF führt beide zusammen. Standardmäßig sortiert ein CPU-Textvergleich die begrenzte Kandidatenliste nach. Optional kann ein vertrauenswürdiger Cross-Encoder mit JSON-Route `POST /rerank` als Dienst `reranker` konfiguriert werden, etwa der separat dokumentierte CPU-ONNX-Reranker der Referenz. Ausgaben enthalten Pfad, Abschnitt, Chunks, Sprache und Quellenmarken.
- Bei Ollama- oder Qdrant-Ausfall zeigt die Suche weiterhin bereits indexierte lexikalische Treffer. Modellantworten können fehlen. Das Backend liefert einen Status und verfügbare Belege. Ungültige Quellenmarken werden abgelehnt.
- Das eingetragene Embedding-Modell und die Dimension werden im Index festgehalten. Für einen Wechsel mit bestehenden Dokumenten braucht es eine geplante Neuindexierung mit Modellmigration. Ein unabsichtliches Zusammenmischen verschiedener Vektoren wird verhindert.

**Qdrant-Index abgleichen** stellt fehlende Punkte aus PostgreSQL wieder her und entfernt veraltete Punkte. Der Abgleich läuft asynchron im gleichen Worker. Eine gestartete Verarbeitung wird beim Pausieren konsistent zu Ende geführt oder bei erzwungenem Abbruch über die zeitlich begrenzte Auftragslease erneut aufgenommen.

[Ollama Embeddings](https://docs.ollama.com/api/embed) · [BGE-M3](https://huggingface.co/BAAI/bge-m3) · [Docling](https://docling-project.github.io/docling/) · [Docling Serve](https://github.com/docling-project/docling-serve)

In TRC Intelligence kann ein Chat aus einem indexierten Dokument gestartet werden. Diese Unterhaltung begrenzt Wissensanfragen auf den ausgewählten Dokumentpfad. Private Chat-Anhänge werden ausschließlich im Chat verarbeitet. Dauerhafte Anhänge gehen nach bestätigter Auswahl in die vorhandene Indexierung.
