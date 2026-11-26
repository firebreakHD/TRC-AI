"""Read the configured public endpoints without account credentials."""
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlencode
from xml.etree import ElementTree

CONFIG = Path(__file__).resolve().parents[1] / "config/providers.example.json"
NOW = dt.date.today()
ECB = urlencode({"format": "csvdata", "startPeriod": NOW - dt.timedelta(days=12)})
ARXIV = urlencode({"search_query": "cat:cs.AI", "max_results": 2})


def structured(data, field):
    return isinstance(json.loads(data).get(field), (int, float, str, list, dict))


def xml(data, names):
    return ElementTree.fromstring(data).tag.split("}")[-1] in names


def test(check):
    name, url, verify = check
    curl = subprocess.run(["curl", "--silent", "--show-error", "--fail", "--max-time", "24",
                           "--write-out", "\n%{http_code}", url], capture_output=True, check=False)
    body, _, code = curl.stdout.rpartition(b"\n")
    try:
        result = curl.returncode == 0 and code == b"200" and verify(body)
    except (ValueError, ElementTree.ParseError):
        result = False
    return name, code.decode(errors="replace"), result


checks = [
    ("Kraken BTC", "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440",
     lambda b: structured(b, "result") and not json.loads(b).get("error")),
    ("EZB USD/EUR", "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?" + ECB,
     lambda b: b"OBS_VALUE" in b and len(b.splitlines()) > 1),
    ("Gold API XAU", "https://api.gold-api.com/price/XAU", lambda b: structured(b, "price")),
    ("Gold API XAG", "https://api.gold-api.com/price/XAG", lambda b: structured(b, "price")),
    ("Standard Bullion XAU", "https://standardbullion.com/api/v1/market/history?metal=XAU&range=1y",
     lambda b: structured(b, "points") and structured(b, "attribution")),
    ("Standard Bullion XAG", "https://standardbullion.com/api/v1/market/history?metal=XAG&range=1y",
     lambda b: structured(b, "points") and structured(b, "attribution")),
    ("Standard Bullion Händler", "https://standardbullion.com/spot-prices.json",
     lambda b: structured(b, "metals")),
    ("arXiv", "https://export.arxiv.org/api/query?" + ARXIV, lambda b: xml(b, {"feed"})),
]
checks.extend((feed["name"], feed["url"], lambda b: xml(b, {"feed", "rss", "RDF"}))
              for feed in json.loads(CONFIG.read_text())["feeds"])
with ThreadPoolExecutor(max_workers=6) as workers:
    results = list(workers.map(test, checks))
for name, status, valid in results:
    print(f"{name} | HTTP {status or 'unbekannt'} | {'OK' if valid else 'FEHLER'}")
sys.exit(0 if all(row[2] for row in results) else 1)
