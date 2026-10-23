# Local gallery release

`public_artifact.py` packages the already published gallery. `release.py prepare` admits a **new, independently accepted** view into a fresh local release. Neither command changes picks, pushes Git, deploys Pages, or creates an approval. Keep real acceptance evidence and personal preference snapshots outside Git/public artifacts.

```sh
python ops/release/public_artifact.py --gallery . --out ../public --cache-dir ../render-cache --chromium /path/to/chrome
python ops/release/release.py prepare --gallery /current/gallery --accepted-manifest /private/accepted.json --catalogue /private/catalogue-readback.json --out /fresh/release --chromium /path/to/chrome
python ops/release/release.py readback --manifest /fresh/release/release-manifest.json --base-url https://ivanbozhilov1.github.io/408/ --chromium /path/to/chrome
```

The operator selects the trusted gallery. The deterministic checker is always its canonical `ops/picks/check_design.mjs` and adjacent `preferences.js` and `usage.js`; a job cannot supply an executable or shell hook. Prepare requires a clean tracked checkout, pins HEAD, queries the actual `origin/main` tip with read-only `git ls-remote`, requires it match `targetHead` and be an ancestor, and repeats admission after encoding. A repository with no origin can prepare a synthetic/local fixture but records a deployment hold. No implicit Git/API/network mutation occurs.

Only upload `public/`. The sibling `stage/`, `changed-assets/`, acceptance references and release receipt are local review materials. `changed-assets/` contains only runtime files whose bytes differ from the selected checkout; `release-manifest.json` records their before/after hashes and the approved PNG source changes. Originals and previous derivatives remain in the source repository. Publication consumes owner-approved images; flags in a manifest are never a substitute for actually doing the independent review.

## Accepted manifest, schema 1

See [accepted-manifest.schema.json](accepted-manifest.schema.json). Paths in file bindings are relative to the accepted manifest directory, or absolute. All `sha256` values bind exact file bytes. `contract.sha256` is the **file** hash; `contract_sha256` inside a frozen contract is its canonical unsigned JSON hash, as produced by the design pack tool.

```json
{
  "schema": 1,
  "galleryHead": "<exact committed checkout SHA>",
  "targetHead": "<actual origin/main SHA>",
  "acceptedAt": "2026-10-23T12:00:00+08:00",
  "contract": {"path": "input-contract.json", "sha256": "<file SHA256>"},
  "nativeInputs": [{"path": "native/geometry.json", "sha256": "<SHA256>"}],
  "sourceImages": [{"path": "accepted/view.png", "sha256": "<SHA256>"}],
  "preference": {"revision": 7, "checkedRevision": 7, "exclusionRevision": 7, "checkedExclusionRevision": 7},
  "candidateGate": {
    "checkerSha256": "<trusted gallery checker hash>", "preferencesSha256": "<trusted preference dependency hash>", "usageSha256": "<trusted usage dependency hash>", "preferenceRevision": 7,
    "brief": {"path": "current-brief.json", "sha256": "<SHA256>"},
    "candidates": {"path": "candidates.json", "sha256": "<SHA256>"},
    "result": {"path": "candidate-check.json", "sha256": "<exact checker stdout SHA256>"}
  },
  "review": {"path": "independent-review.json", "sha256": "<SHA256>"},
  "productBindings": [{"catalogueId": "stable-gallery-id", "candidateId": "frozen-product-id", "photoSha256": "<actual supplier photo SHA256>"}],
  "views": [{"id": "S-entry", "jobId": "S-entry", "designId": "namespace::S", "slot": "entry", "sourcePath": "accepted/view.png", "sourceSha256": "<SHA256>", "destination": "assets/S-entry.png", "productIds": ["stable-gallery-id"], "width": 1448, "height": 1086, "hero": true}],
  "publicFiles": []
}
```

The abbreviated `nativeInputs` example must be expanded to **every** frozen source group (dimension owner, geometry, cameras, scene, lighting, visibility, owner rules, preferences, exclusions), selected supplier photos, fixed inputs, source review and distinctness review. The contract must be unexpired `design-pack-inputs/v1` with a valid intrinsic hash. Preferences/exclusions must match both frozen and checked revisions. Source files, photos, candidate identities and per-view visibility are checked again. Any reviewed public HTML/data overlay uses `{path, sha256, destination}` in `publicFiles`; the independent review must bind the identical list. New sets must supply reviewed collection data; existing slots require exact `designId`/`slot` targets.

