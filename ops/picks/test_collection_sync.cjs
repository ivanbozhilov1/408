// Synthetic local tests only: no production network or private access files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const base = require('node:path').resolve(__dirname, '../..') + '/';
const syncSource = fs.readFileSync(base + 'collection-sync.js', 'utf8');
const gallerySource = fs.readFileSync(base + 'collection.js', 'utf8');
const rulesSource = fs.readFileSync(base + 'collection-preferences.js', 'utf8');
const catalog = JSON.parse(fs.readFileSync(base + 'collection-catalog.json')).items;
const token = 'synthetic_access_'.padEnd(43, 'x');
class Store {
  constructor(entries = []) { this.map = new Map(entries); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
function runtime(extra = {}) {
  const context = vm.createContext({console, URL, URLSearchParams, TextEncoder, AbortController, setTimeout, clearTimeout, ...extra});
  vm.runInContext(rulesSource, context); vm.runInContext(syncSource, context);
  return context;
}
const rt = runtime(), rules = rt.Unit408Preferences;
const simple = [
  {id:'def:D-BED',localId:'fable-def-20261021::D-BED',board:'def',label:'Fable D',name:'Oak bed',product:{name:'Oak bed',role:'bed',family:'Oak Bed',url:'https://example.test/oak-bed'}},
  {id:'astra-pqr::P-BED',localId:'astra-pqr::P-BED',board:'astra-pqr',label:'Astra P',name:'Walnut bed',product:{name:'Walnut bed',role:'bed',url:'https://example.test/walnut-bed'}},
  {id:'gpt-abc::A-BED',localId:'gpt-abc::A-BED',board:'gpt-abc',label:'Astra A',name:'Oak family bed',product:{name:'Oak family bed',role:'bed',family:'Oak Bed',url:'https://example.test/oak-bed-2'}},
  {id:'astra-pqr::P-CHAIR',localId:'astra-pqr::P-CHAIR',board:'astra-pqr',label:'Astra P',name:'Rattan chair',product:{name:'Rattan chair',role:'chair',url:'https://example.test/rattan-chair'}}
];
function server(items = simple) {
  const server = {revision:0,picks:new Set(),exclusions:new Map(),role:'editor',offline:false,calls:[],applied:new Map(),loseNextAck:false,conflictNext:false};
  server.snapshot = () => ({revision:server.revision,picks:[...server.picks],exclusions:[...server.exclusions.values()],preferenceSchema:2,role:server.role,updatedAt:'2026-10-21T00:00:00Z'});
  server.fetch = async (url, options) => {
    assert.equal(url, 'https://seo.cebugrandrealty.com:8443/api/picks');
    const body = options.body && JSON.parse(options.body); server.calls.push({method:options.method,body});
    if (server.offline) throw new Error('Synthetic offline');
    let status = 200;
    if (body && !server.applied.has(body.operationId)) {
      if (server.role !== 'editor') status = 403;
      else if (server.conflictNext) { server.conflictNext = false; status = 409; }
      else if (body.restoreRevision !== undefined && body.restoreRevision !== server.revision) status = 409;
      // Match the real backend: family/trait rules belong to the client, while
      // the service rejects a positive only for an exact excluded item ID.
      else if ((body.decision === 'preferred' || body.starred === true) && server.exclusions.has(body.id)) status = 409;
      else {
        if (body.decision === 'excluded') { server.picks.delete(body.id); server.exclusions.set(body.id,{id:body.id,...body.exclusion}); }
        else {
          if (body.restoreRevision !== undefined) server.exclusions.delete(body.id);
          if ((body.decision === 'preferred' || body.starred === true) && !server.exclusions.has(body.id)) server.picks.add(body.id); else server.picks.delete(body.id);
        }
        server.revision++; server.applied.set(body.operationId, body);
        if (server.loseNextAck) { server.loseNextAck = false; throw new Error('Synthetic lost acknowledgement'); }
      }
    }
    return {ok:status===200,status,json:async()=>server.snapshot()};
  };
  return server;
}
function client(server, {storage = new Store(), locals = [], items = simple} = {}) {
  let current;
  const instance = rt.unit408CollectionSync.createClient({catalog:items,rules,storage,crypto:webcrypto,fetch:server.fetch,
    local:{get:()=>[...locals],restore:()=>{}},changed:value=>{current=value}});
  return {instance,storage,get current(){return current}};
}
async function flush(instance) { await instance.refresh(); if(instance.state().pending) await instance.refresh(); }
async function scopeFor(value = token) { return Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).subarray(0,16).toString('hex'); }

test('all 782 catalogue IDs map uniquely; all 398 legacy Fable wire IDs are preserved', () => {
  const data = JSON.parse(fs.readFileSync(base + 'collection-data.json'));
  const local = new Map(data.designs.flatMap(d=>d.products).map(p=>[p.id,p]));
  assert.equal(catalog.length,782); assert.equal(new Set(catalog.map(x=>x.id)).size,782);
  assert.equal(new Set(catalog.map(x=>x.localId)).size,782);
  let legacy = 0;
  for(const item of catalog){
    const product=local.get(item.localId); assert.ok(product);
    const prior=product.legacyIds.find(id=>/^(def|ghi|jkl|mno|stu|hal|hop|dop|lop|liv):/.test(id));
    if(prior){legacy++;assert.equal(item.id,prior)}else assert.equal(item.id,product.id);
  }
  assert.equal(legacy,398);
});

test('preferred → neutral → excluded; plain neutral and preferred cannot clear exclusion; fresh Restore works', async () => {
  const backend=server(),{instance}=client(backend);await instance.connect(token);
  assert.equal(instance.decide(simple[0].localId,'preferred'),true);await flush(instance);assert.equal(backend.picks.has(simple[0].id),true);
  assert.equal(instance.decide(simple[0].localId,'neutral'),true);await flush(instance);assert.equal(backend.picks.size,0);
  assert.equal(instance.decide(simple[0].localId,'excluded',{traits:[],note:'Avoid chunky bed frames.'}),true);await flush(instance);
  assert.equal(instance.decide(simple[0].localId,'neutral'),false);assert.equal(instance.decide(simple[0].localId,'preferred'),false);
  assert.equal(instance.decide(simple[2].localId,'preferred'),false,'recorded family is blocked across namespaces');
  backend.revision+=3;const expected=backend.revision;assert.equal(await instance.restore(simple[0].localId),true);
  const restore=backend.calls.find(call=>call.body?.restoreRevision!==undefined).body;
  assert.equal(restore.restoreRevision,expected);assert.equal(restore.decision,'neutral');assert.equal(backend.exclusions.size,0);
  assert.equal(instance.state().items[0].decision,'neutral');
});

test('viewer cannot edit, exclude, restore, or migrate local stars', async () => {
  const backend=server();backend.role='viewer';const {instance}=client(backend,{locals:[simple[0].localId]});await instance.connect(token);
  assert.equal(instance.state().readonly,true);assert.equal(instance.decide(simple[0].localId,'preferred'),false);
  assert.equal(instance.decide(simple[0].localId,'excluded',{traits:[],note:''}),false);assert.equal(await instance.restore(simple[0].localId),false);
  assert.equal(backend.calls.filter(x=>x.method==='PUT').length,0);
});

test('migration is additive once, skips existing Fable markers and exclusions, and never revives cleared choices', async () => {
  const backend=server(),storage=new Store(),scope=await scopeFor();
  storage.setItem('unit408-shared-migrated-v1:'+scope,JSON.stringify({def:true}));
  backend.exclusions.set(simple[3].id,{id:simple[3].id,traits:[],note:'No rattan'});
  const locals=[simple[0].localId,simple[1].localId,simple[3].localId];
  const first=client(backend,{storage,locals});await first.instance.connect(token);
  assert.deepEqual([...backend.picks],[simple[1].id]);
  first.instance.decide(simple[1].localId,'neutral');await flush(first.instance);
  const reloaded=client(backend,{storage,locals});await reloaded.instance.connect(token);
  assert.equal(backend.picks.size,0);assert.equal(reloaded.instance.state().pending,0);
});

test('all 243 existing Fable IDs migrate without renaming or merging products', async () => {
  const items=catalog.filter(x=>/^(def|ghi|jkl|mno):/.test(x.id)),backend=server(items);
  const {instance}=client(backend,{items,locals:items.map(x=>x.localId)});await instance.connect(token);
  assert.equal(backend.picks.size,243);assert.equal(instance.state().pending,0);
  assert.deepEqual([...backend.picks].sort(),items.map(x=>x.id).sort());
});

test('offline queue survives reload; lost acknowledgement retries same operationId without duplication', async () => {
  const backend=server(),storage=new Store(),first=client(backend,{storage});await first.instance.connect(token);
  backend.offline=true;first.instance.decide(simple[1].localId,'preferred');await flush(first.instance);
  assert.equal(first.instance.state().phase,'offline');assert.equal(first.instance.state().synced,false);assert.equal(first.instance.state().pending,1);
  const queued=[...storage.map].find(([key])=>key.startsWith('unit408-shared-op-v1:'));
  const operationId=JSON.parse(queued[1]).operationId;
  const reload=client(backend,{storage});await reload.instance.connect(token);assert.equal(reload.instance.state().pending,1);
  backend.offline=false;backend.loseNextAck=true;await reload.instance.refresh();assert.equal(reload.instance.state().pending,1);
  await reload.instance.refresh();assert.equal(reload.instance.state().pending,0);assert.equal(backend.picks.size,1);
  assert.equal(backend.applied.size,1);assert.equal(backend.calls.filter(x=>x.body).every(x=>x.body.operationId===operationId),true);
});

test('queued legacy positive cannot resurrect an excluded product and is discarded before PUT', async () => {
  const backend=server(),storage=new Store(),scope=await scopeFor();
  backend.exclusions.set(simple[0].id,{id:simple[0].id,traits:[],note:'Keep excluded'});
  storage.setItem('unit408-shared-op-v1:old',JSON.stringify({scope,id:simple[0].id,starred:true,operationId:'old',queuedAt:1}));
  const {instance}=client(backend,{storage});await instance.connect(token);
  assert.equal(backend.picks.size,0);assert.equal(backend.exclusions.size,1);assert.equal(instance.state().pending,0);
  assert.match(instance.state().notice,/exclusion/);assert.equal(backend.calls.filter(x=>x.method==='PUT').length,0);
});

// Privacy-review hypothesis: decide() checks the last known exclusions, but an
// offline queue is replayed after a fresh GET without running that check again.
// The old fake server's family matcher hid the missing client replay guard.
test('offline preferred retry is dropped against a newly downloaded family exclusion', async () => {
  const backend=server(),{instance,storage}=client(backend);await instance.connect(token);
  backend.offline=true;assert.equal(instance.decide(simple[2].localId,'preferred'),true);await flush(instance);
  backend.exclusions.set(simple[0].id,{id:simple[0].id,traits:[],note:'Avoid this family'});backend.revision++;
  backend.offline=false;await flush(instance);
  assert.equal(backend.picks.has(simple[2].id),false);
  assert.equal(backend.calls.filter(x=>x.method==='PUT').length,0,'Client must not send a known conflicting positive');
  assert.equal(instance.state().pending,0);assert.match(instance.state().notice,/exclusion/);
  assert.equal([...storage.map.keys()].some(key=>key.startsWith('unit408-shared-op-v1:')),false);
});

test('offline imported preferred item is rechecked against new selected-category traits', async () => {
  const secondChair={id:'astra-other::S-CHAIR',localId:'astra-other::S-CHAIR',board:'astra-other',label:'Astra S',name:'Rattan armchair',product:{name:'Rattan armchair',role:'chair',url:'https://example.test/second-rattan-chair'}};
  const items=[...simple,secondChair],backend=server(items),{instance}=client(backend,{items});await instance.connect(token);
  const gallery=galleryHarness();gallery.context.controller=instance;gallery.context.extraItem=secondChair;
  vm.runInContext("products.set(extraItem.localId,{id:extraItem.localId,name:extraItem.name,legacyIds:[],namespace:extraItem.board});sharedController=controller;sharedState={managed:true,readonly:false,items:[],pending:0};",gallery.context);
  backend.offline=true;
  const result=vm.runInContext("importPicks(JSON.stringify({picks:[extraItem.localId]}))",gallery.context);assert.equal(result.added,1);await flush(instance);
  backend.exclusions.set(simple[3].id,{id:simple[3].id,traits:['material:rattan'],note:'Avoid rattan seating'});backend.revision++;
  backend.offline=false;await flush(instance);
  assert.equal(backend.picks.has(secondChair.id),false);assert.equal(instance.state().pending,0);
  assert.equal(backend.calls.filter(x=>x.method==='PUT').length,0);assert.match(instance.state().notice,/exclusion/);
});

test('a backend revision conflict still discards only the conflicting operation', async () => {
  const backend=server(),{instance}=client(backend);await instance.connect(token);backend.conflictNext=true;
  instance.decide(simple[1].localId,'preferred');await flush(instance);
  assert.equal(instance.state().pending,0);assert.equal(backend.picks.size,0);assert.match(instance.state().notice,/older change/);
});

test('newer cached exclusion wins over stale GET and blocks a stale-tab preference', async () => {
  const backend=server(),storage=new Store(),{instance}=client(backend,{storage});await instance.connect(token);
  const scope=await scopeFor();storage.setItem('unit408-shared-cache-v1:'+scope,JSON.stringify({revision:50,preferenceSchema:2,picks:[],exclusions:[{id:simple[1].id,traits:[],note:'Fresh exclusion'}]}));
  await instance.refresh();assert.equal(instance.state().revision,50);assert.equal(instance.decide(simple[1].localId,'preferred'),false);
  assert.equal(backend.calls.filter(x=>x.method==='PUT').length,0);
});

test('same-millisecond preference changes preserve their enqueue order', async () => {
  const backend=server(),{instance}=client(backend);await instance.connect(token);backend.offline=true;
  instance.decide(simple[1].localId,'preferred');instance.decide(simple[1].localId,'neutral');await flush(instance);
  backend.offline=false;await flush(instance);assert.equal(backend.picks.size,0);
});

test('confirmed shared export contains no access credential; pending/offline export is guarded', async () => {
  const backend=server(),{instance}=client(backend);await instance.connect(token);
  instance.decide(simple[1].localId,'preferred');await flush(instance);
  instance.decide(simple[3].localId,'excluded',{traits:['material:rattan'],note:'Slim seating only'});await flush(instance);
  const brief=await instance.exportBrief(),text=JSON.stringify(brief);
  assert.equal(brief.preferred.length,1);assert.equal(brief.excluded.length,1);assert.equal(text.includes(token),false);
  assert.equal(JSON.stringify(instance.state()).includes(token),false);
  backend.offline=true;instance.decide(simple[1].localId,'neutral');await flush(instance);await assert.rejects(instance.exportBrief(),/sync/);
});

test('private fragment is consumed before data loading and does not route to the legacy page', () => {
  const location={hash:'#sync='+token,pathname:'/408/',search:'?shared-picks=1'};let replaced;
  runtime({location,history:{replaceState:(_a,_b,path)=>{replaced=path;location.hash='#picks'}}});
  assert.equal(replaced,'/408/?shared-picks=1#picks');assert.equal(replaced.includes(token),false);
  assert.doesNotMatch(gallerySource,/const legacyRedirect[^\n]*sync=|const legacyRedirect[^\n]*shared-picks/);
});

function galleryHarness() {
  const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{value:'',innerHTML:'',textContent:'',style:{}});return nodes.get(key)};
  const writes=[],calls=[];
  const context=vm.createContext({console,URL,URLSearchParams,Intl,Date,setTimeout,clearTimeout,document:{body:{dataset:{}},querySelector:node,querySelectorAll:()=>[]},window:{addEventListener:()=>{}},location:{hash:'',search:'',href:'https://example.test/408/'},localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},fixture:simple,calls});
  const start=gallerySource.indexOf("const $=s=>");
  const end=gallerySource.indexOf("document.addEventListener('click'");
  vm.runInContext(gallerySource.slice(start,end),context);
  vm.runInContext("data={build:'synthetic'};for(const item of fixture)products.set(item.localId,{id:item.localId,name:item.name,legacyIds:[item.id],namespace:item.board,designLabel:item.label});sharedController={decide:(...args)=>{calls.push(args);return true}};",context);
  return {context,writes,calls,node};
}
test('combined imports use managed decisions, skip excluded items, and are blocked for viewers; exports omit credentials', () => {
  const h=galleryHarness();
  vm.runInContext("sharedState={managed:true,readonly:false,synced:true,items:[],pending:0};",h.context);
  let result=vm.runInContext("importPicks('{\"picks\":[\"def:D-BED\"]}')",h.context);
  assert.equal(result.added,1);assert.deepEqual(Array.from(h.calls[0]), [simple[0].localId,'preferred']);assert.equal(h.writes.length,0);
  vm.runInContext('sharedState.readonly=true',h.context);result=vm.runInContext("importPicks('{\"picks\":[\"astra-pqr::P-BED\"]}')",h.context);
  assert.match(result.error,/read-only/);assert.equal(h.calls.length,1);
  vm.runInContext('sharedState.readonly=false;sharedController.decide=()=>false',h.context);result=vm.runInContext("importPicks('{\"picks\":[\"astra-pqr::P-BED\"]}')",h.context);assert.equal(result.added,0);assert.equal(result.missing.length,1);
  const exported=vm.runInContext('JSON.stringify(exportObject())',h.context);assert.equal(exported.includes(token),false);assert.doesNotMatch(exported,/Authorization|shared-access|sync=/);
  vm.runInContext('sharedState.synced=false',h.context);assert.throws(()=>vm.runInContext('exportObject()',h.context),/sync/);
  result=vm.runInContext("importPicks('https://example.test/#sync=secret')",h.context);assert.match(result.error,/shared-access/);
});

