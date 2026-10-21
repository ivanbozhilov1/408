"""Small, bearer-protected shortlist API. Python standard library only."""

from __future__ import annotations

from collections import OrderedDict, deque
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import threading
import time
from urllib.parse import urlsplit


MAX_BODY = 1024
ALLOWED_ORIGIN = "https://ivanbozhilov1.github.io"
OPERATION_PATTERN = re.compile(r"[A-Za-z0-9_-]{8,128}\Z")
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{32,256}\Z")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def strict_json(raw: bytes):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result

    def invalid_constant(_):
        raise ValueError("invalid constant")

    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                      parse_constant=invalid_constant)


class Store:
    def __init__(self, data_dir: Path, allowed_ids: frozenset[str]):
        data_dir.mkdir(mode=0o755 if os.name == "nt" else 0o700, parents=True, exist_ok=True)
        self.path = data_dir / "picks.sqlite3"
        self.allowed_ids = allowed_ids
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS state (
                    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                    revision INTEGER NOT NULL,
                    updated_at TEXT
                );
                INSERT OR IGNORE INTO state VALUES (1, 0, NULL);
                CREATE TABLE IF NOT EXISTS picks (id TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS operations (
                    sequence INTEGER PRIMARY KEY,
                    operation_hash TEXT NOT NULL UNIQUE,
                    id TEXT NOT NULL,
                    starred INTEGER NOT NULL CHECK (starred IN (0, 1))
                );
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.execute("PRAGMA busy_timeout=5000")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def snapshot(db, role):
        revision, updated_at = db.execute(
            "SELECT revision, updated_at FROM state WHERE singleton = 1").fetchone()
        return {"revision": revision,
                "picks": [row[0] for row in db.execute("SELECT id FROM picks ORDER BY id")],
                "updatedAt": updated_at, "role": role}

    def read(self, role):
        with self.connect() as db:
            db.execute("BEGIN")
            return self.snapshot(db, role)

    def update(self, item_id, starred, operation_id):
        digest = hashlib.sha256(operation_id.encode("ascii")).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute(
                "SELECT id, starred FROM operations WHERE operation_hash = ?", (digest,)).fetchone()
            if previous is not None:
                if previous != (item_id, int(starred)):
                    return None
                return self.snapshot(db, "editor")
            was_starred = db.execute("SELECT 1 FROM picks WHERE id = ?", (item_id,)).fetchone() is not None
            if was_starred != starred:
                if starred:
                    db.execute("INSERT INTO picks VALUES (?)", (item_id,))
                else:
                    db.execute("DELETE FROM picks WHERE id = ?", (item_id,))
                db.execute("UPDATE state SET revision = revision + 1, updated_at = ?", (utc_now(),))
            db.execute("INSERT INTO operations (operation_hash, id, starred) VALUES (?, ?, ?)",
                       (digest, item_id, int(starred)))
            return self.snapshot(db, "editor")


class RateLimiter:
    """Bound memory and cap each independent request budget per rolling minute."""
    def __init__(self, limit=120):
        self.limit = limit
        self.peers = OrderedDict()
        self.lock = threading.Lock()

    def allow(self, peer):
        now = time.monotonic()
        with self.lock:
            requests = self.peers.pop(peer, deque())
            while requests and requests[0] <= now - 60:
                requests.popleft()
            allowed = len(requests) < self.limit
            if allowed:
                requests.append(now)
            self.peers[peer] = requests
            while len(self.peers) > 1024:
                self.peers.popitem(last=False)
            return allowed


class PicksServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, address, store, editor_hash, viewer_hash, allowed_origin=ALLOWED_ORIGIN):
        if allowed_origin != ALLOWED_ORIGIN:
            raise ValueError("PICKS_ALLOWED_ORIGIN must be the gallery origin")
        self.store = store
        self.editor_hash = editor_hash
        self.viewer_hash = viewer_hash
        self.allowed_origin = allowed_origin
        self.rate_limiter = RateLimiter()
        self.slots = threading.BoundedSemaphore(32)
        super().__init__(address, Handler)

    def get_request(self):
        request, peer = super().get_request()
        request.settimeout(10)
        return request, peer

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            body = b'{"error":"server busy"}'
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\n"
                                b"Content-Type: application/json\r\nCache-Control: no-store\r\n"
                                b"X-Content-Type-Options: nosniff\r\nConnection: close\r\n"
                                + f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body)
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        # Avoid request dumps, tracebacks, peer addresses, and authentication data.
        print("request failed", flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "PicksAPI"
    sys_version = ""

    def log_message(self, *_):
        pass

    def reply(self, status, value=None, extra_headers=None):
        body = b"" if value is None else json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.send_header("Vary", "Origin")
        headers = getattr(self, "headers", None)
        if headers is not None and headers.get_all("Origin", []) == [self.server.allowed_origin]:
            self.send_header("Access-Control-Allow-Origin", self.server.allowed_origin)
        for key, val in (extra_headers or {}).items():
            self.send_header(key, val)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_error(self, code, message=None, explain=None):
        self.reply(code, {"error": self.responses.get(code, ("request rejected",))[0]})

    def fail(self, status, message, headers=None):
        self.reply(status, {"error": message}, headers)

    def role(self):
        headers = self.headers.get_all("Authorization", [])
        token = headers[0][7:] if len(headers) == 1 and headers[0].startswith("Bearer ") else ""
        valid = TOKEN_PATTERN.fullmatch(token) is not None
        digest = hashlib.sha256(token.encode("ascii") if valid else b"").hexdigest()
        editor = hmac.compare_digest(digest, self.server.editor_hash)
        viewer = hmac.compare_digest(digest, self.server.viewer_hash)
        return "editor" if valid and editor else "viewer" if valid and viewer else None

    def dispatch(self):
        try:
            self.route()
        except (socket.timeout, TimeoutError):
            self.fail(408, "request timeout")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except sqlite3.Error:
            self.fail(503, "storage unavailable")
        except Exception:
            self.fail(500, "request failed")

    def route(self):
        # Authenticate before selecting a budget: a proxy peer represents many
        # people, and unauthenticated traffic must not consume their capacity.
        role = self.role()
        origins = self.headers.get_all("Origin", [])
        if self.command == "OPTIONS" and self.path in ("/api/health", "/api/picks"):
            preflight_headers = self.preflight_headers(self.path, origins)
            if preflight_headers is not None:
                # Browser preflights carry no bearer, so any shared proxy-peer
                # budget could prevent a fresh authorized browser connection.
                self.reply(204, extra_headers=preflight_headers)
                return
        if self.command == "OPTIONS":
            bucket = ("anonymous", self.client_address[0])
        elif self.command == "GET" and self.path == "/api/health":
            bucket = ("health", self.client_address[0])
        elif role is not None:
            bucket = ("authenticated", role)
        else:
            bucket = ("anonymous", self.client_address[0])
        if not self.server.rate_limiter.allow(bucket):
            self.fail(429, "too many requests", {"Retry-After": "60"})
            return
        if origins and origins != [self.server.allowed_origin]:
            self.fail(403, "origin denied")
            return
        try:
            target = urlsplit(self.path)
        except ValueError:
            self.fail(400, "invalid path")
            return
        if target.scheme or target.netloc or target.query or target.fragment:
            self.fail(400, "invalid path")
            return
        if target.path not in ("/api/health", "/api/picks"):
            self.fail(404, "not found")
            return
        if self.command == "OPTIONS":
            self.fail(403, "preflight denied")
            return
        if self.command not in ("GET", "PUT") or (target.path == "/api/health" and self.command != "GET"):
            self.fail(405, "method not allowed", {"Allow": "GET, OPTIONS" if target.path == "/api/health" else "GET, PUT, OPTIONS"})
            return
        if self.command == "GET":
            if self.headers.get_all("Transfer-Encoding", []) or self.headers.get_all("Content-Length", []) not in ([], ["0"]):
                self.fail(400, "unexpected body")
                return
            if target.path == "/api/health":
                self.reply(200, {"ok": True})
                return
        if role is None:
            self.fail(401, "authentication required", {"WWW-Authenticate": "Bearer"})
            return
        if self.command == "GET":
            self.reply(200, self.server.store.read(role))
            return
        if role != "editor":
            self.fail(403, "editor required")
            return
        self.put_pick()

    def preflight_headers(self, path, origins):
        methods = self.headers.get_all("Access-Control-Request-Method", [])
        requested_headers = self.headers.get_all("Access-Control-Request-Headers", [])
        allowed_methods = ("GET", "PUT") if path == "/api/picks" else ("GET",)
        header_names = [part.strip().lower() for part in requested_headers[0].split(",")] if len(requested_headers) == 1 else []
        if origins != [self.server.allowed_origin] or len(methods) != 1 or methods[0] not in allowed_methods:
            return None
        if len(requested_headers) > 1 or any(name not in ("authorization", "content-type") for name in header_names):
            return None
        if self.headers.get_all("Transfer-Encoding", []) or self.headers.get_all("Content-Length", []) not in ([], ["0"]):
            return None
        return {"Access-Control-Allow-Methods": ", ".join(allowed_methods),
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
                "Access-Control-Max-Age": "600"}

    def put_pick(self):
        if self.headers.get_all("Transfer-Encoding", []):
            self.fail(400, "transfer encoding unsupported")
            return
        lengths = self.headers.get_all("Content-Length", [])
        if not lengths:
            self.fail(411, "content length required")
            return
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,10}", lengths[0]):
            self.fail(400, "invalid content length")
            return
        length = int(lengths[0])
        if length > MAX_BODY:
            self.fail(413, "body too large")
            return
        content_types = self.headers.get_all("Content-Type", [])
        if len(content_types) != 1 or content_types[0].lower() not in ("application/json", "application/json; charset=utf-8"):
            self.fail(415, "application/json required")
            return
        raw = self.rfile.read(length)
        try:
            if len(raw) != length:
                raise ValueError("incomplete body")
            value = strict_json(raw)
        except (ValueError, UnicodeError, RecursionError):
            self.fail(400, "invalid JSON")
            return
        if (not isinstance(value, dict) or set(value) != {"id", "starred", "operationId"}
                or type(value["id"]) is not str or value["id"] not in self.server.store.allowed_ids
                or type(value["starred"]) is not bool or type(value["operationId"]) is not str
                or OPERATION_PATTERN.fullmatch(value["operationId"]) is None):
            self.fail(400, "invalid pick")
            return
        result = self.server.store.update(value["id"], value["starred"], value["operationId"])
        if result is None:
            self.fail(409, "operation already used")
            return
        self.reply(200, result)

    do_GET = dispatch
    do_PUT = dispatch
    do_OPTIONS = dispatch
    do_POST = dispatch
    do_DELETE = dispatch
    do_PATCH = dispatch
    do_HEAD = dispatch


