"""Isolated Ollama protocol fixture. Never required by the shipped add-on."""

import hashlib
import json
import math
import re
import time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == "/api/states/light.fixture":
            data = {"entity_id": "light.fixture", "state": getattr(self.server, "light", "off"),
                    "last_updated": "2026-11-27T18:00:00Z"}
            raw = json.dumps(data).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(raw)
        else:
            self.send_error(404)

    def stream_chat(self, data):
        content = data["messages"][-1]["content"]
        if "LANGSAMTEST" in content:
            time.sleep(15)
        answer = "Synthetische Antwort [1]." if '"belege"' in content else "Synthetische Antwort."
        if "KONTEXTTEST" in content and any("VORHERTEST" in entry["content"] for entry in data["messages"][:-1]):
            answer = "Gesprächskontext übernommen."
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        try:
            for item in [{"message": {"content": part+" "}, "done": False} for part in answer.split()]+[{"done": True}]:
                self.wfile.write(json.dumps(item).encode()+b"\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/api/chat" and data.get("stream"):
            self.stream_chat(data)
            return
        if self.path == "/api/services/light/turn_on" and data == {"entity_id":"light.fixture"}:
            self.server.light = "on"
            result = []
        elif self.path == "/webhook/fixture" and data == {"request":"daily-report"}:
            result = {"accepted": True}
        elif self.path == "/api/embed" and data.get("model") == "bge-m3":
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
