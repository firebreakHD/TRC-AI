import asyncio
import ssl
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch

from pydantic import ValidationError
from trc import network

TOKEN = "ephemeral-network-test-token"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/probe")
        elif self.path == "/probe":
            self.send_response(
                200 if self.headers.get("Authorization") == "Bearer " + TOKEN else 401
            )
        else:
            self.send_response(404)
        self.end_headers()


@contextmanager
def serve(certificate=None, key=None):
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        if certificate:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certificate, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield f"{'https' if certificate else 'http'}://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            worker.join()


class NetworkTest(unittest.TestCase):
    def setUp(self):
        temp = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(temp)
        self.enterContext(
            patch.object(network, "STATE", self.root / "integrations.json")
        )
        self.enterContext(patch.object(network, "CA_DIRECTORY", self.root))
        self.startup = network.Startup()

    def configure(self, url, *, startup=None, secret=None, tls="system", public=""):
        return network.update(
            "fixture",
            network.IntegrationUpdate(
                enabled=True,
                internal_url=url,
                public_url=public,
                auth_mode="bearer",
                secret=secret,
                credential_reference="test-reference",
                tls_verification=tls,
            ),
            startup or self.startup,
        )

    def test_validates_native_options(self):
        for invalid in (
            {"network_proxy_mode": "trusted_proxy"},
            {"network_trusted_proxies": ["0.0.0.0/0"]},
            {"network_tls_mode": "proxy_https"},
            {"network_public_url": "https://user:secret@example.com"},
            {"network_ca_file": "../ca.pem"},
        ):
            with self.assertRaises(ValidationError):
                network.Startup(**invalid)
        with self.assertRaises(ValueError):
            network.update(
                "trc",
                network.IntegrationUpdate(internal_url="http://localhost"),
                self.startup,
            )

    def test_persistent_credentials_address_and_port_changes(self):
        with serve() as first, serve() as second:
            saved = self.configure(
                first + "/probe", secret=TOKEN, public="https://old.example.invalid"
            )
            self.assertTrue(saved["has_credential"])
            self.assertNotIn(TOKEN, str(saved))
            self.assertEqual(network.STATE.stat().st_mode & 0o777, 0o600)
            ok = network.probe("fixture", self.startup)
            self.assertEqual(ok["last_check"]["status"], "available")
            self.assertIsNotNone(ok["last_success_at"])
            self.configure(second + "/probe", public="https://new.example.invalid")
            self.assertEqual(
                network.probe("fixture", network.Startup())["last_check"]["status"],
                "available",
            )
            self.configure(second + "/redirect")
            self.assertIn(
                "HTTP 302",
                network.probe("fixture", self.startup)["last_check"]["message"],
            )
            self.configure(second + "/probe", secret="invalid")
            self.assertEqual(
                network.probe("fixture", self.startup)["last_check"]["status"],
                "unauthorized",
            )
            for row in network.dashboard(self.startup, {})["services"]:
                self.assertNotIn("secret", row)
        self.assertEqual(
            network.probe("fixture", self.startup)["last_check"]["status"],
            "unavailable",
        )

    def test_tls_verification_hostname_and_private_ca(self):
        certificate, key = self.root / "test-ca.pem", self.root / "key.pem"
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=fixture",
                "-addext",
                "subjectAltName=IP:127.0.0.1",
                "-keyout",
                key,
                "-out",
                certificate,
            ],
            check=True,
            capture_output=True,
        )
        with serve(certificate, key) as addr:
            self.configure(addr + "/probe", secret=TOKEN)
            self.assertEqual(
                network.probe("fixture", self.startup)["last_check"]["status"],
                "tls_error",
            )
            startup = network.Startup(network_ca_file=certificate.name)
            self.configure(addr + "/probe", startup=startup, tls="custom_ca")
            self.assertEqual(
                network.probe("fixture", startup)["last_check"]["status"], "available"
            )
            self.configure(
                addr.replace("127.0.0.1", "localhost") + "/probe",
                startup=startup,
                tls="custom_ca",
            )
            self.assertEqual(
                network.probe("fixture", startup)["last_check"]["status"], "tls_error"
            )

    def test_forwarded_headers_for_direct_and_trusted_socket_peers(self):
        captured = []

        async def app(scope, receive, send):
            captured.append(scope)

        startup = network.Startup(
            network_proxy_mode="trusted_proxy",
            network_trusted_proxies=["192.0.2.10", "192.0.2.11"],
            network_public_url="https://trc.example.invalid",
            network_tls_mode="proxy_https",
        )
        proxy = network.TrustedForwarding(app, startup)
        headers = [
            (b"x-forwarded-for", b"198.51.100.23, 192.0.2.11"),
            (b"x-forwarded-proto", b"https"),
            (b"x-forwarded-host", b"trc.example.invalid"),
        ]
        for peer in ("198.51.100.1", "192.0.2.10"):
            scope = {
                "type": "http",
                "scheme": "http",
                "client": (peer, 23000),
                "headers": headers,
            }
            asyncio.run(proxy(scope, None, None))
        direct, forwarded = captured
        self.assertEqual(direct["scheme"], "http")
        self.assertNotIn("trc_forwarded_host", direct)
        self.assertEqual(forwarded["scheme"], "https")
        self.assertEqual(forwarded["client"][0], "198.51.100.23")
        self.assertEqual(forwarded["trc_forwarded_host"], "trc.example.invalid")


if __name__ == "__main__":
    unittest.main()
