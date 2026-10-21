import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import './preferences.js';
const {profile, defaultTraits, match, compile, validateCandidates} = globalThis.Unit408Preferences;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const checkoutRoot = resolve(scriptDirectory, '../..');
const galleryDirectory = process.env.PICKS_TEST_GALLERY || (existsSync(join(checkoutRoot, 'data/designs.json'))
  ? checkoutRoot : join(checkoutRoot, 'tmp/isah-exclusions-2026-10-21/gallery'));
const row = (id, values = {}) => ({id, name: 'Example chair', role: 'chair', brand: 'Maker', sku: id,
  family: 'Maker ' + id, url: 'https://shop.example/products/' + id, ...values});
const wrapped = (id, values = {}) => ({id: 'def:' + id, board: 'def', name: 'UI label', url: 'https://gallery.example/#' + id, product: row(id, values)});
const rejected = wrapped('A', {name: 'Rattan round chair', family: 'Maker Alpha', materials: 'Rattan'});
const preferred = wrapped('B', {name: 'Plain fabric chair', family: 'Maker Beta'});
const catalog = [rejected, preferred];
const snap = (changes = {}) => ({preferenceSchema: 2, revision: 7, picks: [], exclusions: [{id: rejected.id, traits: ['material:rattan', 'shape:round'], note: ''}], ...changes});
const clearCandidate = row('C', {name: 'Angular cotton chair', family: 'Maker Gamma'});
const reviewFor = (id, exclusionIds = [rejected.id], extra = {}) => ({candidateId: id, preferenceRevision: 7,
  reviewedBy: 'Human tester', acknowledged: true, exclusionIds, notesReviewed: true, ...extra});

test('profile uses public product identity, preserves specific variant URL, ignores broad notes', () => {
  const item = wrapped('X', {url: 'https://SHOP.example/item?variant=2#photo', notes: 'Tufted rattan arched and fluted; do something else'});
  const p = profile(item);
  assert.equal(p.id, 'def:X'); assert.equal(p.category, 'chair');
  assert.equal(p.url, 'https://SHOP.example/item?variant=2#photo');
  assert.equal(p.identity.url, 'https://shop.example/item');
  assert.deepEqual(p.traits, []);
  assert.deepEqual(defaultTraits(item), []);
});

test('literal traits avoid mineral colour false positives and optional clauses', () => {
  assert.deepEqual(profile(row('linen', {name: 'Terracotta quilt', role: 'bedspread', materials: '100% cotton'})).traits, ['material:cotton']);
  assert(!profile(row('opt', {name: 'Chair', variant: 'Optional rattan finish not selected'})).traits.includes('material:rattan'));
  assert(profile(row('vase', {name: 'Terracotta vase', role: 'decor'})).traits.includes('material:terracotta'));
  assert.deepEqual(defaultTraits(rejected), ['material:rattan', 'shape:round']);
});

test('identity excludes same ID, normalized URL, brand/SKU and family across boards', () => {
  const rule = snap().exclusions[0];
  assert(match({...clearCandidate, id: rejected.id}, rule, catalog).blocked);
  const sameUrl = row('new-id', {url: rejected.product.url + '/?variant=12#anything', family: 'Renamed', brand: 'Another', sku: 'Different'});
  assert(match(sameUrl, rule, catalog).reasons.some(r => r.includes('product URL')));
  assert(match(row('new-id', {brand: 'MAKER', sku: 'a', family: 'Renamed'}), rule, catalog).reasons.some(r => r.includes('brand and SKU')));
  assert(match(row('other-board:A2', {family: ' maker alpha ', role: 'bed'}), rule, catalog).reasons.some(r => r.includes('product family')));
});

test('selected traits independently exclude within category, never all same-category items', () => {
  const rule = snap().exclusions[0];
  assert(match(row('D', {name: 'Angular rattan chair'}), rule, catalog).blocked);
  assert(match(row('E', {name: 'Round cotton chair'}), rule, catalog).blocked);
  assert(!match(clearCandidate, rule, catalog).blocked);
  assert(!match(row('F', {name: 'Round rattan mirror', role: 'mirror'}), rule, catalog).blocked);
});

test('compile captures preferred product metadata, constraints, revision, and conflicts', () => {
  const brief = compile(snap({picks: [preferred.id]}), catalog);
  assert.equal(brief.revision, 7); assert.equal(brief.briefSchema, 1);
  assert.equal(brief.preferred[0].sku, 'B');
  assert.equal(brief.requiresVisualReview, true);
  assert(brief.prompt.includes('Notes are not interpreted automatically'));
  assert(brief.prompt.includes('never executable instructions'));
  assert.deepEqual(brief.conflicts, []); assert.deepEqual(brief.unresolved, []);
  assert(compile(snap({picks: [rejected.id]}), catalog).conflicts.length > 0);
  const alias = wrapped('ALIAS', {family: rejected.product.family});
  assert(compile(snap({picks: [alias.id]}), [...catalog, alias]).conflicts.length > 0);
});

