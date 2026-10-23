import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './usage.js';

const { build, lookup, validSnapshot } = globalThis.Unit408Usage;
const source = (model='chair', variant='red') => `https://shop.test/products/${model}?variant=${variant}`;
const product = (overrides={}) => ({id:'version::chair', originalId:'chair', source:source(), variant:'Red', ...overrides});
const design = (id, products, archival=false) => ({id, letter:'A', name:'Saved room', version:id, archival, products});

test('stable IDs, explicit aliases and source identity find all saved versions with true anchors', () => {
  const index=build([
    design('v1::A',[product({id:'v1::chair', legacyIds:['old-chair']})],true),
    design('v2::C',[product({id:'v2::chair'})]),
    design('v3::B',[product({id:'v3::chair',source:source('chair','blue'),variant:'Blue'})])
  ]);
  const result=index.lookup(product());
  assert.deepEqual(result.productUses.map(u=>u.designId),['v1::A','v2::C','v3::B']);
  assert.deepEqual(result.exactVariantUses.map(u=>u.designId),['v1::A','v2::C']);
  assert.equal(result.eligibleUnused,false);
  assert.equal(result.productUses[0].href,'archive.html#design=v1%3A%3AA');
  assert.equal(result.productUses[1].href,'./#design=v2%3A%3AC');
  assert.equal(index.lookup({id:'old-chair'}).productUses.length,3);
  assert.equal(index.lookup({id:'v1::chair'}).productUses.length,3);
  assert.deepEqual(lookup(JSON.parse(JSON.stringify(index.snapshot)),product()),result);
});

test('variant params are retained for exact matching; tracking alone is ignored', () => {
  const index=build([design('room',[product({source:'https://shop.test/products/chair?variant=red&size=large&utm_source=x',variant:'Default Title'})])]);
  const exact=index.lookup({url:'https://shop.test/products/chair?size=large&variant=red&fbclid=foo'});
  assert.equal(exact.exactVariantUses.length,1);
  const other=index.lookup({source:'https://shop.test/products/chair?size=small&variant=red'});
  assert.equal(other.productUses.length,1);
  assert.equal(other.exactVariantUses.length,0);
  assert.equal(other.eligibleUnused,false);
  for(const query of ['pack=2','campaign=spring','variantId=green','anything=unknown']) {
    const match=index.lookup({id:'new-id',source:`https://shop.test/products/chair?${query}`});
    assert.equal(match.productUses.length,1);
    assert.equal(match.eligibleUnused,false);
    assert.equal(match.exactVariantUses.length,0);
  }
});

test('HTTP and HTTPS share model identity on the same host while exact variant source stays conservative', () => {
  const index=build([design('room',[product()])]);
  const http=index.lookup({id:'new-id',source:'http://shop.test/products/chair?variant=red'});
  assert.equal(http.productUses.length,1);
  assert.equal(http.eligibleUnused,false);
  assert.equal(http.exactVariantUses.length,0);
  const reverse=build([design('room',[product({source:'http://shop.test/products/chair?variant=red'})])]);
  assert.equal(reverse.lookup({source:'https://shop.test/products/chair?variant=blue'}).eligibleUnused,false);
});

test('existing www equivalence blocks reuse and other supplier hosts remain distinct', () => {
  const index=build([design('room',[product()])]);
  assert.equal(index.lookup({source:'https://www.shop.test/products/chair?variant=red'}).eligibleUnused,false);
  for(const hostname of ['other.shop.test','other.test']) {
    const result=index.lookup({source:`https://${hostname}/products/chair?variant=red`});
    assert.equal(result.productUses.length,0);
  }
  assert.equal(index.lookup({source:'https://SHOP.TEST/products/chair?variant=red'}).productUses.length,1);
});

test('explicit product query IDs distinguish models on shared query-only endpoints', () => {
  const index=build([design('room',[product({source:'https://shop.test/item?id=123&campaign=spring'})])]);
  assert.equal(index.lookup({source:'https://shop.test/item?id=123&pack=2'}).eligibleUnused,false);
  assert.equal(index.lookup({source:'https://shop.test/item?id=456&pack=2'}).eligibleUnused,true);
  assert.equal(index.lookup({source:'https://shop.test/item?unknown=456'}).eligibleUnused,false);
  assert.equal(index.lookup({source:'https://shop.test/?product_id=789'}).eligibleUnused,true);
});

test('removed source records count only their actual appearance in another saved version', () => {
  const index=build([
    design('old',[product()],true), design('current',[product({removedFromDesign:true})]),
    design('never',[product({id:'never',originalId:'never',source:source('never'),removedFromDesign:true})])
  ]);
  assert.deepEqual(index.lookup(product()).productUses.map(u=>u.designId),['old']);
  assert.equal(index.lookup({source:source('never')}).eligibleUnused,true);
  assert.equal(index.snapshot.appearances.length,1);
});

test('no fuzzy/name matching and unknown identities fail closed', () => {
  const index=build([design('saved',[product({name:'Chair'})])]);
  assert.equal(index.lookup({name:'Chair'}).identityKnown,false);
  assert.equal(index.lookup({name:'Chair'}).eligibleUnused,false);
  assert.equal(index.lookup({id:'unseen-stable-id'}).eligibleUnused,false);
  assert.equal(index.lookup({source:'https://shop.test/'}).eligibleUnused,false);
  assert.equal(index.lookup({source:'https://shop.test/collections/chairs'}).eligibleUnused,false);
  assert.equal(index.lookup({source:'javascript:alert(1)'}).eligibleUnused,false);
  assert.equal(index.lookup({source:source('new-chair')}).eligibleUnused,true);
  assert.equal(index.lookup({brand:'Shop',sku:'new-sku'}).eligibleUnused,false);
});

