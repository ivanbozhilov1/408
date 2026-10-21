# Isah’s shared picks

The main `index.html` now shows all GPT/Astra and Claude/Fable designs together. Its `collection.js` shortlist saves only in the current browser and supports explicit export/import. It does not write to this shared service. The page links to the existing shared shortlist.

The original D/E/F page is preserved at `fable-def.html`; G/H/I, J/K/L and M/N/O retain their original folders. Existing root private-access links, shared-item links and D/E/F picks links route to `fable-def.html` with the fragment preserved. The patch tool targets this preserved page and keeps all243 shared item IDs unchanged. No service catalogue expansion or server change was required for the combined gallery.

Each browser connects once through its private access link. The editing link belongs to Isah; the viewing link shows her choices and cannot change them. Access links are delivered privately and never stored in this repository. Without a private connection, the original browser-only stars still work.

Connected pages refresh every five seconds while visible. Item changes are queued locally if the API is unavailable and retry automatically. The first editor connection adds the browser’s existing stars to the shared list. It never replaces the shared list with a local snapshot. Selections from other design sets appear below the current set’s shortlist. Disconnect restores that browser’s original local list.

The API stores item IDs, current selections, revisions, timestamps and operation hashes in SQLite. Operation hashes remain for the shortlist’s lifetime so old retries cannot undo newer decisions. No financial accounts, Airtable data, provider credentials or analytics are involved. The public client contains the API address, not the private access credentials.

## Maintaining new design sets

Preserve the existing render assets and the shared-picks changes. After adding or rebuilding a folder, run from this repository:

```sh
python ops/picks/patch_gallery.py . --api https://seo.cebugrandrealty.com:8443/api/picks --catalog ops/picks/catalog.json
python -m unittest discover -s ops/picks -p test_server.py -v
```

Copy the updated catalogue into the dedicated deployment at `/docker/unit408-picks/catalog.json` and restart only that project before publishing new item IDs. Catalogue updates preserve old selections. The backend source and Compose definition live in `ops/picks/`; `auth.json` must contain only the two SHA256 token hashes and is ignored by Git. Tokens must never be committed, placed in public JavaScript, included in query strings, or logged.

## Deployment and rollback

The dedicated Compose project is `unit408-picks` on the current Hermes server. Its API binds only to `127.0.0.1:8740`; a separate Caddy sidecar exposes authenticated HTTPS on the public IP’s port8443 through the existing hostname. The existing private Tailscale Serve443 route is separate and must remain unchanged. Persistence is Docker volume `unit408-picks_picks-data`, with SQLite at `/data/picks.sqlite3`.

The HTTPS sidecar receives only a scoped certificate/key copy for the existing hostname, never the shared ACME store. A dedicated certificate refresh task follows updates to that existing certificate and restarts only the HTTPS sidecar. Check certificate renewal health as part of the host’s existing TLS maintenance.

Before changing persisted data, export through the authenticated GET `/api/picks` or make a SQLite backup. To stop sync, stop only the `unit408-picks` Compose project using its base and HTTPS override files, and disable only its certificate-refresh timer. Keep its data volume. Reverting the sync release restores browser-only stars; retain the deployment data and private links for recovery. Rotate the two capability credentials only through a separate explicit owner request.

Verification for this release includes20 backend tests,11 isolated browser workflows, independent code/privacy review, and separate live checks recorded by the deploying task. Private links and raw user choices do not belong in public test reports.
