# Gallery changes

This repository is the published Unit408 design gallery. Preserve existing design assets and concurrent publications. Keep edits limited to the requested feature or design set.

Shared stars are implemented by `ops/picks/client.js` and the additive `ops/picks/patch_gallery.py` tool. Read `SHARED-PICKS.md` before rebuilding or adding a set. Regenerate shared-picks scripts and the catalogue after a rebuild, update only the isolated shortlist service’s catalogue, and verify the affected workflows. Do not overwrite the sync code with an older generated site.js.

Never commit private access links, raw bearer tokens, auth.json, environment credentials or SQLite data. Use synthetic credentials and selections in tests. Preserve the dedicated API data and the server’s unrelated private routes.

When regenerating furniture choices, use a fresh private preference export and follow `ops/picks/REGENERATION.md`. Run the candidate gate before rendering, preserve preferred identities, and do not publish a view containing an excluded product or similar rejected traits. Metadata checks do not verify an image: required source-photo reviews and final visual review must be real, never fabricated. Keep preference exports and human-review manifests outside public Git history.

Gallery renders are served as WebP (a 2 MB PNG took 3–10 s per view switch). After adding or re-rendering a set in `collection-data.json`, run `node ops/images/webp_views.mjs .` (needs Playwright); it encodes each referenced PNG render to a WebP beside it and repoints the data, leaving PNGs and product photos alone.