test('reused IDs never merge conflicting explicit models or unknown aliases ambiguously', () => {
  const index=build([design('one',[product()]),design('two',[product({source:source('different')})])]);
  const exact=index.lookup(product());
  assert.deepEqual(exact.productUses.map(u=>u.designId),['one']);
  assert.equal(exact.eligibleUnused,false);
  assert.ok(exact.issues.includes('identity-source-conflict'));
  const alias=index.lookup({id:'chair'});
  assert.equal(alias.productUses.length,0);
  assert.ok(alias.issues.includes('ambiguous-product-alias'));
  const conflicting=index.lookup({source:source('chair'),url:source('different')});
  assert.equal(conflicting.eligibleUnused,false);
});

test('brand and SKU provide explicit matching; variant text needs a model match', () => {
  const index=build([design('one',[product({brand:'Maker',sku:'SKU-1',source:null,variant:'Oak'})])]);
  assert.equal(index.lookup({brand:'maker',sku:'SKU-1'}).productUses.length,1);
  assert.equal(index.lookup({brand:'maker',sku:'SKU-1'}).exactVariantUses.length,1);
  assert.equal(index.lookup({brand:'another',sku:'SKU-1'}).productUses.length,0);
  assert.equal(index.lookup({variant:'Oak'}).productUses.length,0);
  const placeholders=build([design('one',[product({source:'https://shop.test/products/chair',variant:'Default Title'})])]);
  assert.equal(placeholders.lookup(product({source:'https://shop.test/products/chair',variant:'Default Title'})).exactVariantUses.length,0);
});

test('malformed snapshots/designs fail closed without throwing; quote lines retain coverage limits', () => {
  for(const malformed of [null,{},[],{schema:'unit408-design-usage/1',complete:true,issues:[],appearances:[{}]}]) {
    assert.equal(validSnapshot(malformed),false);
    assert.equal(lookup(malformed,product()).eligibleUnused,false);
  }
  for(const badDesigns of [null,[null],[{id:'x'}],[design('dup',[]),design('dup',[])],[design('x',[null])]]) {
    const index=build(badDesigns);
    assert.equal(index.snapshot.complete,false);
    assert.equal(index.lookup({source:source('new')}).eligibleUnused,false);
  }
  const index=build([design('one',[{id:'spec',originalId:'allowance',name:'Quote line'}])]);
  assert.equal(index.snapshot.complete,true);
  assert.equal(index.snapshot.coverage.aliasOnlyAppearances,1);
  assert.equal(index.lookup({source:source('new')}).eligibleUnused,true);
  assert.equal(index.lookup({id:'allowance'}).eligibleUnused,false);
});

test('unsafe or conflicting saved sources invalidate usage while informational pages stay alias-only', () => {
  for(const source of ['javascript:invalid','not a url','https://user:secret@shop.test/products/chair',123]) {
    const index=build([design('one',[product({source})])]);
    assert.equal(index.snapshot.complete,false);
    assert.equal(validSnapshot(index.snapshot),false);
    assert.ok(index.snapshot.issues.includes('malformed-saved-product-identity'));
    assert.equal(index.lookup({source:'https://shop.test/products/new'}).eligibleUnused,false);
  }
  const conflict=build([design('one',[product({url:source('different')})])]);
  assert.equal(conflict.snapshot.complete,false);
  assert.equal(validSnapshot(conflict.snapshot),false);
  const info=build([design('one',[product({source:'https://uratex.com.ph/pages/faq'})])]);
  assert.equal(info.snapshot.complete,true);
  assert.equal(validSnapshot(info.snapshot),true);
  assert.equal(info.snapshot.coverage.unresolvedSourceAppearances,1);
  assert.equal(info.lookup({id:'chair'}).eligibleUnused,false);
  assert.equal(info.lookup({source:'https://shop.test/products/new'}).eligibleUnused,true);
});

test('ordering is deterministic and repeated items aggregate per design', () => {
  const a=design('z',[product(),product({id:'duplicate'})]);
  const b=design('a',[product()]);
  assert.deepEqual(build([a,b]).snapshot,build([b,{...a,products:[...a.products].reverse()}]).snapshot);
  assert.equal(build([a]).lookup(product()).productUses.length,1);
  assert.deepEqual(build([a]).lookup(product()).productUses[0].productIds,['duplicate','version::chair']);
});

test('real saved data includes every actual current/history appearance without source mutation', async () => {
  const data=JSON.parse(await readFile(new URL('../../collection-data.json',import.meta.url),'utf8'));
  const before=JSON.stringify(data), index=build(data.designs);
  assert.equal(data.designs.length,45);
  assert.equal(index.snapshot.complete,true);
  assert.equal(validSnapshot(index.snapshot),true);
  assert.equal(index.snapshot.appearances.length,data.designs.flatMap(d=>d.products.filter(p=>!p.removedFromDesign)).length);
  assert.ok(index.snapshot.coverage.aliasOnlyAppearances>0);
  assert.equal(index.snapshot.coverage.unresolvedSourceAppearances,3);
  const ids=new Set(data.designs.map(d=>d.id));
  for(const d of data.designs)for(const p of d.products.filter(p=>!p.removedFromDesign)) {
    const result=index.lookup(p);
    assert.ok(result.productUses.some(u=>u.designId===d.id),p.id);
    assert.equal(result.eligibleUnused,false,p.id);
    for(const use of result.productUses)assert.ok(ids.has(use.designId));
  }
  assert.equal(JSON.stringify(data),before);
});
