"""End-to-end tests for the manager's ACME client and certificate installer."""
import base64
import datetime as dt
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.x509.oid import NameOID

from app.core.cert_manager import CertificateManager, WebrootResponder


def b64d(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class FakeAcme:
    """A minimal RFC 8555 server that verifies every JWS the client sends."""

    def __init__(self, webroot: Path):
        self.webroot = Path(webroot)
        self.nonces: set[str] = set()
        self.account_key = None
        self.account_url = ""
        self.challenged = False
        self.validated_content = None
        self.ca_key = ec.generate_private_key(ec.SECP256R1())
        self.ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Fake ACME CA")])
        self.base = ""
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return

            def _send(self, status: int, payload: dict | str, extra: dict | None = None):
                body = (payload if isinstance(payload, str) else json.dumps(payload)).encode()
                self.send_response(status)
                self.send_header("Replay-Nonce", outer.new_nonce())
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                for key, value in (extra or {}).items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):  # noqa: N802
                if self.path == "/directory":
                    outer._send_directory(self)
                else:
                    self._send(404, {"detail": "not found"})

            def do_HEAD(self):  # noqa: N802
                if self.path == "/new-nonce":
                    self.send_response(200)
                    self.send_header("Replay-Nonce", outer.new_nonce())
                    self.end_headers()
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length).decode()
                try:
                    outer._handle_post(self, raw)
                except AssertionError as exc:
                    self._send(400, {"detail": f"jws verification failed: {exc}"})
                except Exception as exc:  # pragma: no cover - surfacing test failures
                    self._send(500, {"detail": f"fake CA error: {exc}"})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def new_nonce(self) -> str:
        import secrets
        nonce = secrets.token_urlsafe(16)
        self.nonces.add(nonce)
        return nonce

    def _send_directory(self, handler) -> None:
        body = json.dumps({
            "newNonce": f"{self.base}/new-nonce",
            "newAccount": f"{self.base}/new-account",
            "newOrder": f"{self.base}/new-order",
            "meta": {"termsOfService": "https://example.invalid/tos"},
        }).encode()
        handler.send_response(200)
        handler.send_header("Replay-Nonce", self.new_nonce())
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)

    def _verify(self, raw: str, expected_url: str) -> tuple[dict, bytes]:
        data = json.loads(raw)
        protected = json.loads(b64d(data["protected"]))
        assert protected["alg"] == "ES256"
        assert protected["url"] == expected_url, (protected["url"], expected_url)
        assert protected["nonce"] in self.nonces, "unknown nonce"
        self.nonces.discard(protected["nonce"])
        if "jwk" in protected:
            jwk = protected["jwk"]
            numbers = ec.EllipticCurvePublicNumbers(
                int.from_bytes(b64d(jwk["x"]), "big"),
                int.from_bytes(b64d(jwk["y"]), "big"),
                ec.SECP256R1())
            key = numbers.public_key()
            self.account_key = key
        else:
            assert protected.get("kid") == self.account_url
            key = self.account_key
        signature = b64d(data["signature"])
        raw_signature = encode_dss_signature(
            int.from_bytes(signature[:32], "big"),
            int.from_bytes(signature[32:], "big"))
        signing_input = f"{data['protected']}.{data['payload']}".encode()
        key.verify(raw_signature, signing_input, ec.ECDSA(hashes.SHA256()))
        payload = b64d(data["payload"]) if data["payload"] else b""
        return protected, payload

    def _handle_post(self, handler, raw: str) -> None:
        path = handler.path
        url = f"{self.base}{path}"
        protected, payload = self._verify(raw, url)
        data = json.loads(payload) if payload else {}

        if path == "/new-account":
            self.account_url = f"{self.base}/account/1"
            handler._send(201, {"status": "valid"}, {"Location": self.account_url})
        elif path == "/new-order":
            assert data["identifiers"][0]["value"] == "studio.example.com"
            handler._send(201, {
                "status": "pending",
                "identifiers": [{"type": "dns", "value": "studio.example.com"}],
                "authorizations": [f"{self.base}/authz/1"],
                "finalize": f"{self.base}/finalize/1",
            }, {"Location": f"{self.base}/order/1"})
        elif path == "/authz/1":
            handler._send(200, self._authz())
        elif path == "/challenge/1":
            expected_file = (self.webroot / ".well-known" / "acme-challenge" / "tok123")
            assert expected_file.exists(), "challenge file was not published"
            self.validated_content = expected_file.read_text()
            assert self.validated_content.startswith("tok123.")
            self.challenged = True
            handler._send(200, {"status": "processing"})
        elif path == "/order/1":
            handler._send(200, {"status": "valid",
                                "certificate": f"{self.base}/cert/1"})
        elif path == "/finalize/1":
            csr = x509.load_der_x509_csr(b64d(data["csr"]))
            assert csr.is_signature_valid
            certificate = self._sign(csr)
            handler._send(200, {"status": "valid",
                                "certificate": f"{self.base}/cert/1"})
            self.certificate = certificate
        elif path == "/cert/1":
            handler._send(200, self.certificate.public_bytes(serialization.Encoding.PEM).decode())
        else:
            handler._send(404, {"detail": "not found"})

    def _authz(self) -> dict:
        return {
            "status": "valid" if self.challenged else "pending",
            "identifier": {"type": "dns", "value": "studio.example.com"},
            "challenges": [{
                "type": "http-01", "url": f"{self.base}/challenge/1",
                "token": "tok123",
                "status": "valid" if self.challenged else "pending",
            }],
        }

    def _sign(self, csr: x509.CertificateSigningRequest) -> x509.Certificate:
        now = dt.datetime.now(dt.timezone.utc)
        return (x509.CertificateBuilder()
                .subject_name(csr.subject)
                .issuer_name(self.ca_name)
                .public_key(csr.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(now - dt.timedelta(minutes=1))
                .not_valid_after(now + dt.timedelta(days=90))
                .add_extension(x509.SubjectAlternativeName([x509.DNSName("studio.example.com")]),
                               critical=False)
                .sign(self.ca_key, hashes.SHA256()))


@pytest.fixture()
def fake_ca(tmp_path):
    server = FakeAcme(tmp_path / "acme")
    yield server
    server.close()


def test_letsencrypt_issuance_writes_a_real_certificate(fake_ca, tmp_path):
    manager = CertificateManager(tmp_path / "certs", tmp_path / "acme")

    status = manager.issue("studio.example.com", "admin@example.com",
                           server_running=True,
                           directory_url=fake_ca.base + "/directory")

    # The fake CA validated the JWS, saw the token file and signed our CSR.
    assert fake_ca.challenged is True
    assert status["ok"] and status["kind"] == "letsencrypt"
    assert status["days_left"] >= 89
    assert "Fake ACME CA" in status["issuer"]
    assert status["san"] == ["studio.example.com"]
    assert Path(status["cert_path"]).exists() and Path(status["key_path"]).exists()
    chain = Path(status["cert_path"]).read_text()
    assert chain.count("BEGIN CERTIFICATE") >= 1


def test_certificate_manager_reports_expiry_and_renews_when_due(fake_ca, tmp_path):
    manager = CertificateManager(tmp_path / "certs", tmp_path / "acme")
    manager.issue("studio.example.com", server_running=True,
                  directory_url=fake_ca.base + "/directory")
    assert manager.status()["days_left"] >= 89
    assert manager.needs_renewal(30) is False
    assert manager.needs_renewal(120) is True


def test_self_signed_certificate_covers_local_names(tmp_path):
    manager = CertificateManager(tmp_path / "certs", tmp_path / "acme")

    status = manager.install_self_signed()

    assert status["ok"] and status["kind"] == "self-signed" and status["self_signed"]
    assert "localhost" in status["san"] and "127.0.0.1" in status["san"]
    assert Path(status["cert_path"]).exists()
    with open(status["key_path"], "rb") as stream:
        assert b"PRIVATE KEY" in stream.read()


def test_webroot_responder_rejects_path_traversal(tmp_path):
    responder = WebrootResponder(tmp_path)
    with pytest.raises(Exception):
        responder.install("../escape", "x")
