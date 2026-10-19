"""A small, dependency-light ACME v2 client (RFC 8555).

Only what the manager needs is implemented: account registration, an
HTTP-01 challenge and certificate issuance/renewal. Signing uses EC P-256
(ES256) through ``cryptography``; every HTTP call goes through an injectable
transport so the protocol can be exercised against a fake ACME server in the
tests without touching the public endpoint.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

PRODUCTION_DIRECTORY = "https://acme-v02.api.letsencrypt.org/directory"
STAGING_DIRECTORY = "https://acme-staging-v02.api.letsencrypt.org/directory"


class AcmeError(RuntimeError):
    """An ACME problem document, reduced to a readable message."""


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def public_jwk(key: ec.EllipticCurvePrivateKey) -> dict[str, str]:
    numbers = key.public_key().public_numbers()
    size = (numbers.curve.key_size + 7) // 8
    return {
        "crv": "P-256",
        "kty": "EC",
        "x": _b64(numbers.x.to_bytes(size, "big")),
        "y": _b64(numbers.y.to_bytes(size, "big")),
    }


def key_thumbprint(key: ec.EllipticCurvePrivateKey) -> str:
    jwk = public_jwk(key)
    return _b64(hashlib.sha256(_json_bytes(jwk)).digest())


def sign_es256(key: ec.EllipticCurvePrivateKey, data: bytes) -> bytes:
    """RFC 7518 ES256: SHA-256 signature as raw r||s, not DER."""
    r, s = decode_dss_signature(key.sign(data, ec.ECDSA(hashes.SHA256())))
    size = (key.curve.key_size + 7) // 8
    return r.to_bytes(size, "big") + s.to_bytes(size, "big")


def _default_transport(url: str, method: str, body: bytes | None,
                       headers: dict[str, str]) -> tuple[int, dict[str, str], str]:
    request = urllib.request.Request(
        url, data=body, method=method,
        headers={**headers, "User-Agent": "20negar-manager/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return response.status, dict(response.headers), raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:  # ACME reports errors as JSON bodies
        raw = exc.read()
        return exc.code, dict(exc.headers), raw.decode("utf-8", "replace")


Transport = Callable[[str, str, bytes | None, dict[str, str]], tuple[int, dict[str, str], str]]


class ChallengeHandler:
    """Publishes one ``/.well-known/acme-challenge/<token>`` answer at a time."""

    def install(self, token: str, content: str) -> None:
        raise NotImplementedError

    def remove(self, token: str) -> None:
        raise NotImplementedError


class AcmeClient:
    def __init__(self, key_path: Path, transport: Transport | None = None,
                 directory_url: str = PRODUCTION_DIRECTORY) -> None:
        self.key_path = Path(key_path)
        self.transport = transport or _default_transport
        self.directory_url = directory_url
        self.key = self._load_or_create_key()
        self.directory: dict[str, Any] = {}
        self.account_url: str | None = None
        self._nonces: list[str] = []

    # -- key handling ------------------------------------------------------
    def _load_or_create_key(self) -> ec.EllipticCurvePrivateKey:
        if self.key_path.exists():
            key = serialization.load_pem_private_key(self.key_path.read_bytes(), password=None)
            if isinstance(key, ec.EllipticCurvePrivateKey):
                return key
        key = ec.generate_private_key(ec.SECP256R1())
        self.key_path.parent.mkdir(parents=True, exist_ok=True)
        self.key_path.write_bytes(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()))
        try:
            self.key_path.chmod(0o600)
        except OSError:
            pass
        return key

    # -- transport ---------------------------------------------------------
    def _error_from(self, status: int, body: str) -> AcmeError:
        try:
            problem = json.loads(body)
            detail = problem.get("detail") or problem.get("type") or body
        except ValueError:
            detail = body
        return AcmeError(f"ACME request failed ({status}): {str(detail).strip()}")

    @staticmethod
    def _nonce_from(headers: dict[str, str]) -> str | None:
        return headers.get("Replay-Nonce") or headers.get("replay-nonce")

    def _next_nonce(self) -> str:
        if self._nonces:
            return self._nonces.pop()
        status, headers, _body = self.transport(self.directory["newNonce"], "HEAD", None, {})
        nonce = self._nonce_from(headers)
        if status >= 400 or not nonce:
            raise AcmeError(f"ACME did not provide a nonce ({status}).")
        return nonce

    def _signed_post(self, url: str, payload: Any, *,
                     force_jwk: bool = False) -> tuple[int, dict[str, str], str]:
        """Sign and send a request. ``payload`` of ``None`` is a POST-as-GET."""
        for attempt in range(3):
            protected: dict[str, Any] = {"alg": "ES256", "nonce": self._next_nonce(), "url": url}
            if force_jwk or not self.account_url:
                protected["jwk"] = public_jwk(self.key)
            else:
                protected["kid"] = self.account_url
            encoded_payload = "" if payload is None else _b64(_json_bytes(payload))
            signing_input = f"{_b64(_json_bytes(protected))}.{encoded_payload}".encode("ascii")
            body = _json_bytes({
                "protected": _b64(_json_bytes(protected)),
                "payload": encoded_payload,
                "signature": _b64(sign_es256(self.key, signing_input)),
            })
            status, headers, response_body = self.transport(
                url, "POST", body, {"Content-Type": "application/jose+json"})
            nonce = self._nonce_from(headers)
            if nonce:
                self._nonces.append(nonce)
            if status == 400 and "badNonce" in response_body and attempt < 2:
                self._nonces.clear()
                continue
            return status, headers, response_body
        raise AcmeError("ACME rejected every nonce; try again in a moment.")

    def _post(self, url: str, payload: Any, *,
              force_jwk: bool = False) -> tuple[int, dict[str, str], str]:
        return self._signed_post(url, payload, force_jwk=force_jwk)

    def _post_json(self, url: str, payload: Any, *,
                   force_jwk: bool = False) -> tuple[int, dict[str, str], dict[str, Any]]:
        status, headers, body = self._post(url, payload, force_jwk=force_jwk)
        if status >= 400:
            raise self._error_from(status, body)
        try:
            parsed = json.loads(body)
        except ValueError as exc:
            raise AcmeError(f"ACME returned an unexpected answer: {body[:200]}") from exc
        if not isinstance(parsed, dict):
            raise AcmeError(f"ACME returned an unexpected answer: {body[:200]}")
        return status, headers, parsed

    # -- protocol ----------------------------------------------------------
    def _load_directory(self) -> dict[str, Any]:
        request = urllib.request.Request(self.directory_url, method="GET",
                                         headers={"User-Agent": "20negar-manager/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8", "replace")
                nonce = self._nonce_from(dict(response.headers))
        except urllib.error.HTTPError as exc:
            raise self._error_from(exc.code, exc.read().decode("utf-8", "replace")) from exc
        except (urllib.error.URLError, OSError) as exc:
            raise AcmeError(f"Could not reach the ACME directory: {exc}") from exc
        if nonce:
            self._nonces.append(nonce)
        self.directory = json.loads(body)
        return self.directory

    def register_account(self, email: str | None, terms_agreed: bool = True) -> str:
        if not self.directory:
            self._load_directory()
        payload: dict[str, Any] = {"termsOfServiceAgreed": bool(terms_agreed)}
        contact = str(email or "").strip()
        if contact:
            payload["contact"] = [f"mailto:{contact}"]
        status, headers, body = self._post(self.directory["newAccount"], payload, force_jwk=True)
        if status >= 400 and "account already exists" not in body.lower():
            raise self._error_from(status, body)
        account_url = headers.get("Location") or headers.get("location")
        if not account_url:
            raise AcmeError("ACME did not return an account URL.")
        self.account_url = account_url
        return account_url

    def _wait_for(self, url: str, wanted: set[str], attempts: int = 90,
                  interval: float = 2.0, label: str = "resource") -> dict[str, Any]:
        last: dict[str, Any] = {}
        for _ in range(attempts):
            _status, _headers, body = self._post(url, None)
            try:
                last = json.loads(body) if isinstance(body, str) else body
            except ValueError as exc:
                raise AcmeError(f"Unexpected ACME answer for the {label}.") from exc
            if not isinstance(last, dict):
                raise AcmeError(f"Unexpected ACME answer for the {label}.")
            status = str(last.get("status", ""))
            if status in wanted:
                return last
            if status in {"invalid", "deactivated", "revoked"}:
                raise AcmeError(f"The ACME {label} failed: {json.dumps(last)[:400]}")
            time.sleep(interval)
        raise AcmeError(f"Timed out waiting for the ACME {label}.")

    def obtain_certificate(self, domain: str, handler: ChallengeHandler,
                           email: str | None = None,
                           terms_agreed: bool = True) -> tuple[bytes, bytes]:
        """Return ``(fullchain_pem, private_key_pem)`` for ``domain``."""
        domain = str(domain).strip().lower().rstrip(".")
        if not domain or any(char.isspace() for char in domain) or "/" in domain:
            raise AcmeError(f"Invalid domain name: {domain!r}")
        if not self.directory:
            self._load_directory()
        self.register_account(email, terms_agreed=terms_agreed)

        _status, headers, order = self._post_json(
            self.directory["newOrder"],
            {"identifiers": [{"type": "dns", "value": domain}]})
        order_url = headers.get("Location") or headers.get("location") or ""
        if not isinstance(order, dict):
            raise AcmeError("ACME returned an unexpected order document.")

        thumbprint = key_thumbprint(self.key)
        for authz_url in order.get("authorizations", []):
            _s, _h, authz = self._post_json(authz_url, None)
            if str(authz.get("status")) == "valid":
                continue
            challenge = next((c for c in authz.get("challenges", [])
                              if c.get("type") == "http-01"), None)
            if not challenge or not challenge.get("url"):
                raise AcmeError("This identifier only allows a DNS challenge, which the "
                                "manager cannot answer automatically.")
            token = str(challenge.get("token") or "")
            if not token:
                raise AcmeError("ACME did not provide a challenge token.")
            handler.install(token, f"{token}.{thumbprint}")
            try:
                self._post(challenge["url"], {})
                self._wait_for(authz_url, {"valid"}, label="domain validation")
            finally:
                handler.remove(token)

        leaf_key = ec.generate_private_key(ec.SECP256R1())
        csr = (x509.CertificateSigningRequestBuilder()
               .subject_name(x509.Name([
                   x509.NameAttribute(x509.oid.NameOID.COMMON_NAME, domain)]))
               .add_extension(x509.SubjectAlternativeName([x509.DNSName(domain)]),
                              critical=False)
               .sign(leaf_key, hashes.SHA256()))
        _s, _h, finalized = self._post_json(
            order["finalize"], {"csr": _b64(csr.public_bytes(serialization.Encoding.DER))})

        state = finalized
        if str(state.get("status")) != "valid":
            if not order_url:
                raise AcmeError("ACME did not return an order URL.")
            state = self._wait_for(order_url, {"valid"}, label="certificate issuance")
        certificate_url = state.get("certificate")
        if not certificate_url:
            raise AcmeError(f"ACME did not return a certificate: {json.dumps(state)[:300]}")

        status, _headers, fullchain = self._post(certificate_url, None)
        if status >= 400:
            raise self._error_from(status, fullchain)
        if "BEGIN CERTIFICATE" not in fullchain:
            raise AcmeError("ACME returned an unexpected certificate body.")

        key_pem = leaf_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()).decode("ascii")
        return fullchain.encode("utf-8"), key_pem.encode("ascii")
