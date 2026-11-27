"""Transport-level test against the real Add-on HTTP and worker processes."""

import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

BASE = os.environ["TRC_TEST_URL"] + "/api/v1/"
ADMIN = os.environ["TRC_TEST_ADMIN"]
WORKFLOW = os.environ["TRC_TEST_WORKFLOW"]


def call(method, path, payload=None, status=200, credential=ADMIN):
    headers = {"Authorization": "Bearer " + credential}
    if isinstance(payload, bytes):
        headers["Content-Type"] = "application/octet-stream"
    elif payload is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(payload).encode()
    request = Request(BASE + path, data=payload, headers=headers, method=method)
    try:
        response = urlopen(request, timeout=80)
    except HTTPError as error:
        response = error
    with response:
        result = json.load(response)
        assert response.status == status, (path, response.status, result)
        return result


def query(term, path, kind=None, answer=False, retrieval="hybrid"):
    result = call(
        "POST", "knowledge/query", {"question": term, "prefix": path, "answer": answer}
    )
    assert result["retrieval"] == retrieval, result
    assert result["sources"] and result["sources"][0]["path"] == path, result
    assert term.casefold() in result["sources"][0]["excerpt"].casefold(), result
    assert result["sources"][0]["location"], result
    if kind:
        assert result["sources"][0]["kind"] == kind, result
    if answer:
        assert result["answer_status"] == "answered" and "[S1]" in result["answer"], (
            result
        )


def setup_ollama(enabled=True):
    call(
        "PUT",
        "admin/network/services/ollama",
        {
            "enabled": enabled,
            "internal_url": "http://127.0.0.1:11435",
            "timeout_seconds": 3,
        },
    )


def wait_indexed(count):
    last = {}
    for _ in range(120):
        last = call("GET", "knowledge/status")
        if last["jobs"].get("failed"):
            listing = call("GET", "knowledge/documents")
            raise AssertionError(listing)
        if last["jobs"].get("done", 0) == count and not last["jobs"].get("pending", 0):
            assert last["documents"] == count and last["worker"]["alive"], last
            return
        time.sleep(1)
    raise AssertionError(last)


if sys.argv[1] == "fresh":
    source = Path(sys.argv[2])
    setup_ollama()
    call("GET", "knowledge/status", status=401, credential=WORKFLOW)
    call("GET", "workflow/records/tasks", status=401, credential=WORKFLOW)
    records = call("GET", "workflow/records/tasks?limit=1")
    assert len(records["records"]) == 1 and records["next"]
    page = call(
        "GET",
        "workflow/records/tasks?" + urlencode({"limit": 1, "cursor": records["next"]}),
    )
    assert page["records"][0]["external_id"] != records["records"][0]["external_id"], (
        page
    )
    assert call("PUT", "knowledge/worker", {"paused": True})["paused"]
    for file in sorted(source.iterdir()):
        accepted = call(
            "PUT",
            "knowledge/documents/" + quote(file.name),
            file.read_bytes(),
            status=202,
        )
        assert accepted["queued"]
    first = (source / "wissen.md").read_bytes()
    duplicate = call("PUT", "knowledge/documents/wissen.md", first, status=202)
    assert not duplicate["queued"], duplicate
    call("PUT", "knowledge/documents/.hidden.md", first, status=422)
    call("PUT", "knowledge/documents/file.exe", b"no", status=422)
    call("PUT", "knowledge/documents/leer.txt", b"", status=422)
    assert call("GET", "knowledge/status")["jobs"]["pending"] >= 8
    assert not call("PUT", "knowledge/worker", {"paused": False})["paused"]
    wait_indexed(9)
    for term, name, kind in (
        ("KUPFERKOMET", "wissen.md", None),
        ("DELTAPRUEFUNG", "digital.pdf", "text"),
        ("NEBELSCHACHT", "scan.pdf", "ocr"),
        ("SONNENBILD", "bild.png", "ocr"),
        ("KRISTALLWORT", "word.docx", None),
        ("DOKLINGTABELLE", "word.docx", "table"),
        ("KREISEXCEL", "excel.xlsx", "table"),
        ("NEBELCSV", "liste.csv", "table"),
        ("POLARTEXT", "notiz.txt", None),
    ):
        query(term, "upload/" + name, kind)
    query("LOKALSPEICHER", "local/vault.md")
    ranked = call("POST", "knowledge/query", {"question": "Kennung"})
    assert ranked["reranking"] == "lexical_cpu" and len(ranked["sources"]) >= 2, ranked
    query("KUPFERKOMET", "upload/wissen.md", answer=True)
    assert call(
        "PUT",
        "knowledge/documents/wissen.md",
        b"# Messhalle\n\nNeue Kennung BLAUKOMET.\n",
        status=202,
    )["queued"]
    wait_indexed(9)
    query("BLAUKOMET", "upload/wissen.md")
    previous = call(
        "POST",
        "knowledge/query",
        {"question": "KUPFERKOMET", "prefix": "upload/wissen.md"},
    )
    assert all("KUPFERKOMET" not in hit["excerpt"] for hit in previous["sources"])
    setup_ollama(False)
    query("BLAUKOMET", "upload/wissen.md", retrieval="lexical")
    failure = call("POST", "knowledge/query", {"question": "BLAUKOMET", "answer": True})
    assert (
        failure["answer"] is None and failure["answer_status"] == "model_unavailable"
    ), failure
    no_evidence = call(
        "POST", "knowledge/query", {"question": "ZZQVVVZZ", "answer": True}
    )
    assert (
        no_evidence["answer_status"] == "no_evidence" and not no_evidence["sources"]
    ), no_evidence
    setup_ollama()
    print(
        "Dokumente, native OCR und Docling, Deduplizierung, Update, Suche, Quellen, Modellfehler und getrennte API-Rollen geprüft."
    )
else:
    wait_indexed(9)
    query("LOKALSPEICHER", "local/vault.md")
    query("BLAUKOMET", "upload/wissen.md", answer=True)
    print(
        "Wissensdatenbank und modellgestützte Antwort nach Neustart oder Rücksicherung geprüft."
    )
