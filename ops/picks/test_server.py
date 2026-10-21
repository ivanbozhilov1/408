"""Integration checks use ephemeral credentials and temporary data only."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import threading
import unittest
from unittest.mock import patch

import server


@contextmanager
def temporary_fixture():
    # Python 3.13's Windows 0700 tempfile ACL excludes the restricted sandbox.
    base = Path(__file__).resolve().parent
    path = base / (".test-tmp-" + secrets.token_hex(12))
    path.mkdir(mode=0o755 if os.name == "nt" else 0o700)
    try:
        yield path
    finally:
        if path.resolve().parent != base:
            raise RuntimeError("test cleanup escaped fixture directory")
        shutil.rmtree(path)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = temporary_fixture()
        self.data = self.temp.__enter__() / "data"
        self.editor = secrets.token_urlsafe(32)
        self.viewer = secrets.token_urlsafe(32)
        self.ids = frozenset({"def:D-BED", "jkl:J-BED", "mno:M-BED"}
                             | {f"def:item-{number}" for number in range(16)})
        self.httpd = None
        self.start()

    def start(self):
        self.httpd = server.PicksServer(
            ("127.0.0.1", 0), server.Store(self.data, self.ids),
            hashlib.sha256(self.editor.encode()).hexdigest(),
            hashlib.sha256(self.viewer.encode()).hexdigest())
        self.thread = threading.Thread(target=self.httpd.serve_forever,
                                       kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()

    def stop(self):
        if self.httpd is not None:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.thread.join(timeout=3)
            self.httpd = None

    def tearDown(self):
        self.stop()
        self.temp.__exit__(None, None, None)

    def request(self, method="GET", path="/api/picks", token=None, payload=None,
                raw=None, headers=None):
        request_headers = dict(headers or {})
        if token:
            request_headers["Authorization"] = "Bearer " + token
        if payload is not None:
            raw = json.dumps(payload).encode()
            request_headers.setdefault("Content-Type", "application/json")
        conn = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        try:
            conn.request(method, path, body=raw, headers=request_headers)
            response = conn.getresponse()
            body = response.read()
            result_headers = dict(response.getheaders())
            self.assertEqual(int(result_headers["Content-Length"]), len(body))
            self.assertEqual(result_headers["Cache-Control"], "no-store")
            self.assertEqual(result_headers["X-Content-Type-Options"], "nosniff")
            return response.status, json.loads(body) if body else None, result_headers
        finally:
            conn.close()

    def put(self, item_id="def:D-BED", starred=True, operation="operation-0001", token=None):
        return self.request("PUT", token=token or self.editor,
                            payload={"id": item_id, "starred": starred, "operationId": operation})

    def decide(self, decision="excluded", item_id="def:D-BED", operation="decision-0001",
               exclusion=None, token=None, restore_revision=None):
        payload = {"id": item_id, "decision": decision, "operationId": operation}
        if decision == "excluded":
            payload["exclusion"] = exclusion if exclusion is not None else {"traits": [], "note": ""}
        if restore_revision is not None:
            payload["restoreRevision"] = restore_revision
        return self.request("PUT", token=token or self.editor, payload=payload)

    def test_public_health_and_private_read_auth(self):
        status, data, _ = self.request(path="/api/health")
        self.assertEqual((status, data), (200, {"ok": True}))
        self.assertEqual(self.request()[0], 401)
        self.assertEqual(self.request(token=secrets.token_urlsafe(32))[0], 401)
        self.assertEqual(self.request(headers={"Cookie": "Authorization=" + self.editor})[0], 401)
        for token, role in ((self.editor, "editor"), (self.viewer, "viewer")):
            status, data, _ = self.request(token=token)
            self.assertEqual(status, 200)
            self.assertEqual(data, {"revision": 0, "picks": [], "exclusions": [], "preferenceSchema": 2,
                                    "updatedAt": None, "role": role})

    def test_viewer_cannot_write(self):
        self.assertEqual(self.put(token=self.viewer)[0], 403)
        self.assertEqual(self.decide(token=self.viewer)[0], 403)
        self.assertEqual(self.request(token=self.editor)[1]["revision"], 0)
        self.assertEqual(self.request("PUT", payload={"id": "def:D-BED", "starred": True,
                                                     "operationId": "operation-0001"})[0], 401)

    def test_persistence_and_replay_protection_survive_restart(self):
        status, data, _ = self.put()
        self.assertEqual(status, 200)
        self.assertEqual(data["revision"], 1)
        self.assertEqual(data["picks"], ["def:D-BED"])
        self.assertRegex(data["updatedAt"], r"^\d{4}-\d\d-\d\dT.*Z$")
        timestamp = data["updatedAt"]
        self.stop()
        self.start()
        self.assertEqual(self.request(token=self.viewer)[1],
                         {"revision": 1, "picks": ["def:D-BED"], "exclusions": [], "preferenceSchema": 2,
                          "updatedAt": timestamp, "role": "viewer"})
        self.put(starred=False, operation="operation-0002")
        self.assertEqual(self.put()[1]["picks"], [])
        self.assertEqual(self.request(token=self.viewer)[1]["revision"], 2)
        self.assertEqual(self.put(item_id="jkl:J-BED")[0], 409)
        self.assertEqual(self.request(token=self.viewer)[1]["picks"], [])

    def test_noop_does_not_change_revision_or_time(self):
        data = self.put(starred=False)[1]
        self.assertEqual((data["revision"], data["updatedAt"]), (0, None))
        initial = self.put(operation="operation-0002")[1]
        repeated = self.put(operation="operation-0003")[1]
        self.assertEqual(initial, repeated)

    def test_simultaneous_item_writes_are_not_lost(self):
        def write(number):
            return self.put(f"def:item-{number}", operation=f"parallel-{number:04}")
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(write, range(16)))
        self.assertEqual([status for status, _, _ in results], [200] * 16)
        status, state, _ = self.request(token=self.viewer)
        self.assertEqual(status, 200)
        self.assertEqual(state["revision"], 16)
        self.assertEqual(set(state["picks"]), {f"def:item-{number}" for number in range(16)})

    def test_simultaneous_same_operation_is_applied_once(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.put(), range(8)))
        self.assertEqual([status for status, _, _ in results], [200] * 8)
        self.assertEqual(self.request(token=self.editor)[1]["revision"], 1)

    def test_cors_exact_origin_and_preflight(self):
        status, _, headers = self.request(token=self.viewer, headers={"Origin": server.ALLOWED_ORIGIN})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], server.ALLOWED_ORIGIN)
        self.assertNotIn("Access-Control-Allow-Credentials", headers)
        self.assertNotIn("Set-Cookie", headers)
        for origin in ("https://evil.example", "null", server.ALLOWED_ORIGIN + ".evil.example", server.ALLOWED_ORIGIN + "/"):
            status, _, headers = self.request(token=self.viewer, headers={"Origin": origin})
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Origin", headers)
        base = {"Origin": server.ALLOWED_ORIGIN, "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "authorization, content-type"}
        status, body, headers = self.request("OPTIONS", headers=base)
        self.assertEqual((status, body), (204, None))
        self.assertEqual(headers["Access-Control-Allow-Headers"], "Authorization, Content-Type")
        self.assertEqual(self.request("OPTIONS", headers={**base, "Access-Control-Request-Headers": "x-user"})[0], 403)
        self.assertEqual(self.request("OPTIONS", headers={**base, "Access-Control-Request-Method": "DELETE"})[0], 403)
        self.assertEqual(self.request("OPTIONS")[0], 403)

    def test_validation_rejects_unknown_ids_types_and_fields(self):
        good = {"id": "def:D-BED", "starred": True, "operationId": "operation-0001"}
        invalid = [[], None, "string", {}, {**good, "extra": 1},
                   {**good, "id": "unlisted"}, {**good, "id": 1}, {**good, "id": ["def:D-BED"]},
                   {**good, "starred": 1}, {**good, "starred": "true"},
                   {**good, "operationId": 12}, {**good, "operationId": "short"},
                   {**good, "operationId": "x" * 129}, {**good, "operationId": "operation\n0001"}]
        for value in invalid:
            with self.subTest(value=value):
                raw = json.dumps(value).encode()
                self.assertEqual(self.request("PUT", token=self.editor, raw=raw,
                                              headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request(token=self.viewer)[1]["revision"], 0)

    def test_rejects_malformed_utf8_json_and_duplicate_keys(self):
        for raw in (b"\xff", b"{", b'{"id":"def:D-BED","id":"jkl:J-BED","starred":true,"operationId":"operation-0001"}',
                    b'{"id":"def:D-BED","starred":NaN,"operationId":"operation-0001"}'):
            self.assertEqual(self.request("PUT", token=self.editor, raw=raw,
                                          headers={"Content-Type": "application/json"})[0], 400)

    def test_body_and_content_type_limits(self):
        self.assertEqual(self.request("PUT", token=self.editor, raw=b"x" * (server.MAX_BODY + 1),
                                      headers={"Content-Type": "application/json"})[0], 413)
        self.assertEqual(self.request("PUT", token=self.editor, raw=b"x" * 1024,
                                      headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("PUT", token=self.editor, raw=b"{}",
                                      headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("PUT", token=self.editor, raw=b"{}",
                                      headers={"Content-Type": "application/json", "Transfer-Encoding": "chunked"})[0], 400)
        self.assertEqual(self.request(raw=b"body", token=self.editor)[0], 400)

    def test_duplicate_content_length_is_rejected(self):
        conn = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        try:
            conn.putrequest("PUT", "/api/picks")
            conn.putheader("Authorization", "Bearer " + self.editor)
            conn.putheader("Content-Type", "application/json")
            conn.putheader("Content-Length", "2")
            conn.putheader("Content-Length", "2")
            conn.endheaders(b"{}")
            response = conn.getresponse()
            self.assertEqual(response.status, 400)
            self.assertEqual(json.loads(response.read()), {"error": "invalid content length"})
        finally:
            conn.close()

    def test_error_routes_and_request_targets_are_json(self):
        self.assertEqual(self.request(path="/missing")[0], 404)
        self.assertEqual(self.request(path="/api/picks?token=never-log-this", token=self.editor)[0], 400)
        self.assertEqual(self.request("POST", token=self.editor)[0], 405)
        self.assertEqual(self.request("TRACE", token=self.editor)[0], 501)

    def test_rate_limit(self):
        self.httpd.rate_limiter = server.RateLimiter(limit=1)
        self.assertEqual(self.request(path="/api/health")[0], 200)
        status, _, headers = self.request(path="/api/health")
        self.assertEqual(status, 429)
        self.assertEqual(headers["Retry-After"], "60")

    def test_anonymous_flood_cannot_throttle_roles_health_or_preflight(self):
        self.httpd.rate_limiter = server.RateLimiter(limit=2)
        self.assertEqual(self.request()[0], 401)
        self.assertEqual(self.request(token=secrets.token_urlsafe(32))[0], 401)
        self.assertEqual(self.request()[0], 429)
        self.assertEqual(self.request(token=self.editor)[0], 200)
        self.assertEqual(self.request(token=self.viewer)[0], 200)
        self.assertEqual(self.request(path="/api/health")[0], 200)
        self.assertEqual(self.request("OPTIONS", headers={
            "Origin": server.ALLOWED_ORIGIN, "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization, content-type"})[0], 204)

    def test_authenticated_role_budgets_are_separate(self):
        self.httpd.rate_limiter = server.RateLimiter(limit=1)
        self.assertEqual(self.request(token=self.editor)[0], 200)
        self.assertEqual(self.request(token=self.editor)[0], 429)
        self.assertEqual(self.request(token=self.viewer)[0], 200)
        self.assertEqual(self.request(path="/api/health")[0], 200)

    def test_valid_preflight_flood_cannot_block_fresh_editor_connection(self):
        headers = {"Origin": server.ALLOWED_ORIGIN, "Access-Control-Request-Method": "PUT",
                   "Access-Control-Request-Headers": "authorization, content-type"}
        for _ in range(125):
            self.assertEqual(self.request("OPTIONS", headers=headers)[0], 204)
        self.assertEqual(self.request("OPTIONS", headers=headers)[0], 204)
        self.assertEqual(self.request(token=self.editor, headers={"Origin": server.ALLOWED_ORIGIN})[0], 200)
        self.assertEqual(self.put(operation="post-preflight-flood")[0], 200)

    def test_malformed_preflights_use_anonymous_budget(self):
        self.httpd.rate_limiter = server.RateLimiter(limit=1)
        invalid = {"Origin": server.ALLOWED_ORIGIN, "Access-Control-Request-Method": "DELETE"}
        self.assertEqual(self.request("OPTIONS", headers=invalid)[0], 403)
        self.assertEqual(self.request("OPTIONS", headers=invalid)[0], 429)
        self.assertEqual(self.request("OPTIONS", headers={
            "Origin": server.ALLOWED_ORIGIN, "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization"})[0], 204)
        self.assertEqual(self.request(token=self.editor)[0], 200)

    def test_old_operation_survives_over_4096_later_operations_and_restart(self):
        self.assertEqual(self.put()[1]["picks"], ["def:D-BED"])
        # Exercise real transactional writes without HTTP rate limiting; the
        # first accepted mutation and its final replay still use the API.
        for number in range(4100):
            self.httpd.store.update("jkl:J-BED", False, f"later-operation-{number:04}")
        self.assertEqual(self.put(starred=False, operation="latest-user-choice")[1]["picks"], [])
        self.stop()
        self.start()
        replay = self.put()[1]
        self.assertEqual((replay["revision"], replay["picks"]), (2, []))
        with closing(sqlite3.connect(self.httpd.store.path)) as db:
            rows = db.execute("SELECT operation_hash, id, starred FROM operations").fetchall()
            self.assertEqual(len(rows), 4102)
            self.assertTrue(all(len(row[0]) == 64 for row in rows))
            self.assertIn((hashlib.sha256(b"operation-0001").hexdigest(), "def:D-BED", 1), rows)
            dump = "\n".join(db.iterdump())
            self.assertNotIn(self.editor, dump)
            self.assertNotIn(self.viewer, dump)
            self.assertNotIn("later-operation-4099", dump)

    def test_catalogue_shrink_and_expand_preserve_picks_and_replay_log(self):
        original = self.put()[1]
        original_ids = self.ids
        self.stop()
        self.ids = frozenset({"jkl:J-BED"})
        self.start()
        state = self.request(token=self.viewer)[1]
        self.assertEqual((state["revision"], state["picks"], state["updatedAt"]),
                         (1, ["def:D-BED"], original["updatedAt"]))
        self.assertEqual(self.put()[0], 400)
        with closing(sqlite3.connect(self.httpd.store.path)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM operations").fetchone()[0], 1)
        self.stop()
        self.ids = original_ids
        self.start()
        self.assertEqual(self.request(token=self.editor)[1], original)
        self.assertEqual(self.put(starred=False, operation="operation-0002")[1]["picks"], [])
        replay = self.put()[1]
        self.assertEqual((replay["revision"], replay["picks"]), (2, []))

    def test_decisions_are_mutually_exclusive_and_restoration_is_explicit(self):
        preferred = self.decide("preferred")[1]
        self.assertEqual((preferred["picks"], preferred["exclusions"]), (["def:D-BED"], []))
        exclusion = {"traits": ["tufted upholstery"], "note": "Avoid dust-catching details."}
        excluded = self.decide(operation="decision-0002", exclusion=exclusion)[1]
        self.assertEqual((excluded["revision"], excluded["picks"], excluded["exclusions"]),
                         (2, [], [{"id": "def:D-BED", **exclusion}]))
        self.assertEqual(self.decide("preferred", operation="decision-0003")[0], 409)
        restored = self.decide("neutral", operation="decision-0004", restore_revision=2)[1]
        self.assertEqual((restored["revision"], restored["picks"], restored["exclusions"]), (3, [], []))
        preferred = self.decide("preferred", operation="decision-0005")[1]
        self.assertEqual((preferred["revision"], preferred["picks"], preferred["exclusions"]),
                         (4, ["def:D-BED"], []))
        neutral = self.decide("neutral", operation="decision-0006")[1]
        self.assertEqual((neutral["revision"], neutral["picks"], neutral["exclusions"]), (5, [], []))
        self.decide(operation="decision-0007")
        neutral = self.decide("neutral", operation="decision-0008", restore_revision=6)[1]
        self.assertEqual((neutral["revision"], neutral["picks"], neutral["exclusions"]), (7, [], []))

    def test_offline_preferred_and_neutral_cannot_remove_newer_exclusion(self):
        excluded = self.decide()[1]
        status, conflict, _ = self.decide("preferred", operation="offline-preferred")
        self.assertEqual(status, 409)
        self.assertEqual({key: value for key, value in conflict.items() if key != "error"}, excluded)
        self.assertEqual(self.decide("neutral", operation="offline-neutral")[1], excluded)
        self.assertEqual(self.request(token=self.editor)[1], excluded)

    def test_stale_explicit_restore_uses_global_revision_and_preserves_exclusion(self):
        self.decide()
        changed = self.decide("preferred", item_id="jkl:J-BED", operation="another-preference")[1]
        status, conflict, _ = self.decide("neutral", operation="stale-restore", restore_revision=1)
        self.assertEqual(status, 409)
        self.assertEqual(conflict["revision"], 2)
        self.assertEqual(conflict["exclusions"], changed["exclusions"])
        restored = self.decide("neutral", operation="current-restore", restore_revision=2)[1]
        self.assertEqual((restored["revision"], restored["exclusions"]), (3, []))
        self.assertEqual(self.decide("neutral", operation="noop-restore", restore_revision=3)[1], restored)

    def test_accepted_restore_retry_cannot_clear_later_reexclusion(self):
        self.decide()
        self.decide("neutral", operation="accepted-restore", restore_revision=1)
        excluded_again = self.decide(operation="exclude-again")[1]
        self.stop()
        self.start()
        self.assertEqual(self.decide("neutral", operation="accepted-restore", restore_revision=1)[1],
                         excluded_again)
        self.assertEqual(self.decide("neutral", operation="accepted-restore", restore_revision=3)[0], 409)
        self.assertEqual(self.decide("neutral", operation="accepted-restore")[0], 409)
        self.assertEqual(self.request(token=self.editor)[1], excluded_again)

    def test_old_client_cannot_restore_exclusion(self):
        self.put()
        excluded = self.decide()[1]
        self.assertEqual(self.put(operation="old-new-operation")[0], 409)
        self.assertEqual(self.put()[0], 409)
        self.assertEqual(self.put(starred=False, operation="legacy-unstar-01")[1], excluded)
        self.assertEqual(self.request(token=self.editor)[1], excluded)
        with closing(sqlite3.connect(self.httpd.store.path)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM operations").fetchone()[0], 2)

    def test_decision_idempotency_payload_conflict_and_cross_form_conflict(self):
        initial = self.decide()[1]
        self.assertEqual(self.decide()[1], initial)
        self.assertEqual(self.decide("preferred")[0], 409)
        self.assertEqual(self.decide(item_id="jkl:J-BED")[0], 409)
        self.assertEqual(self.decide(exclusion={"traits": [], "note": "changed"})[0], 409)
        self.assertEqual(self.decide(exclusion={"traits": ["wood"], "note": ""})[0], 409)
        self.assertEqual(self.put(starred=False, operation="decision-0001")[0], 409)
        self.assertEqual(self.put(item_id="jkl:J-BED")[0], 200)
        self.assertEqual(self.decide("preferred", item_id="jkl:J-BED", operation="operation-0001")[0], 409)
        self.assertEqual(self.request(token=self.editor)[1]["revision"], 2)

    def test_offline_exclusion_retry_after_restore_does_not_reapply(self):
        self.decide()
        neutral = self.decide("neutral", operation="decision-restore", restore_revision=1)[1]
        self.assertEqual(self.decide()[1], neutral)
        self.decide(operation="decision-again")
        self.decide("neutral", operation="decision-restore-again", restore_revision=3)
        preferred = self.decide("preferred", operation="decision-prefer")[1]
        self.stop()
        self.start()
        self.assertEqual(self.decide()[1], preferred)
        self.assertEqual(self.decide(operation="decision-again")[1], preferred)
        self.assertEqual(self.decide("neutral", operation="decision-restore", restore_revision=1)[1], preferred)

    def test_exclusion_persistence_edit_and_noop(self):
        exclusion = {"traits": ["woven shade", "exposed bulb"], "note": "Bedroom only: café style."}
        original = self.decide(exclusion=exclusion)[1]
        self.assertEqual(self.decide(exclusion=exclusion, operation="decision-noop")[1], original)
        self.stop()
        self.start()
        self.assertEqual(self.request(token=self.editor)[1], original)
        edited = self.decide(exclusion={**exclusion, "note": "Updated"}, operation="decision-edit")[1]
        self.assertEqual(edited["revision"], original["revision"] + 1)
        self.assertEqual(edited["exclusions"][0]["note"], "Updated")

    def test_exclusions_survive_catalogue_shrink_and_expand(self):
        original = self.decide()[1]
        ids = self.ids
        self.stop()
        self.ids = frozenset({"jkl:J-BED"})
        self.start()
        self.assertEqual(self.request(token=self.editor)[1], original)
        self.assertEqual(self.decide("neutral", operation="decision-restore")[0], 400)
        self.stop()
        self.ids = ids
        self.start()
        self.assertEqual(self.decide()[1], original)
        self.assertEqual(self.decide("neutral", operation="decision-restore", restore_revision=1)[1]["exclusions"], [])

    def test_restore_revision_validation_requires_safe_integer_and_neutral(self):
        good = {"id": "def:D-BED", "decision": "neutral", "operationId": "validate-restore", "restoreRevision": 0}
        invalid = [{**good, "restoreRevision": value}
                   for value in (None, True, False, -1, 1.0, "1", [], 9007199254740992)]
        invalid += [{**good, "decision": "preferred"},
                    {**good, "decision": "excluded", "exclusion": {"traits": [], "note": ""}}]
        for value in invalid:
            with self.subTest(value=value):
                self.assertEqual(self.request("PUT", token=self.editor, payload=value)[0], 400)
        self.assertTrue(server.valid_decision({**good, "restoreRevision": 9007199254740991}))
        self.assertEqual(self.request("PUT", token=self.editor, payload=good)[0], 200)
        self.assertEqual(self.request(token=self.editor)[1]["revision"], 0)

    def test_decision_validation_rejects_invalid_shapes_and_bounds(self):
        good = {"id": "def:D-BED", "decision": "excluded", "operationId": "decision-0001",
                "exclusion": {"traits": [], "note": ""}}
        invalid = [{**good, "decision": value} for value in (None, [], 1, "hide", "neutral", "preferred")]
        invalid += [{**good, "starred": True}, {key: value for key, value in good.items() if key != "exclusion"}]
        invalid += [{**good, "exclusion": value} for value in (
            None, [], {}, {"traits": []}, {"note": ""}, {"traits": [], "note": "", "extra": True},
            {"traits": "wood", "note": ""}, {"traits": [None], "note": ""},
            {"traits": [[]], "note": ""}, {"traits": [""], "note": ""},
            {"traits": [" \n "], "note": ""}, {"traits": ["oak", "oak"], "note": ""},
            {"traits": [str(number) for number in range(17)], "note": ""},
            {"traits": ["a" * 81], "note": ""}, {"traits": ["\ud800"], "note": ""},
            {"traits": [], "note": None}, {"traits": [], "note": "n" * 501},
            {"traits": [], "note": "\ud800"})]
        for value in invalid:
            with self.subTest(value=value):
                self.assertEqual(self.request("PUT", token=self.editor, payload=value)[0], 400)
        self.assertEqual(self.request(token=self.editor)[1]["revision"], 0)
        with closing(sqlite3.connect(self.httpd.store.path)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM decision_operations").fetchone()[0], 0)
        boundary = {"traits": [str(number) + "a" * 78 for number in range(16)], "note": "n" * 500}
        self.assertEqual(self.decide(exclusion=boundary)[0], 200)

    def test_concurrent_decisions_remain_atomic(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda number: self.decide(
                "excluded" if number % 2 else "preferred", operation=f"concurrent-{number:04}"), range(16)))
        self.assertTrue(all(status in (200, 409) for status, _, _ in results))
        for _, state, _ in results:
            self.assertFalse(set(state["picks"]) & {row["id"] for row in state["exclusions"]})
        with closing(sqlite3.connect(self.httpd.store.path)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM decision_operations").fetchone()[0],
                             sum(status == 200 for status, _, _ in results))

    def test_decision_failure_rolls_back_item_and_revision(self):
        original = self.put()[1]
        with closing(sqlite3.connect(self.httpd.store.path)) as db:
            db.execute("CREATE TRIGGER fail_operation BEFORE INSERT ON decision_operations "
                       "BEGIN SELECT RAISE(ABORT, 'test storage failure'); END")
        self.assertEqual(self.decide()[0], 503)
        self.assertEqual(self.request(token=self.editor)[1], original)

    def test_decision_replay_survives_over_4096_operations_and_restart(self):
        self.decide()
        restored = self.decide("neutral", operation="decision-restore", restore_revision=1)[1]
        for number in range(4100):
            self.httpd.store.update_decision("jkl:J-BED", "neutral", f"later-decision-{number:04}")
        self.stop()
        self.start()
        self.assertEqual(self.decide()[1], restored)
        with closing(sqlite3.connect(self.httpd.store.path)) as db:
            rows = db.execute("SELECT operation_hash FROM decision_operations").fetchall()
            self.assertEqual(len(rows), 4102)
            self.assertTrue(all(len(row[0]) == 64 for row in rows))
            self.assertNotIn("later-decision-4099", "\n".join(db.iterdump()))


class ConfigurationTests(unittest.TestCase):
    def test_existing_v1_database_upgrade_preserves_state_and_replays(self):
        with temporary_fixture() as directory:
            digest = hashlib.sha256(b"legacy-operation").hexdigest()
            with closing(sqlite3.connect(directory / "picks.sqlite3")) as db:
                db.executescript("""
                    CREATE TABLE state (singleton INTEGER PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT);
                    INSERT INTO state VALUES (1, 7, '2026-10-20T00:00:00.000Z');
                    CREATE TABLE picks (id TEXT PRIMARY KEY);
                    INSERT INTO picks VALUES ('def:D-BED');
                    CREATE TABLE operations (sequence INTEGER PRIMARY KEY, operation_hash TEXT NOT NULL UNIQUE,
                                             id TEXT NOT NULL, starred INTEGER NOT NULL);
                """)
                db.execute("INSERT INTO operations VALUES (1, ?, 'def:D-BED', 1)", (digest,))
                db.commit()
            store = server.Store(directory, frozenset({"def:D-BED"}))
            state = store.read("editor")
            self.assertEqual(state, {"revision": 7, "updatedAt": "2026-10-20T00:00:00.000Z", "role": "editor",
                                     "picks": ["def:D-BED"], "exclusions": [], "preferenceSchema": 2})
            self.assertEqual(store.update("def:D-BED", True, "legacy-operation"), state)
            self.assertIsNone(store.update_decision("def:D-BED", "preferred", "legacy-operation"))
            store.update_decision("def:D-BED", "excluded", "new-exclusion", {"traits": [], "note": ""})
            with closing(sqlite3.connect(store.path)) as db:
                self.assertEqual(db.execute("SELECT * FROM operations").fetchall(), [(1, digest, "def:D-BED", 1)])

    def test_environment_validates_hash_only_auth_and_catalogue(self):
        with temporary_fixture() as directory:
            root = Path(directory)
            auth = root / "auth.json"
            catalogue = root / "catalog.json"
            hashes = {"editorHash": "a" * 64, "viewerHash": "b" * 64}
            auth.write_text(json.dumps(hashes), encoding="utf-8")
            catalogue.write_text('["def:D-BED"]', encoding="utf-8")
            config = {"PICKS_AUTH_FILE": str(auth), "PICKS_CATALOG_FILE": str(catalogue),
                      "PICKS_DATA_DIR": str(root / "data"), "PICKS_PORT": "0",
                      "PICKS_ALLOWED_ORIGIN": server.ALLOWED_ORIGIN}
            with patch.dict(os.environ, config):
                instance = server.from_environment()
                instance.server_close()
                for invalid in ({"editorToken": "secret", "viewerToken": "secret"},
                                {"editorHash": "a" * 64, "viewerHash": "a" * 64},
                                {**hashes, "token": "secret"}):
                    auth.write_text(json.dumps(invalid), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        server.from_environment()
                auth.write_text(json.dumps(hashes), encoding="utf-8")
                for invalid_catalogue in ('[]', '["def:D-BED", "def:D-BED"]', '[1]', '{}'):
                    catalogue.write_text(invalid_catalogue, encoding="utf-8")
                    with self.assertRaises(ValueError):
                        server.from_environment()


if __name__ == "__main__":
    unittest.main()
