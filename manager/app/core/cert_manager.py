"""HTTPS certificates for the managed server.

Two sources are supported:

* ``self-signed`` — generated locally, good for LAN/VPN use (browsers warn).
* ``letsencrypt`` — issued through ACME v2 over an HTTP-01 challenge that the
  running server publishes from its ``/.well-known/acme-challenge`` web root.
  When the server is stopped, a tiny local listener answers on port 80 instead.

Both end the same way: ``<certs>/server.crt|server.key`` are written, which is
exactly where ``server/tls.ts`` looks for the HTTPS material it mounts on 443.
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from .acme import AcmeClient, AcmeError, ChallengeHandler, PRODUCTION_DIRECTORY, STAGING_DIRECTORY

CHALLENGE_PREFIX = "/.well-known/acme-challenge/"


class CertificateError(RuntimeError):
    """A user-facing reason why a certificate could not be installed."""


# ---------------------------------------------------------------------------
# Challenge responders
# ---------------------------------------------------------------------------
class WebrootResponder(ChallengeHandler):
    """Writes the challenge into the web root the Node server already serves."""

    def __init__(self, webroot: Path):
        self.webroot = Path(webroot)
        self.challenge_dir = self.webroot / ".well-known" / "acme-challenge"

    def install(self, token: str, content: str) -> None:
        self.challenge_dir.mkdir(parents=True, exist_ok=True)
        (self.challenge_dir / self._safe(token)).write_text(content, encoding="utf-8")

    def remove(self, token: str) -> None:
        try:
            (self.challenge_dir / self._safe(token)).unlink(missing_ok=True)
        except OSError:
            pass

    @staticmethod
    def _safe(token: str) -> str:
        cleaned = "".join(c for c in token if c.isalnum() or c in "-_")
        if not cleaned or cleaned != token:
            raise CertificateError("The ACME server sent an unusable challenge token.")
        return cleaned


class LocalPortResponder(ChallengeHandler):
    """Answers on port 80 itself, for when the managed server is not running."""

    def __init__(self, port: int = 80):
        self.port = port
        self._answers: dict[str, str] = {}
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "LocalPortResponder":
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - http.server naming
                token = self.path.split(CHALLENGE_PREFIX, 1)[-1].split("?", 1)[0]
                answer = outer._answers.get(token)
                if answer is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                payload = answer.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *_args) -> None:  # keep the console quiet
                return

        try:
            self._server = ThreadingHTTPServer(("0.0.0.0", self.port), Handler)
        except OSError as exc:
            raise CertificateError(
                f"Port {self.port} is already in use, so the challenge cannot be answered "
                f"locally. Start the server (it publishes the challenge) or free the port."
            ) from exc
        self._thread = threading.Thread(target=self._server.serve_forever,
                                        name="acme-challenge", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_exc) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    def install(self, token: str, content: str) -> None:
        self._answers[token] = content

    def remove(self, token: str) -> None:
        self._answers.pop(token, None)


# ---------------------------------------------------------------------------
# Certificates
# ---------------------------------------------------------------------------
def _utc(value: dt.datetime) -> dt.datetime:
    return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value


class CertificateManager:
    def __init__(self, certs_dir: Path, webroot: Path) -> None:
        self.certs_dir = Path(certs_dir)
        self.webroot = Path(webroot)
        self.cert_path = self.certs_dir / "server.crt"
        self.key_path = self.certs_dir / "server.key"
        self.account_key = self.certs_dir / "acme-account.key"
        self.meta_path = self.certs_dir / "cert-meta.json"

    # -- inspection --------------------------------------------------------
    def status(self) -> dict[str, Any]:
        meta = self._meta()
        data: dict[str, Any] = {
            "ok": False, "configured": False, "kind": "none",
            "domain": meta.get("domain", ""), "issuer": "", "subject": "",
            "not_before": "", "not_after": "", "expires_at": "",
            "days_left": None, "valid": False, "self_signed": False,
            "san": [], "cert_path": str(self.cert_path), "key_path": str(self.key_path),
            "cert_exists": self.cert_path.exists(), "key_exists": self.key_path.exists(),
            "obtained_at": meta.get("obtained_at", ""),
            "directory": meta.get("directory", ""), "error": None,
        }
        if not self.cert_path.exists():
            data["error"] = "No certificate is installed yet."
            return data
        try:
            certificate = x509.load_pem_x509_certificate(self.cert_path.read_bytes())
        except (ValueError, OSError) as exc:
            data["error"] = f"The installed certificate cannot be read: {exc}"
            return data

        now = dt.datetime.now(dt.timezone.utc)
        not_before = _utc(certificate.not_valid_before_utc)
        not_after = _utc(certificate.not_valid_after_utc)
        issuer = ", ".join(f"{part.oid._name}={part.value}"
                           for part in certificate.issuer)
        subject = ", ".join(f"{part.oid._name}={part.value}"
                            for part in certificate.subject)
        names: list[str] = []
        try:
            extension = certificate.extensions.get_extension_for_class(
                x509.SubjectAlternativeName)
            names = list(extension.value.get_values_for_type(x509.DNSName))
            names += [str(ip) for ip in
                      extension.value.get_values_for_type(x509.IPAddress)]
        except x509.ExtensionNotFound:
            pass
        self_signed = certificate.issuer == certificate.subject
        days_left = int((not_after - now).total_seconds() // 86400)
        data.update({
            "ok": True, "configured": True,
            "kind": meta.get("kind", "letsencrypt" if "Let's Encrypt" in issuer
                             else "self-signed"),
            "issuer": issuer or "unknown", "subject": subject or "",
            "not_before": not_before.isoformat(),
            "not_after": not_after.isoformat(),
            "expires_at": not_after.isoformat(),
            "days_left": days_left,
            "valid": not_before <= now <= not_after,
            "self_signed": self_signed,
            "san": names,
        })
        return data

    def _meta(self) -> dict[str, Any]:
        try:
            value = json.loads(self.meta_path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write_meta(self, kind: str, domain: str, directory: str = "") -> None:
        self.certs_dir.mkdir(parents=True, exist_ok=True)
        self.meta_path.write_text(json.dumps({
            "kind": kind, "domain": domain, "directory": directory,
            "obtained_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    # -- installation ------------------------------------------------------
    @staticmethod
    def _write_pair(cert_pem: bytes, key_pem: bytes, cert_path: Path, key_path: Path) -> None:
        cert_path.parent.mkdir(parents=True, exist_ok=True)
        cert_path.write_bytes(cert_pem)
        key_path.write_bytes(key_pem)
        try:
            key_path.chmod(0o600)
        except OSError:
            pass

    def install_self_signed(self, extra_hosts: list[str] | None = None) -> dict[str, Any]:
        """A locally signed certificate so HTTPS works without a domain."""
        key = ec.generate_private_key(ec.SECP256R1())
        hostname = socket.gethostname()
        hosts = ["localhost", "127.0.0.1", hostname, *list(extra_hosts or [])]
        entries: list[x509.GeneralName] = []
        for host in dict.fromkeys(h for h in hosts if h):
            try:
                entries.append(x509.IPAddress(ipaddress.ip_address(host)))
            except ValueError:
                entries.append(x509.DNSName(host))
        try:
            for interfaces in socket.getaddrinfo(hostname, None):
                address = interfaces[4][0]
                try:
                    parsed = ipaddress.ip_address(address)
                except ValueError:
                    continue
                if parsed.version == 4 and not parsed.is_loopback:
                    entries.append(x509.IPAddress(parsed))
        except OSError:
            pass
        entries = list(dict.fromkeys(entries))

        now = dt.datetime.now(dt.timezone.utc)
        subject = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, hostname or "20negar"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "20Negar Studio"),
        ])
        builder = (
            x509.CertificateBuilder()
            .subject_name(subject).issuer_name(subject)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(minutes=5))
            .not_valid_after(now + dt.timedelta(days=825))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(
                digital_signature=True, key_cert_sign=True, crl_sign=True,
                content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False,
                encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.SubjectAlternativeName(entries), critical=False)
            .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]),
                           critical=False))
        certificate = builder.sign(key, hashes.SHA256())

        self._write_pair(
            certificate.public_bytes(serialization.Encoding.PEM),
            key.private_bytes(serialization.Encoding.PEM,
                              serialization.PrivateFormat.PKCS8,
                              serialization.NoEncryption()),
            self.cert_path, self.key_path)
        self._write_meta("self-signed", hostname or "")
        return self.status()

    def issue(self, domain: str, email: str | None = None, staging: bool = False,
              server_running: bool = True, transport=None,
              directory_url: str | None = None) -> dict[str, Any]:
        """Obtain a Let's Encrypt certificate with an HTTP-01 challenge."""
        domain = str(domain or "").strip().lower()
        if not domain:
            raise CertificateError("A domain name is required.")
        directory = directory_url or (STAGING_DIRECTORY if staging else PRODUCTION_DIRECTORY)

        client = AcmeClient(self.account_key, transport=transport, directory_url=directory)
        webroot = WebrootResponder(self.webroot)

        def run(handler: ChallengeHandler) -> tuple[bytes, bytes]:
            return client.obtain_certificate(domain, handler, email=email)

        try:
            if server_running:
                # The running server publishes /.well-known/acme-challenge from
                # the web root, so port 80 is already answering correctly.
                certificate, key = run(webroot)
            else:
                with LocalPortResponder(80) as local:
                    certificate, key = run(local)
        except AcmeError as exc:
            raise CertificateError(str(exc)) from exc

        archive = self.certs_dir / "letsencrypt" / domain
        self._write_pair(certificate, key, archive / "fullchain.pem", archive / "privkey.pem")
        self._write_pair(certificate, key, self.cert_path, self.key_path)
        self._write_meta("letsencrypt", domain, directory)
        return self.status()

    def needs_renewal(self, threshold_days: int = 30) -> bool:
        status = self.status()
        days_left = status.get("days_left")
        return bool(status.get("configured") and days_left is not None
                    and int(days_left) <= int(threshold_days))

    # Challenge helpers for the web root ------------------------------------
    def challenge_ready(self) -> bool:
        return self.webroot.exists() or self.webroot.parent.exists()
