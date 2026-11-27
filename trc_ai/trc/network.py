"""Persistente Netzwerkeinstellungen und lesende Dienstprüfungen."""

import base64
import fcntl
import json
import os
import re
import smtplib
import ssl
import tempfile
from contextlib import contextmanager
from datetime import UTC, datetime
from ipaddress import ip_address, ip_network
from pathlib import Path
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler,
    HTTPSHandler,
    ProxyHandler,
    Request,
    build_opener,
)

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    field_validator,
    model_validator,
)
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from .settings import OPTIONS

STATE = Path("/data/config/integrations.json")
CA_DIRECTORY = Path("/ssl")
SERVICE_KEY = re.compile(r"[a-z][a-z0-9_-]{1,39}")
LABELS = {
    "trc": "TRC-AI",
    "n8n": "n8n",
    "hermes": "Hermes",
    "ollama": "Ollama",
    "home-assistant": "Home Assistant",
    "nextcloud": "Nextcloud",
    "nextcloud-talk": "Nextcloud Talk",
    "couchdb": "CouchDB",
    "obsidian": "Obsidian",
    "smtp": "SMTP",
    "providers": "Externe Datenanbieter",
}
PROBES = {
    "trc": "/healthz",
    "n8n": "/healthz/readiness",
    "hermes": "/health/detailed",
    "ollama": "/api/version",
    "home-assistant": "/api/",
    "nextcloud": "/status.php",
    "nextcloud-talk": "/ocs/v2.php/cloud/capabilities?format=json",
    "couchdb": "/",
    "obsidian": "/",
    "providers": "/",
}


def address(value, schemes=("https", "http"), path=True):
    if not value:
        return ""
    if len(value) > 600 or any(ord(c) <= 32 for c in value) or "\\" in value:
        raise ValueError("Ungültige Dienstadresse")
    parsed = urlsplit(value)
    if (
        not parsed.hostname
        or parsed.scheme not in schemes
        or parsed.username is not None
        or parsed.query
        or parsed.fragment
        or parsed.port == 0
        or (not path and parsed.path not in {"", "/"})
    ):
        raise ValueError("Adresse ohne Benutzerinfo, Parameter oder Fragment angeben")
    return value.rstrip("/")


class Startup(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    network_public_url: str = ""
    network_internal_url: str = ""
    network_proxy_mode: Literal["direct", "trusted_proxy"] = "direct"
    network_trusted_proxies: list[str] = Field(default_factory=list, max_length=16)
    network_tls_mode: Literal["lan_http", "proxy_https"] = "lan_http"
    network_ca_file: str = ""
    network_timeout_seconds: int = Field(default=8, ge=1, le=30)

    @field_validator("network_public_url", "network_internal_url")
    @classmethod
    def check_url(cls, value):
        return address(value)

    @field_validator("network_trusted_proxies")
    @classmethod
    def check_networks(cls, values):
        networks = []
        for item in values:
            network = ip_network(item.strip(), strict=False)
            if network.prefixlen == 0:
                raise ValueError("Nur konkrete Proxy-Adressen und -Netze zulässig")
            networks.append(
                str(network.network_address)
                if network.prefixlen == network.max_prefixlen
                else str(network)
            )
        return list(dict.fromkeys(networks))

    @field_validator("network_ca_file")
    @classmethod
    def check_ca_file(cls, value):
        if value and not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.(?:pem|crt)", value
        ):
            raise ValueError("CA-Datei unter /ssl angeben")
        return value

    @model_validator(mode="after")
    def check_proxy_configuration(self):
        if (
            self.network_proxy_mode == "trusted_proxy"
            and not self.network_trusted_proxies
        ):
            raise ValueError("Vertrauenswürdiger Proxy braucht Adressliste")
        if self.network_tls_mode == "proxy_https" and (
            self.network_proxy_mode != "trusted_proxy"
            or not self.network_public_url.startswith("https://")
        ):
            raise ValueError("Proxy-HTTPS braucht HTTPS-Adresse und adressierten Proxy")
        return self


