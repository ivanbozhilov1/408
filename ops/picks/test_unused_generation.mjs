import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import './usage.js';
import './preferences.js';

const product = (id, changes = {}) => ({id, name: 'Plain chair', role: 'chair', category: 'chair',
  url: 'https://store.example/products/' + id, family: id, variant: 'Oak', ...changes});
const used = product('used-chair');
const designs = [{id: 'saved-v1::A', name: 'Saved room', letter: 'A', author: 'Astra',
  products: [{...used, source: used.url}]}];
const usage = globalThis.Unit408Usage.build(designs).snapshot;
const snapshot = {preferenceSchema: 2, revision: 7, picks: [], exclusions: []};
const rules = globalThis.Unit408Preferences;
const brief = (state = snapshot, catalog = [], options = {}) => rules.compile(state, catalog,
  {unusedItemsOnly: true, usage, ...options});

test('unused option blocks reused products and different variants with new IDs', () => {
  for (const candidate of [used, product('renamed', {url: used.url}), product('new-variant', {url: used.url + '?variant=walnut', variant: 'Walnut'})]) {
    const result = rules.validateCandidates(brief(), [candidate]);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(x => x.code === 'used_candidate'));
  }
  assert.equal(rules.validateCandidates(brief(), [product('fresh-chair')]).ok, true);
});

test('unused option preserves exclusions and human review requirements', () => {
  const excluded = product('rejected', {name: 'Rattan chair', materials: 'Rattan'});
  const state = {...snapshot, exclusions: [{id: excluded.id, traits: ['material:rattan'], note: 'Avoid woven chairs'}]};
  const current = brief(state, [excluded]);
  const blocked = rules.validateCandidates(current, [product('fresh-rattan', {materials: 'Rattan'})]);
  assert.ok(blocked.issues.some(x => x.code === 'excluded_candidate'));
  const clear = product('fresh-chair');
  assert.ok(rules.validateCandidates(current, [clear]).issues.some(x => x.code === 'human_review_required'));
  assert.equal(rules.validateCandidates(current, {items: [clear], preferenceRevision: 7,
    visualReviews: [{candidateId: clear.id, preferenceRevision: 7, reviewedBy: 'Synthetic human fixture',
      acknowledged: true, exclusionIds: [excluded.id], notesReviewed: true}]}).ok, true);
});

test('preferred used products produce an explicit conflict instead of dropping the preference', () => {
  const current = brief({...snapshot, picks: [used.id]}, [used]);
  assert.equal(current.preferred[0].id, used.id);
  assert.equal(current.conflicts.length, 1);
  assert.equal(rules.validateCandidates(current, [used]).ok, false);
  assert.equal(rules.compile({...snapshot, picks: [used.id]}, [used]).conflicts.length, 0);
});

test('missing usage, unknown identity and malformed policy fail closed', () => {
  assert.ok(brief(snapshot, [], {usage: undefined}).unresolved.length);
  assert.ok(brief(snapshot, [], {usage: globalThis.Unit408Usage.build([null]).snapshot}).unresolved.length);
  assert.equal(rules.validateCandidates({...brief(), generation: {unusedItemsOnly: 'yes'}}, [product('fresh')]).ok, false);
  assert.equal(rules.validateCandidates(brief(), [product('fresh', {url: ''})]).ok, false);
});

test('CLI requires current collection and blocks stale usage even when a brief says unused', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'unit408-unused-'));
  try {
    const paths = Object.fromEntries(['brief', 'candidates', 'collection'].map(name => [name, join(folder, name + '.json')]));
    await Promise.all([
      writeFile(paths.brief, JSON.stringify(brief())),
      writeFile(paths.candidates, JSON.stringify([product('fresh-chair')])),
      writeFile(paths.collection, JSON.stringify({designs}))
    ]);
    const run = extra => spawnSync(process.execPath, [new URL('./check_design.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
      '--brief', paths.brief, '--candidates', paths.candidates, ...extra], {encoding: 'utf8'});
    assert.equal(run([]).status, 1);
    let result = run(['--collection', paths.collection]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await writeFile(paths.collection, JSON.stringify({designs: [...designs,
      {id: 'saved-v2::B', name: 'New room', products: [product('fresh-chair')]}]}));
    result = run(['--collection', paths.collection]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(JSON.parse(result.stdout).issues.some(x => x.code === 'stale_usage'));
  } finally {
    await rm(folder, {recursive: true, force: true});
  }
});
