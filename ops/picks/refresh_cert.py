"""Root-only extraction of the dedicated shortlist HTTPS certificate.

No ACME renewal, DNS changes, or other services are managed here. Run with
--no-restart before initially creating the HTTPS sidecar. Identical installed
material is a no-op; failed sidecar restarts are retried on the next invocation.
Only root on the host reads the ACME source. The sidecar gets the extracted
single-host certificate/key through its scoped read-only TLS mount.

References:
https://caddyserver.com/docs/caddyfile/directives/tls
https://docs.docker.com/reference/cli/docker/compose/restart/
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hmac
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
import tempfile


HOSTNAME = "seo.cebugrandrealty.com"
ACME_FILE = Path("/var/lib/docker/volumes/traefik_traefik-letsencrypt/_data/acme.json")
APP_DIR = Path("/docker/unit408-picks")
TLS_GID = 10001


class RefreshError(Exception):
    """A safe, non-secret diagnostic suitable for timer logs."""


def select_bundle(document):
    """Select exactly one certificate dedicated solely to the expected host."""
    if not isinstance(document, dict):
        raise RefreshError("Invalid ACME document")
    matches = []
    for resolver in document.values():
        if not isinstance(resolver, dict):
            continue
        for entry in resolver.get("Certificates", []):
            if not isinstance(entry, dict):
                continue
            domain = entry.get("domain", {})
            if not isinstance(domain, dict) or domain.get("main") != HOSTNAME:
                continue
            sans = domain.get("sans") or []
            if not isinstance(sans, list) or any(name != HOSTNAME for name in sans):
                continue
            try:
                cert = base64.b64decode(entry["certificate"], validate=True)
                key = base64.b64decode(entry["key"], validate=True)
            except (KeyError, ValueError, TypeError, binascii.Error):
                raise RefreshError("Invalid certificate encoding") from None
            if not cert or not key or len(cert) > 262144 or len(key) > 65536:
                raise RefreshError("Invalid certificate size")
            matches.append((cert, key))
    if len(matches) != 1:
        raise RefreshError("Expected one dedicated SEO certificate")
    return matches[0]


def run_checked(args, message, timeout=15):
    try:
        result = subprocess.run(args, input=b"", stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RefreshError(message) from None
    if result.returncode:
        raise RefreshError(message)
    return result.stdout


def validate_bundle(cert_path, key_path, openssl="/usr/bin/openssl", minimum_validity=86400):
    cert_args = [openssl, "x509", "-in", str(cert_path)]
    run_checked(cert_args + ["-checkend", str(minimum_validity), "-noout"],
                "Certificate is expired or too close to expiry")
    run_checked(cert_args + ["-checkhost", HOSTNAME, "-noout"], "Certificate hostname mismatch")
    extension = run_checked(cert_args + ["-noout", "-ext", "subjectAltName"],
                            "Certificate SAN validation failed").decode("ascii", errors="strict")
    names = ",".join(extension.splitlines()[1:]).strip().split(",")
    if not names or any(name.strip() != "DNS:" + HOSTNAME for name in names):
        raise RefreshError("Certificate must cover only the SEO hostname")
    cert_public = run_checked(cert_args + ["-pubkey", "-noout"], "Certificate public key invalid")
    key_public = run_checked([openssl, "pkey", "-in", str(key_path), "-passin", "pass:", "-pubout"],
                             "Private key validation failed")
    if not hmac.compare_digest(cert_public, key_public):
        raise RefreshError("Certificate and private key do not match")


def atomic_write(path, contents, mode=0o640):
    temporary = path.with_name("." + path.name + "." + secrets.token_hex(12))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(contents)
            stream.flush()
            os.fchown(stream.fileno(), 0, TLS_GID)
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def refresh(args):
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise RefreshError("Certificate refresh requires root on the Linux host")
    import fcntl

    tls_dir = args.tls_dir
    if tls_dir.is_symlink():
        raise RefreshError("TLS directory must not be a symlink")
    tls_dir.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(tls_dir, 0, TLS_GID)
    os.chmod(tls_dir, 0o750)
    lock_fd = os.open(tls_dir / ".refresh.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "wb") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        source_fd = os.open(args.acme_file, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(source_fd, "rb") as source:
            metadata = os.fstat(source.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0:
                raise RefreshError("ACME source must be a regular root-owned file")
            raw = source.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise RefreshError("ACME source exceeds size limit")
        cert, key = select_bundle(json.loads(raw))
        with tempfile.TemporaryDirectory(prefix=".validate-", dir=tls_dir) as temporary:
            temporary = Path(temporary)
            cert_path, key_path = temporary / "cert.pem", temporary / "key.pem"
            cert_path.write_bytes(cert)
            key_path.write_bytes(key)
            os.chmod(key_path, 0o600)
            validate_bundle(cert_path, key_path, args.openssl, args.minimum_validity_seconds)
        paths = [tls_dir / "cert.pem", tls_dir / "key.pem"]
        if any(path.is_symlink() for path in paths):
            raise RefreshError("TLS output files must not be symlinks")
        changed = any(not path.exists() or not hmac.compare_digest(path.read_bytes(), material)
                      for path, material in zip(paths, (cert, key)))
        pending = tls_dir / ".restart-needed"
        if changed:
            if not args.no_restart:
                atomic_write(pending, b"pending\n", 0o600)
            for path, material in zip(paths, (cert, key)):
                atomic_write(path, material)
        else:
            for path in paths:
                os.chown(path, 0, TLS_GID)
                os.chmod(path, 0o640)
        if not args.no_restart and (changed or pending.exists()):
            # Explicit service plus --no-deps never restarts picks or Traefik.
            run_checked([args.docker, "compose", "--project-directory", str(args.compose_dir),
                         "-f", str(args.compose_dir / "compose.yaml"),
                         "-f", str(args.compose_dir / "compose.https.yaml"),
                         "restart", "--no-deps", "--timeout", "20", "https"],
                        "HTTPS sidecar restart failed; next refresh will retry", timeout=60)
            pending.unlink(missing_ok=True)
            return "Certificate installed; HTTPS sidecar restarted"
        return "Certificate installed; restart skipped" if changed else "Certificate unchanged"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acme-file", type=Path, default=ACME_FILE)
    parser.add_argument("--tls-dir", type=Path, default=APP_DIR / "tls")
    parser.add_argument("--compose-dir", type=Path, default=APP_DIR)
    parser.add_argument("--openssl", default="/usr/bin/openssl")
    parser.add_argument("--docker", default="/usr/bin/docker")
    parser.add_argument("--minimum-validity-seconds", type=int, default=86400)
    parser.add_argument("--no-restart", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.minimum_validity_seconds <= 31536000:
        parser.error("minimum validity must be between zero and one year")
    try:
        message = refresh(args)
    except RefreshError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError):
        print("Certificate refresh failed", file=sys.stderr)
        return 1
    print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
