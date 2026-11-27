# Datenquellen

| Quelle | Zugriff und Aktualität |
| --- | --- |
| Massive Stocks Basic | API-Key und persönliche Nutzung gemäß Gratisplan. US-Tagesaggregate, bis zu zwei Jahre Historie und höchstens fünf Abfragen pro Minute. Keine Echtzeitkurse. [Tarif](https://massive.com/pricing?product=stocks) |
| Kraken | Öffentliche OHLC-Daten; nur abgeschlossene Tageskerzen. Der OHLC-Endpunkt liefert höchstens 720 Kerzen. [API](https://docs.kraken.com/api/docs/rest-api/get-ohlc-data) |
| EZB | Offizielle Tagesreferenzkurse mit Kurstyp, Quelle und Datum. Für die EUR-Berechnung wird der letzte Kurs am oder vor dem Kursdatum verwendet. [Datenportal](https://data-api.ecb.europa.eu/) |
| Gold API | Spotwerte für XAU und XAG in USD je Feinunze. [API](https://gold-api.com/docs) |
| Standard Bullion | Historische Schlusswerte und indikative Großhandels-Geld-/Briefkurse für Gold/Silber; mit Anbieter und Zeitpunkt ausgeben. Keine verbindlichen Bestellpreise. [API und Attribution](https://standardbullion.com/gold-price-api) |
| RSS/Atom | Offizielle Feeds in [providers.example.json](../config/providers.example.json). Nur Metadaten, Titel, Links, Zeitpunkt und begrenzter Auszug. |
| arXiv | Öffentliche Atom-API für konfigurierbare Forschungsgebiete, mit begrenzter Abfragerate. [API](https://info.arxiv.org/help/api/user-manual.html) |

Gold und Silber verwenden 31,1034768 g pro Feinunze. Historische Renditen verwenden vergleichbare Kursarten und Zeitabstände. Fehlende Vergleichskurse oder Wechselkurse bleiben sichtbar. Händler- und Spotkurse werden getrennt geführt.
