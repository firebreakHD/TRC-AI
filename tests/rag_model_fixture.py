"""Isolated Ollama protocol fixture. Never required by the shipped add-on."""

import hashlib
import json
import math
import re
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/api/embed" and data.get("model") == "bge-m3":
            vectors = []
            for text in data["input"]:
                vector = [0.0] * 1024
                for word, frequency in Counter(
                    re.findall(r"\w+", text.casefold())
                ).items():
                    index = int.from_bytes(
                        hashlib.sha256(word.encode()).digest()[:4], "big"
                    ) % len(vector)
                    vector[index] += frequency
                norm = math.sqrt(sum(value * value for value in vector)) or 1
                vectors.append([value / norm for value in vector])
            result = {"embeddings": vectors}
        elif self.path == "/api/chat" and data.get("model") == "fixture":
            result = {
                "message": {"content": "Der synthetische Testbeleg ist verfügbar [S1]."}
            }
        else:
            self.send_error(404)
            return
        body = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


ThreadingHTTPServer(("127.0.0.1", 11435), Handler).serve_forever()