For a brief with `generation.unusedItemsOnly:true`, add `candidateGate.collection:{path,sha256}` bound to the operator-selected gallery's complete `collection-data.json`. It must match `preference_gate.collection` in the frozen contract. The checker receives that canonical collection, so all saved versions and reused model variants remain part of the unused-product test. `usageSha256` must match the contract's `usage_dependency` as well as the current canonical file. Changes to either dependency or the collection require renewed evidence; an older usage snapshot cannot silently pass.

The real independent review JSON contains `accepted:true`, `independent:true`, `reviewer:{id,role:"independent"}`, `unresolvedCritical:[]`, `acceptedAt`, the exact contract **file** hash in `contractSha256`, identical `nativeInputs`/`sourceImages` arrays, `preference:{revision,exclusionRevision}`, and identical `publicFiles` if used. Do not synthesize this receipt for a real view. Tests use clearly labelled synthetic evidence only.

The catalogue input is a **sanitized independent readback**, not the repository's allowed-ID file:

```json
{"schema":1,"service":"unit408-picks","independentReadback":true,"verifiedAt":"2026-10-23T12:00:00+08:00","revision":7,"ids":["stable-gallery-id"]}
```

It must be no older than 24 hours. Missing IDs produce an exact HOLD list before staging. The ordered handoff is: update **only** the dedicated picks catalogue within existing authority, independently read it back, rerun prepare, obtain the existing owner release approval, deploy once, run readback. The CLI has no credentials/API writer and cannot bypass this order. Preserve stable IDs, old picks, exclusions, private links and permanent operations. Existing API deployment/rollback rules remain in [REGENERATION.md](../picks/REGENERATION.md).

## Public policy and cache

Every existing public HTML route is an entrypoint, including hidden archives/boards. Follow its actual local HTML/CSS/JS fetch/data/image/font/download graph. Keep required supplier photos, plans and explicitly linked original downloads. Provenance-only JSON `sourcePath`/`sourceImage` fields do not demand deployment of original PNGs; originals stay in Git. Never delete source assets. Missing links, escaping paths/symlinks, private operations paths, credentials, actual `#sync=` access links and encoded access links stop the build. Unreferenced source files, operational scripts/docs, private exports, review receipts, logs, environment files and SQLite are not copied.

The encoder only migrates declared collection render slots/history plus explicitly named legacy renders; it preserves product photos, source-photo boards and room-model PNGs. Generated WebPs use source SHA256 + quality + encoder revision + Chromium executable SHA256 in their immutable path. Metadata records separate `sourceSha256` and `servedSha256`, dimensions and settings; the old ambiguous view `sha256` is removed. Cache hits require a matching key and verified served bytes. A changed same-path PNG or quality cannot reuse an older WebP. Optional cache directories contain WebP bytes and derivative hash metadata only. CI restores this cache across runs.

## Independent readback and timing

Readback checks the served public manifest, every asset hash/size with six GET workers, and every derivative's actual browser-decoded hash/dimensions. It visits combined/archive/Fable/human-view workflows, switches a view where available, and waits for a loaded image. All requests are constrained to the explicit base origin/path, service workers are blocked, and redirects are rejected before the browser follows them. Local verification can use `node ops/release/readback.mjs --manifest PUBLIC/public-manifest.json --serve-dir PUBLIC --chromium EXE`; its ephemeral server closes afterward.

The prepared receipt records accepted-to-prepare wait, preflight, copy/stage, encode/build, postflight and total prepare time. Readback writes `readback-receipt.json` with accepted-to-independent-acceptance time. Supply `--deployment-started-at` and `--deployment-completed-at` only from actual deployment evidence. Missing deployment/handoff intervals remain explicitly unmeasured; a local build is not a completed production release.

## Pages cutover and rollback

The repository previously used legacy branch Pages builds and had no checked-in workflow. The new workflow builds/verifies a dedicated directory on PRs and uploads **only** that directory. It deploys only approved code reaching `main` (or a manual workflow on `main`). The owner must separately change Pages `build_type` to workflow after review; adding this file does not claim that cutover happened. Existing shallow checkout behavior is retained; one Pages concurrency group serializes each ref. Roll back the UI/tooling commit without downgrading the exclusion-capable API or deleting original images/cache/history.

Run `python -m unittest discover -s ops/release -p 'test_*.py'`, `UNIT408_CHROMIUM=EXE node --test ops/images/test_webp_views.mjs ops/release/test_readback.mjs`, and the existing picks preference/client tests. Full synthetic prepare requires `UNIT408_CHROMIUM`. No paid rendering or paid QA is used.