def load_startup():
    try:
        return Startup.model_validate_json(OPTIONS.read_bytes())
    except FileNotFoundError:
        return Startup()
    except ValidationError:
        raise ValueError(
            "Ungültige native Netzwerkkonfiguration. Optionen in Home Assistant prüfen."
        ) from None


class Integration(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool = False
    internal_url: str = ""
    public_url: str = ""
    auth_mode: Literal["none", "bearer", "basic"] = "none"
    credential_reference: str = Field(default="", max_length=120)
    timeout_seconds: int | None = Field(default=None, ge=1, le=30)
    tls_verification: Literal["system", "custom_ca"] = "system"

    @field_validator("internal_url")
    @classmethod
    def check_internal(cls, value):
        return address(value, ("http", "https", "smtp", "smtps"))

    @field_validator("public_url")
    @classmethod
    def check_public(cls, value):
        return address(value)


class IntegrationUpdate(Integration):
    username: str | None = Field(default=None, max_length=300)
    secret: SecretStr | None = Field(default=None, max_length=4096)
    remove_secret: bool = False


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


@contextmanager
def state_lock():
    with STATE.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield


def load_state():
    try:
        result = json.loads(STATE.read_bytes())
    except FileNotFoundError:
        return {"integrations": {}}
    if not isinstance(result, dict) or not isinstance(result.get("integrations"), dict):
        raise OSError("Ungültiger Integrationsspeicher")
    return result


def write_state(state):
    fd, name = tempfile.mkstemp(dir=STATE.parent, prefix=".integrations.")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(state, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, STATE)
        parent = os.open(STATE.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        Path(name).unlink(missing_ok=True)


def validate_key(key):
    if not SERVICE_KEY.fullmatch(key):
        raise ValueError("Ungültige Dienstkennung")


def service_config(key, row, startup):
    settings = dict(row.get("settings", {}))
    if key == "trc":
        settings.update(
            internal_url=startup.network_internal_url or "http://127.0.0.1:8099",
            public_url=startup.network_public_url,
        )
    return Integration.model_validate(settings)


def public_record(key, row, startup):
    data = service_config(key, row, startup)
    test_matches = row.get("last_endpoint") == data.internal_url
    return {
        "key": key,
        "label": LABELS.get(key, key),
        **data.model_dump(),
        "has_credential": bool(row.get("credential", {}).get("secret")),
        "last_check": row.get("last_check") if test_matches else None,
        "last_success_at": row.get("last_success_at") if test_matches else None,
    }


def dashboard(startup, context):
    saved = load_state()["integrations"]
    return {
        "startup": startup.model_dump(),
        "effect": {
            "startup_changes_require_restart": True,
            "integration_changes_require_restart": False,
            "ingress_port": 8099,
            "host_port_managed_by_haos": True,
        },
        "connection": context,
        "services": [
            public_record(key, saved.get(key, {}), startup)
            for key in dict.fromkeys([*LABELS, *saved])
        ],
    }


def update(key, command, startup):
    validate_key(key)
    if key == "trc":
        if command.internal_url or command.public_url:
            raise ValueError("TRC-Adressen in den nativen Add-on-Optionen festlegen")
        command = command.model_copy(
            update={
                "internal_url": startup.network_internal_url or "http://127.0.0.1:8099"
            }
        )
    if command.enabled and not command.internal_url:
        raise ValueError("Interne Adresse erforderlich")
    scheme = urlsplit(command.internal_url).scheme
    if scheme and (scheme in {"smtp", "smtps"}) != (key == "smtp"):
        raise ValueError("Protokoll passt nicht zum Dienst")
    if command.tls_verification == "custom_ca" and not startup.network_ca_file:
        raise ValueError("Eigene CA fehlt in der Startkonfiguration")
    with state_lock():
        state = load_state()
        services = state["integrations"]
        if key not in services and key not in LABELS and len(services) >= 40:
            raise ValueError("Zu viele konfigurierte Dienste")
        row = services.get(key, {})
        cfg = command.model_dump(exclude={"username", "secret", "remove_secret"})
        credential = row.get("credential", {})
        if command.remove_secret or command.auth_mode == "none":
            credential = {}
        if command.secret is not None:
            if command.remove_secret or command.auth_mode == "none":
                raise ValueError(
                    "Authentifizierung und Schlüssel passen nicht zusammen"
                )
            value = command.secret.get_secret_value()
            if not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
                raise ValueError("Ungültige Zugangsdaten")
            if command.auth_mode == "bearer" and (
                scheme in {"smtp", "smtps"} or not value.isascii()
            ):
                raise ValueError(
                    "Bearer-Authentifizierung benötigt einen HTTP-Dienst und ASCII"
                )
            name = (
                command.username
                if command.username is not None
                else credential.get("username", "")
            )
            if command.auth_mode == "basic" and (
                not name or ":" in name or any(ord(c) < 32 for c in name)
            ):
                raise ValueError("Benutzername fehlt oder ist ungültig")
            credential = {"mode": command.auth_mode, "username": name, "secret": value}
        if credential and credential.get("mode") != command.auth_mode:
            raise ValueError(
                "Beim Authentifizierungswechsel neue Zugangsdaten eingeben"
            )
        if (
            key
            in {
                "trc",
                "n8n",
                "hermes",
                "ollama",
                "home-assistant",
                "nextcloud",
                "nextcloud-talk",
                "couchdb",
            }
            and command.internal_url
            and urlsplit(command.internal_url).path.endswith(
                PROBES.get(key, "/").split("?")[0]
            )
            and PROBES.get(key) not in {"/", None}
        ):
            raise ValueError("Basisadresse ohne Prüfpfad eingeben")
        revision = int(row.get("revision", 0)) + 1
        prior = row.get("settings", {})
        endpoint_same = all(
            prior.get(field) == cfg[field]
            for field in ("internal_url", "auth_mode", "tls_verification")
        ) and credential == row.get("credential", {})
        services[key] = {
            "settings": cfg,
            "credential": credential,
            "revision": revision,
            "last_endpoint": row.get("last_endpoint") if endpoint_same else None,
            "last_check": row.get("last_check") if endpoint_same else None,
            "last_success_at": row.get("last_success_at") if endpoint_same else None,
        }
        write_state(state)
        return public_record(key, services[key], startup)


def credentials_header(cfg, credential):
    if cfg.auth_mode == "none":
        return {}
    secret = credential.get("secret")
    if not secret:
        raise ValueError("Zugangsdaten fehlen")
    if cfg.auth_mode == "bearer":
        return {"Authorization": "Bearer " + secret}
    raw = (credential["username"] + ":" + secret).encode()
    return {"Authorization": "Basic " + base64.b64encode(raw).decode()}


def trust(cfg, startup):
    context = ssl.create_default_context()
    if cfg.tls_verification == "custom_ca":
        root = CA_DIRECTORY.resolve()
        file = (root / startup.network_ca_file).resolve()
        if not startup.network_ca_file or file.parent != root or not file.is_file():
            raise FileNotFoundError("Eigene CA nicht erreichbar")
        context.load_verify_locations(cafile=str(file))
    return context


def probe(key, startup):
    validate_key(key)
    row = load_state()["integrations"].get(key, {})
    cfg = service_config(key, row, startup)
    if not cfg.enabled or not cfg.internal_url:
        raise ValueError("Dienst aktivieren und interne Adresse speichern")
    timeout = cfg.timeout_seconds or startup.network_timeout_seconds
    credential = row.get("credential", {})
    now = datetime.now(UTC).isoformat()
    status = "available"
    message = "Dienst erreichbar."
    try:
        context = trust(cfg, startup)
        headers = credentials_header(cfg, credential)
        if key == "smtp":
            smtp_probe(cfg.internal_url, timeout, credential, context)
        else:
            suffix = PROBES.get(key, "")
            if key == "nextcloud-talk":
                headers["OCS-APIRequest"] = "true"
            client = build_opener(
                ProxyHandler({}), NoRedirect(), HTTPSHandler(context=context)
            )
            request = Request(cfg.internal_url + suffix, headers=headers, method="GET")
            with client.open(request, timeout=timeout) as response:
                if key in {"trc", "ollama", "nextcloud", "nextcloud-talk", "couchdb"}:
                    data = json.loads(response.read(65537))
                    expected = {
                        "trc": lambda d: d.get("status") == "ok",
                        "ollama": lambda d: isinstance(d.get("version"), str),
                        "nextcloud": lambda d: (
                            d.get("installed") is True and not d.get("maintenance")
                        ),
                        "nextcloud-talk": lambda d: isinstance(
                            d.get("ocs", {})
                            .get("data", {})
                            .get("capabilities", {})
                            .get("spreed"),
                            dict,
                        ),
                        "couchdb": lambda d: d.get("couchdb") == "Welcome",
                    }[key]
                    if not expected(data):
                        status, message = (
                            "unexpected",
                            "Dienst antwortet mit unerwarteten Daten.",
                        )
    except HTTPError as error:
        status = "unauthorized" if error.code in {401, 403} else "unavailable"
        message = f"Dienst meldet HTTP {error.code}."
        error.close()
    except smtplib.SMTPAuthenticationError:
        status, message = "unauthorized", "SMTP lehnt die Anmeldung ab."
    except (ssl.SSLError, FileNotFoundError):
        status, message = (
            "tls_error",
            "TLS oder CA-Datei konnte nicht validiert werden.",
        )
    except URLError as error:
        status = (
            "tls_error" if isinstance(error.reason, ssl.SSLError) else "unavailable"
        )
        message = (
            "TLS-Zertifikat ungültig."
            if status == "tls_error"
            else "Dienst ist nicht erreichbar."
        )
    except (OSError, TimeoutError, smtplib.SMTPException):
        status, message = "unavailable", "Dienst ist nicht erreichbar."
    except (ValueError, KeyError, AttributeError):
        status, message = (
            "unexpected",
            "Antwort oder Zugangskonfiguration konnte nicht geprüft werden.",
        )
    result = {"status": status, "message": message, "checked_at": now}
    with state_lock():
        state = load_state()
        current = state["integrations"].get(key)
        if current and current.get("revision") == row.get("revision"):
            current["last_endpoint"] = cfg.internal_url
            current["last_check"] = result
            if status == "available":
                current["last_success_at"] = now
            write_state(state)
            return public_record(key, current, startup)
    return public_record(key, row, startup)


def smtp_probe(value, timeout, credential, context):
    uri = urlsplit(value)
    implicit = uri.scheme == "smtps"
    factory = smtplib.SMTP_SSL if implicit else smtplib.SMTP
    opts = {"context": context} if implicit else {}
    with factory(
        uri.hostname, uri.port or (465 if implicit else 587), timeout=timeout, **opts
    ) as client:
        client.ehlo()
        if not implicit:
            client.starttls(context=context)
            client.ehlo()
        if credential:
            client.login(credential["username"], credential["secret"])
        code, _ = client.noop()
        if code != 250:
            raise smtplib.SMTPResponseException(code, b"NOOP")


class TrustedForwarding:
    """Uvicorn client/proto parser with host handling gated on the peer socket."""

    def __init__(self, app, startup):
        self.app = app
        self.startup = startup
        proxies = (
            startup.network_trusted_proxies
            if startup.network_proxy_mode == "trusted_proxy"
            else []
        )
        self.allow = [ip_network(ip) for ip in proxies]
        self.proxy = ProxyHeadersMiddleware(app, trusted_hosts=proxies)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        client = (scope.get("client") or ("", 0))[0]
        try:
            peer = ip_address(client)
            trusted = any(peer in target for target in self.allow)
        except ValueError:
            trusted = False
        if not trusted:
            return await self.app(scope, receive, send)
        hosts = [
            v.decode("latin-1") for k, v in scope["headers"] if k == b"x-forwarded-host"
        ]
        host = hosts[0] if len(hosts) == 1 else ""
        if host and re.fullmatch(
            r"(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?", host
        ):
            scope = {**scope, "trc_forwarded_host": host, "trc_trusted_proxy": True}
        else:
            scope = {**scope, "trc_trusted_proxy": True}
        return await self.proxy(scope, receive, send)
