# Performance

Die erste Messreihe betrifft ausschließlich das ruhende Add-on in der Docker-Testumgebung. Der Smoke-Test gibt die CPU- und RAM-Anzeige von `docker stats` aus. Diese Messung enthält PostgreSQL, Qdrant, Supervisor und API. Inferenz und Dokumentenverarbeitung fehlen im Entwicklungsstand 0.1.0.

In der lokalen Docker-Umgebung ergab ein Messpunkt im Leerlauf 256,8 MiB addierte Prozess-RSS und 1,24 % CPU laut Docker. Addierte RSS kann gemeinsam belegte Seiten mehrfach zählen. Docker zeigte gleichzeitig 7,495 GiB Speichernutzung. Die erhebliche Abweichung erlaubt aus diesem Lauf keine belastbare Aussage zum isolierten Gesamtbedarf. Für den Fujitsu liegen noch keine Messdaten vor.

Für Messungen auf dem Fujitsu zunächst den HA-Leerlauf erfassen, anschließend das Add-on und jeweils eine reale Last starten. Bei der späteren Assistenzmessung Routing, Datenbank, Embedding, Retrieval, Reranking, Generierung, STT, TTS und End-to-End-Latenz separat festhalten. Der Nutzerbericht von etwa 20 Minuten beantwortet keine Benchmarkfrage.

0.2.0 verwendet im Standard 256 MiB PostgreSQL-Puffer, 20 Datenbankverbindungen, einen Dokumentjob und Embedding-Batches von vier Segmenten. Der isolierte Parser hat eine Adressraumgrenze von 1 GiB. Modellgröße und Modelllaufzeit hängen vom externen Ollama ab. Messungen unter gleichzeitiger Last am Fujitsu stehen aus.