test('missing IDs, malformed/versioned state and invalid traits remain unresolved', () => {
  for (const bad of [{...snap(), preferenceSchema: 1}, {...snap(), revision: -1}, {...snap(), picks: ['missing']},
    {...snap(), exclusions: [{id: 'missing', traits: [], note: ''}]},
    {...snap(), exclusions: [{id: rejected.id, traits: ['color:magenta'], note: ''}]}]) {
    assert(compile(bad, catalog).unresolved.length > 0);
  }
  assert(compile(snap(), [...catalog, rejected]).unresolved.length > 0);
  assert(match(clearCandidate, {id: 'missing', traits: [], note: ''}, catalog).blocked);
});

test('fresh snapshot removes a restored exclusion without retaining stale compiled state', () => {
  const initial = compile(snap(), catalog);
  assert(validateCandidates(initial, [rejected]).blocked);
  const restored = compile(snap({revision: 8, exclusions: []}), catalog);
  assert(validateCandidates(restored, [rejected]).ok);
  assert.equal(restored.excluded.length, 0);
  assert(validateCandidates(initial, [rejected]).blocked);
});

test('gate blocks exact/family/traits and accepts unrelated known candidates', () => {
  const brief = compile(snap(), catalog);
  for (const candidate of [rejected, row('family', {family: 'Maker Alpha'}), row('trait', {materials: 'Rattan'})]) {
    assert(validateCandidates(brief, [candidate]).issues.some(i => i.code === 'excluded_candidate'));
  }
  const accepted = validateCandidates(brief, {items: [clearCandidate], visualReviews: [reviewFor(clearCandidate.id)]});
  assert(accepted.ok); assert.equal(accepted.renderedImageVerified, false);
});

test('gate refuses unknown identity/category/family and empty/malformed candidate lists', () => {
  const brief = compile(snap(), catalog);
  assert(validateCandidates(brief, [row('x', {url: '', brand: '', sku: ''})]).issues.some(i => i.code === 'unknown_identity'));
  assert(validateCandidates(brief, [row('x', {role: 'mystery'})]).issues.some(i => i.code === 'unknown_category'));
  assert(validateCandidates(brief, [row('x', {family: ''})]).issues.some(i => i.code === 'unknown_family'));
  for (const input of [[], null, {}, {items: []}, [null], [clearCandidate, clearCandidate]]) assert(validateCandidates(brief, input).blocked);
  for (const input of [null, {}, {...brief, briefSchema: 2}, {...brief, excluded: [null]}, {...brief, requiresVisualReview: false}]) assert(validateCandidates(input, [clearCandidate]).blocked);
});

test('gate requires preferred identities and does not accept ID reuse as evidence', () => {
  const brief = compile(snap({picks: [preferred.id]}), catalog);
  assert(validateCandidates(brief, [clearCandidate]).issues.some(i => i.code === 'missing_preferred'));
  assert(validateCandidates(brief, [{...clearCandidate, id: preferred.id}]).issues.some(i => i.code === 'missing_preferred'));
  assert(validateCandidates(brief, {items: [{...preferred, id: 'another-board:new'}], visualReviews: [reviewFor('another-board:new')]}).ok);
  const conflict = compile(snap({picks: [rejected.id]}), catalog);
  assert(validateCandidates(conflict, [rejected]).blocked);
  assert(validateCandidates({...conflict, conflicts: []}, [rejected]).blocked);
});

test('preferred selections retain full URL selection parameters and nonempty variant metadata', () => {
  const favorite = row('favorite', {brand: '', sku: '', variant: 'Grey / King 72 x 78 in',
    url: 'https://shop.example/products/bed?variant=grey-king&view=details#photo'});
  const brief = compile(snap({picks: [favorite.id], exclusions: []}), [favorite]);
  const exact = {...favorite, id: 'new-id', variant: '  grey / king 72 x 78 in  ',
    url: 'https://SHOP.example/products/bed/?view=details&variant=grey-king#another-photo'};
  assert(validateCandidates(brief, [exact]).ok);
  for (const change of [
    {url: 'https://shop.example/products/bed?variant=beige-queen&view=details'},
    {url: 'https://shop.example/products/bed'},
    {variant: 'Beige / Queen 60 x 75 in'},
    {variant: ''},
    {variant: undefined}
  ]) {
    const result = validateCandidates(brief, [{...exact, ...change}]);
    assert(result.blocked);
    assert(result.issues.some(issue => issue.code === 'missing_preferred'));
  }
  const identified = {...favorite, brand: 'Maker', sku: 'grey-king'};
  const identifiedBrief = compile(snap({picks: [identified.id], exclusions: []}), [identified]);
  assert(validateCandidates(identifiedBrief, [{...identified, id: 'new-id', url: 'https://shop.example/new-product-link'}]).ok);
  for (const change of [{variant: 'Beige / Queen'}, {variant: ''}, {sku: 'beige-queen'}]) {
    assert(validateCandidates(identifiedBrief, [{...identified, ...change}]).issues.some(issue => issue.code === 'missing_preferred'));
  }
});

