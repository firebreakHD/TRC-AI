# Performance

Die erste Messreihe betrifft ausschließlich das ruhende Add-on in der Docker-Testumgebung. Der Smoke-Test gibt die CPU- und RAM-Anzeige von `docker stats` aus. Diese Messung enthält PostgreSQL, Qdrant, Supervisor und API. Inferenz und Dokumentenverarbeitung fehlen im Entwicklungsstand 0.1.0.

Für Messungen auf dem Fujitsu zunächst den HA-Leerlauf erfassen, anschließend das Add-on und jeweils eine reale Last starten. Bei der späteren Assistenzmessung Routing, Datenbank, Embedding, Retrieval, Reranking, Generierung, STT, TTS und End-to-End-Latenz separat festhalten. Der Nutzerbericht von etwa 20 Minuten beantwortet keine Benchmarkfrage.
