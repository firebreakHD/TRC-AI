from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
from uuid import uuid4

URL = urlsplit(os.environ["TRC_TEST_URL"])
ADMIN = os.environ["TRC_TEST_ADMIN"]
WORKFLOW = os.environ["TRC_TEST_WORKFLOW"]
INGEST = "/api/v1/workflow/records/tasks"
STATUS = "/api/v1/system/status"
PREFS = "/api/v1/admin/preferences"
FIRST = "ea42bc23-cca2-4eff-a90b-80bcf8b1703f"
TASK = json.loads(Path("contracts/examples/tasks.json").read_text())


def request(method, path, token=None, body=None, key=None):
    conn = HTTPConnection(URL.hostname, URL.port, timeout=12)
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body)
    if key:
        headers["Idempotency-Key"] = str(key)
    try:
        conn.request(method, path, body, headers)
        response = conn.getresponse()
        raw = response.read()
        return response.status, (
            json.loads(raw) if response.getheader("Content-Type", "").startswith("application/json") else raw
        )
    finally:
        conn.close()


def send(body, key=None):
    return request("POST", INGEST, WORKFLOW, body, key or uuid4())


assert request("GET", "/healthz") == (200, {"status": "ok"})
code, status = request("GET", STATUS, WORKFLOW)
assert code == 200 and status["postgresql"]["version"].startswith("18."), (code, status)
assert status["qdrant"] == {"available": True, "version": "1.18.0", "collections": 1}
assert request("GET", STATUS)[0] == 401
assert request("GET", PREFS, WORKFLOW)[0] == 401
assert request("POST", INGEST, ADMIN, TASK, FIRST)[0] == 401
assert b"TRC Control Center" in request("GET", "/")[1]
assert b"Authorization" in request("GET", "/ui/app.js")[1]
assert send(TASK, FIRST) == (200, {"applied": 1, "unchanged": 0})

if sys.argv[1] == "persisted":
    assert request("GET", PREFS, ADMIN)[1]["values"]["refresh_seconds"] == 25
    assert send(TASK)[1] == {"applied": 0, "unchanged": 1}
    print("Status, HTTP-Frontend, Rollen, Konfiguration und Importpersistenz geprüft.")
    sys.exit()

assert send(TASK, FIRST) == (200, {"applied": 1, "unchanged": 0})
assert send(TASK) == (200, {"applied": 0, "unchanged": 1})
assert send(TASK, "invalid")[1]["error"]["code"] == "invalid_idempotency_key"
assert send({"source": "x", "records": [TASK["records"][0]] * 2})[0] == 422
assert send({"large": "x" * (512 * 1024)})[0] == 413
assert request("POST", INGEST, WORKFLOW, key=uuid4())[0] == 415
assert request("PUT", PREFS, ADMIN, {"refresh_seconds": 4})[0] == 422
assert request("PUT", PREFS, ADMIN, {"refresh_seconds": 25}) == (
    200, {"schema_version": 1, "refresh_seconds": 25},
)
updated = {"source": TASK["source"], "records": [{
    **TASK["records"][0], "observed_at": "2026-11-26T11:00:00Z", "payload": {"title": "Aktualisiert"},
}]}
assert send(updated, FIRST)[0] == 409
assert send(updated) == (200, {"applied": 1, "unchanged": 0})
assert send(TASK) == (200, {"applied": 0, "unchanged": 1})

concurrent_key = uuid4()
parallel_batch = {"source": "parallel", "records": [
    {**TASK["records"][0], "external_id": name} for name in ["one", "two"]
]}
with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(lambda _: send(parallel_batch, concurrent_key), range(4)))
assert results == [(200, {"applied": 2, "unchanged": 0})] * 4, results
print("Import, Replay, Konflikt, parallele Ausführung, Eingabevalidierung und Rollen geprüft.")