test('gallery static integration preserves grouping, comparison, paths and isolated QA storage', () => {
  const index=fs.readFileSync(base+'index.html','utf8');
  assert.match(index,/collection-preferences\.js.*collection-sync\.js.*collection\.js/);
  assert.match(index,/connect-src 'self' https:\/\/seo\.cebugrandrealty\.com:8443/);
  assert.match(index,/<select\b[^>]*\bid="compare-view"/);assert.match(gallerySource,/unit408-combined-qa-v1/);
  assert.match(gallerySource,/location\.origin\+location\.pathname\+'#picks='/);
  assert.match(gallerySource,/function renderGrid/);assert.match(gallerySource,/compared\.length<3/);
  assert.match(syncSource,/setInterval\(.*5000\)/);assert.match(syncSource,/if \(!document.hidden\)/);
});

test('comparison offers delivered human and legacy views, preserves valid selections, and reports missing views', () => {
  const h=galleryHarness(),select=h.node('#compare-view');
  h.context.comparisonFixture=[
    {id:'human',name:'Human views',letter:'P',author:'Astra',version:'current',views:[
      {kind:'entrance-day',image:'entrance.png',label:'Entrance'},
      {kind:'window-ac-golden',image:'window-golden.png',label:'Window golden',cameraPlan:'camera-plans/window.svg'}
    ]},
    {id:'legacy',name:'Legacy views',letter:'D',author:'Fable',version:'current',views:[
      {kind:'main-day',image:'main.png',label:'Main'},
      {kind:'opposite-golden',image:'opposite-golden.png',label:'Opposite golden'}
    ]}
  ];
  const options=()=>Array.from(select.innerHTML.matchAll(/<option value="([^"]+)"/g),match=>match[1]);
  vm.runInContext('designs=comparisonFixture;pageDesigns=designs;compared=[];',h.context);
  assert.equal(vm.runInContext('syncCompareView()',h.context),'entrance-day');
  assert.deepEqual(options(),['entrance-day','window-ac-golden','main-day','opposite-golden']);
  assert.equal(select.disabled,false);

  select.value='window-ac-golden';
  vm.runInContext("compared=['human'];syncCompareView()",h.context);
  assert.deepEqual(options(),['entrance-day','window-ac-golden']);
  assert.equal(select.value,'window-ac-golden','A still-available selection must survive rebuilding options');

  vm.runInContext("compared=['legacy'];syncCompareView()",h.context);
  assert.deepEqual(options(),['main-day','opposite-golden']);
  assert.equal(select.value,'main-day','An unavailable selection must fall back to a delivered view');

  select.value='window-ac-golden';
  vm.runInContext("compared=['human','legacy'];renderCompare()",h.context);
  assert.equal(select.value,'window-ac-golden');
  assert.match(h.node('#compare-grid').innerHTML,/src="window-golden\.png"/);
  assert.match(h.node('#compare-grid').innerHTML,/href="camera-plans\/window\.svg"/);
  assert.equal((h.node('#compare-grid').innerHTML.match(/No delivered view in this version\./g)||[]).length,1);
  assert.doesNotMatch(h.node('#compare-grid').innerHTML,/src="(?:main|opposite-golden)\.png"/,'A missing angle must not silently substitute another image');

  vm.runInContext('designs=[];pageDesigns=[];compared=[];',h.context);
  assert.equal(vm.runInContext('syncCompareView()',h.context),'');
  assert.equal(select.disabled,true);
  assert.deepEqual(options(),[]);
});
