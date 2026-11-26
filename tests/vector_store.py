from http.client import HTTPConnection
import json
import socket
import sys

origin = ("127.0.0.1", 6333)
collection = "/collections/restore-probe"


def call(method, path, payload=None):
    connection = HTTPConnection(*origin, timeout=3)
    try:
        body = json.dumps(payload) if payload is not None else None
        connection.request(method, path, body, {"Content-Type": "application/json"})
        response = connection.getresponse()
        assert response.status == 200, (path, response.status)
        return json.load(response)
    finally:
        connection.close()


assert call("GET", "/")["version"] == "1.18.0"
for port in (5432, 6333, 6334):
    with socket.socket() as peer:
        peer.settimeout(2)
        assert peer.connect_ex((socket.gethostbyname(socket.gethostname()), port)) != 0
if sys.argv[1] == "fresh":
    call("PUT", collection, {"vectors": {"size": 3, "distance": "Cosine"}})
    call("PUT", f"{collection}/points?wait=true", {"points": [
        {"id": 1, "vector": [0.1, 0.2, 0.3], "payload": {"fixture": "restore-test"}}
    ]})
assert call("GET", f"{collection}/points/1")["result"]["payload"]["fixture"] == "restore-test"
print("Qdrant-Collection, Vektordatensatz und interne Datenbankports geprüft.")