def load_json_file(path, limit):
    with Path(path).open("rb") as file:
        raw = file.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("configuration too large")
    return strict_json(raw)


def from_environment():
    auth = load_json_file(os.environ["PICKS_AUTH_FILE"], 4096)
    if not isinstance(auth, dict) or set(auth) != {"editorHash", "viewerHash"}:
        raise ValueError("invalid auth file")
    hashes = [auth["editorHash"], auth["viewerHash"]]
    if any(type(value) is not str or re.fullmatch(r"[a-fA-F0-9]{64}", value) is None for value in hashes):
        raise ValueError("invalid auth digests")
    editor_hash, viewer_hash = (value.lower() for value in hashes)
    if hmac.compare_digest(editor_hash, viewer_hash):
        raise ValueError("roles need distinct tokens")
    catalog = load_json_file(os.environ["PICKS_CATALOG_FILE"], 4 * 1024 * 1024)
    if (not isinstance(catalog, list) or not catalog
            or any(type(item) is not str or not 1 <= len(item) <= 256 or any(ord(c) < 32 for c in item) for item in catalog)
            or len(set(catalog)) != len(catalog)):
        raise ValueError("invalid catalog")
    store = Store(Path(os.environ.get("PICKS_DATA_DIR", "/data")), frozenset(catalog))
    return PicksServer(("0.0.0.0", int(os.environ.get("PICKS_PORT", "8080"))), store,
                       editor_hash, viewer_hash, os.environ.get("PICKS_ALLOWED_ORIGIN", ALLOWED_ORIGIN))


def main():
    try:
        server = from_environment()
    except (KeyError, ValueError, OSError, sqlite3.Error):
        raise SystemExit("Invalid shortlist service configuration") from None
    print("shortlist service ready", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
