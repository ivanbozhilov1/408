# Unit 408 shortlist service

An isolated Python standard-library HTTP + SQLite API for the public gallery's
private shared stars. It stores catalogue item IDs, the current starred set,
a revision and UTC update timestamp, and a durable idempotency log. It accepts
no furniture descriptions, names, contact information, or tokens in the database.

## Configuration

Set `PICKS_DATA_DIR`, `PICKS_AUTH_FILE`, `PICKS_CATALOG_FILE`,
`PICKS_ALLOWED_ORIGIN`, and optionally `PICKS_PORT` (default `8080`). The origin
must be exactly `https://ivanbozhilov1.github.io`. The auth file is a JSON object
with exactly `editorHash` and `viewerHash`: distinct SHA-256 hex digests of
separately generated random bearer tokens. Generate tokens with at least
32 random bytes using `secrets.token_urlsafe(32)`; distribute them privately,
never commit or log them. Tokens use 32–256 URL-safe ASCII characters. The
catalogue file is a nonempty JSON array of unique allowed item ID strings.

`auth.json` and `catalog.json` must be prepared by the deployer in this folder.
Keep the auth file readable by container UID/GID `10001` and restrict access to
other host users. The checked-in Compose mounts both files read-only, exposes
only `127.0.0.1:8740`, and gives the nonroot container only the data volume as
writable storage. The application filesystem is read-only. No ingress or HTTPS
configuration is included. Configure the existing HTTPS proxy separately before
using the API from the gallery. Browser access requires HTTPS.

## API

- `GET /api/health` returns only `{"ok":true}` and requires no bearer.
- `GET /api/picks` accepts either role's `Authorization: Bearer TOKEN`.
- `PUT /api/picks` requires the editor bearer and `Content-Type: application/json`.
  Body: `{"id":"catalogue-id","starred":true,"operationId":"unique-operation-id"}`.
- Successful pick reads/writes return
  `{"revision":1,"picks":["catalogue-id"],"updatedAt":"2026-10-21T00:00:00.000Z","role":"editor"}`.
  The viewer bearer returns `"role":"viewer"`. An empty initial set has revision
  `0` and `updatedAt: null`. The revision/timestamp change only when the set changes.

`operationId` must have 8–128 URL-safe ASCII letters, digits, underscores or
hyphens; a fresh UUID per user action works. Retry an uncertain request with the
same operation ID. Repeating it returns the **current** set without replaying
the old mutation. Reusing it for another mutation returns `409`. The log retains
accepted operation hashes, item IDs, and starred state for the same lifetime as
the shortlist, with no automatic expiry or eviction. Plaintext operation IDs and
credentials are never stored. An old offline retry returns the current set
without overwriting a later choice, even after many newer operations.
Item writes and idempotency checks run in one SQLite
transaction, so simultaneous edits of different items are preserved. Reads use
a consistent database snapshot. Restart retains the set and replay protection.

New mutations accept only current catalogue IDs. Existing selections and replay
records are retained when the catalogue shrinks and remain available after it
expands. Reads include all saved selections, including temporarily unavailable
IDs. Catalogue changes do not modify the revision or saved timestamp.
Before updating the catalogue or service, stop the service and back up the data
volume plus auth/catalogue files. Restore that copy with the corresponding
catalogue and application files to roll back. There is no public backup/export
endpoint. Before any user-requested purge, export a complete backup of the
stopped service's data volume and matching configuration. Purging must be an
explicit user request and include review of pending offline retries; deleting
replay records removes the protection against old accepted operations.

Every API response is `no-store` with `nosniff`, JSON errors, and an explicit
content length. Cookies are neither used nor accepted as authentication. Browser
origins other than the exact gallery origin are rejected. CLI requests without
an Origin header still need the bearer. Preflight permits only GET/PUT as
applicable and the `Authorization`/`Content-Type` request headers. It grants no
credentialed-cookie access. Body size is capped at 1024 bytes, sockets time out
after 10 seconds, concurrency is capped at 32, and each independent request
budget is capped at 120 per minute. Valid editor and viewer credentials have
separate budgets; anonymous traffic and public health have separate peer
budgets. Validated, body-free preflights for the exact origin, supported method,
and allowed headers bypass request budgets and retain thread/connection caps.
Malformed preflights use the anonymous budget. Forwarded headers are not trusted.
This isolates authenticated users and health checks from anonymous API floods
behind a proxy and keeps fresh browser connections available after OPTIONS floods.
Logs contain no request targets or tokens.

## Verification and operation

Security repair evidence: independent review identified a shared proxy-peer rate
bucket that let anonymous requests consume authenticated and health capacity,
and startup pruning that deleted saved selections when the catalogue shrank.
The repaired request budgets and non-destructive startup are covered by flood
isolation and catalogue shrink/expand/restart regressions. Rollback requires
restoring the prior application files; preserve the data volume and catalogue
when reverting, because the previous startup pruning behavior is destructive.
Preflight re-review found that a shared proxy-peer OPTIONS budget could still
block new browser connections. Fully validated, cheap preflights now bypass
that budget; malformed preflights remain subject to anonymous limiting. Regression
checks send over 120 valid OPTIONS requests before a fresh editor connection.
Final replay review found that indefinite offline retries outlive a bounded
idempotency log: evicting a successful, unacknowledged operation can apply its
stale mutation again. Accepted operation hashes now have the same retention as
the shortlist, with no automatic eviction. The regression processes over 4096
later operations, unstars the original item, restarts, and proves replay of its
original star cannot resurrect the selection.

Run `python -m unittest discover -s tools/unit408_picks -p test_server.py -v`
from the repository root. Tests use only random ephemeral tokens and temporary
databases. For local operation, set the environment above and run `python
tools/unit408_picks/server.py`. Production operation uses `docker compose up -d
--build` from this folder after provisioning files and reviewing proxy routing.
This repository change does not deploy the service or create/distribute tokens.

Test environment note: Python 3.13 on restricted Windows creates `0700`
temporary directories with ACLs that exclude the sandbox process. Integration
fixtures therefore create random disposable folders beside the test file with
inherited workspace ACLs. Production Linux data directories still use `0700`.
Local HTTP integration checks need loopback networking; the restricted Windows
sandbox blocks that socket access. SQLite connections are explicitly closed,
including test inspection connections, to permit immediate fixture cleanup.