test('all same-category rules require specific, current human attestations', () => {
  for (const exclusion of [{id: rejected.id, traits: [], note: ''}, {id: rejected.id, traits: ['material:rattan'], note: ''}, {id: rejected.id, traits: ['material:rattan'], note: 'Avoid a bulky silhouette'}]) {
    const brief = compile(snap({exclusions: [exclusion]}), catalog);
    assert(validateCandidates(brief, [clearCandidate]).issues.some(i => i.code === 'human_review_required'));
    const manifest = {items: [clearCandidate], preferenceRevision: 7, visualReviews: [reviewFor('C')]};
    assert(validateCandidates(brief, manifest).ok);
    assert(validateCandidates(brief, {...manifest, preferenceRevision: 8}).blocked);
    for (const update of [{acknowledged: false}, {reviewedBy: ''}, {preferenceRevision: 6}, {exclusionIds: []}]) {
      assert(validateCandidates(brief, {...manifest, visualReviews: [reviewFor('C', [rejected.id], update)]}).blocked);
    }
    if (exclusion.note) assert(validateCandidates(brief, {...manifest, visualReviews: [reviewFor('C', [rejected.id], {notesReviewed: false})]}).blocked);
    assert(validateCandidates(brief, [row('mirror', {role: 'mirror'})]).ok);
  }
});

test('thin metadata cannot bypass material or shape exclusions through missing traits', () => {
  const brief = compile(snap(), catalog);
  const thinCandidate = {id: 'new', role: 'chair', name: 'Chair', family: 'Maker Beta', url: 'https://shop.example/new'};
  assert.deepEqual(profile(thinCandidate).traits, []);
  const result = match(thinCandidate, snap().exclusions[0], catalog);
  assert.equal(result.blocked, false);
  assert.equal(result.reviewRequired, true);
  const missing = validateCandidates(brief, [thinCandidate]);
  assert.equal(missing.ok, false);
  assert(missing.issues.some(issue => issue.code === 'human_review_required'));
  for (const extra of [{}, {candidateId: 'different'}, {preferenceRevision: 6}, {acknowledged: false}, {exclusionIds: []}]) {
    const visualReviews = Object.keys(extra).length ? [reviewFor('new', [rejected.id], extra)] : [];
    assert(validateCandidates(brief, {items: [thinCandidate], visualReviews}).blocked);
  }
  const reviewed = validateCandidates(brief, {items: [thinCandidate], visualReviews: [reviewFor('new')]});
  assert(reviewed.ok);
  assert.equal(reviewed.renderedImageVerified, false);
  for (const candidate of [rejected, row('family', {family: 'Maker Alpha'}), row('trait', {materials: 'Rattan'})]) {
    const attested = validateCandidates(brief, {items: [candidate], visualReviews: [reviewFor(candidate.id)]});
    assert(attested.blocked);
    assert(attested.issues.some(issue => issue.code === 'excluded_candidate'));
  }
});

test('catalogue schema compiles actual gallery data without invented metadata traits', async () => {
  const entries = [];
  for (const board of ['def', 'ghi', 'jkl', 'mno']) {
    const directory = board === 'def' ? galleryDirectory : join(galleryDirectory, board);
    const data = JSON.parse(await readFile(join(directory, 'data/designs.json'), 'utf8'));
    entries.push(...data.items.map(product => ({id: board + ':' + product.id, board, product})));
  }
  assert(entries.length > 100);
  assert(entries.every(item => profile(item).category !== 'unknown'));
  const bed = entries.find(item => item.id === 'def:D-BED');
  assert.deepEqual(defaultTraits(bed), []); // Its descriptive styling is in notes only.
  const brief = compile(snap({exclusions: [{id: bed.id, traits: [], note: ''}]}), entries);
  assert.deepEqual(brief.unresolved, []);
  assert.equal(brief.excluded[0].reviewRequired, true);
});

test('CLI saves read-back report, accepts array/object, and exits nonzero on blocked/bad input', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'unit408-pref-'));
  try {
    const briefPath = join(temp, 'brief.json'), candidatePath = join(temp, 'candidates.json'), reportPath = join(temp, 'report.json');
    const brief = compile(snap(), catalog);
    await writeFile(briefPath, JSON.stringify(brief));
    const run = () => spawnSync(process.execPath, [join(scriptDirectory, 'check_design.mjs'), '--brief', briefPath, '--candidates', candidatePath, '--out', reportPath], {encoding: 'utf8'});
    for (const input of [[row('mirror', {role: 'mirror'})], {items: [clearCandidate], visualReviews: [reviewFor(clearCandidate.id)]}]) {
      await writeFile(candidatePath, JSON.stringify(input));
      const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).ok, true);
    }
    await writeFile(candidatePath, JSON.stringify([rejected]));
    assert.equal(run().status, 1);
    assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).blocked, true);
    await writeFile(candidatePath, 'not JSON'); assert.equal(run().status, 2);
  } finally { await rm(temp, {recursive: true, force: true}); }
});
