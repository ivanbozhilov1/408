// Known failure hypotheses before repair: the legacy queue does not revalidate
// positives after GET; using effective() would incorrectly honor a later queued
// restore. Its embedded catalogue must also know Astra exclusion identities.
// All requests and credentials below are synthetic; no production network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = require('node:path').resolve(__dirname, '../..') + '/';
const token = 'synthetic_legacy_'.padEnd(43,'x');
const catalog = [
  {id:'def:D-BED',board:'def',label:'D',name:'Oak bed',url:'#D',product:{name:'Oak bed',role:'bed',family:'Oak family',url:'https://example.test/oak'}},
  {id:'astra-pqr::P-BED',board:'astra-pqr',label:'P',name:'Oak bed variant',url:'#P',product:{name:'Oak bed variant',role:'bed',family:'Oak family',url:'https://example.test/oak-variant'}},
  {id:'astra-pqr::P-CHAIR',board:'astra-pqr',label:'P',name:'Steel chair',url:'#P',product:{name:'Steel chair',role:'chair',url:'https://example.test/chair'}}
];
class Store {
  constructor(){this.map=new Map()}
  get length(){return this.map.size}
  key(n){return [...this.map.keys()][n]??null}
  getItem(key){return this.map.get(key)??null}
  setItem(key,value){this.map.set(key,String(value))}
  removeItem(key){this.map.delete(key)}
}
class Element {
  constructor(){this.nodes=new Map();this.dataset={};this.classList={add(){},remove(){},toggle(){}};this.textContent='';this.innerHTML='';this.value='';this.children=[];this.listeners={}}
  querySelector(key){if(!this.nodes.has(key))this.nodes.set(key,new Element());return this.nodes.get(key)}
  querySelectorAll(){return []}
  append(...items){this.children.push(...items)}
  replaceChildren(...items){this.children=items}
  after(){}
  addEventListener(event,handler){this.listeners[event]=handler}
  setAttribute(){}
  close(){}
  showModal(){}
}
async function harness({positive='preferred',futureRestore=false,astraExclusion=false}={}) {
  const storage=new Store(),scope=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).subarray(0,16).toString('hex');
  const positiveId=astraExclusion?'def:D-BED':'astra-pqr::P-BED';
  const exclusion={id:astraExclusion?'astra-pqr::P-CHAIR':'def:D-BED',traits:[],note:''};
  storage.setItem('unit408-shared-op-v1:preferred',JSON.stringify({id:positiveId,...(positive==='legacy'?{starred:true}:{decision:'preferred'}),scope,operationId:'preferred',queuedAt:1}));
  if(futureRestore)storage.setItem('unit408-shared-op-v1:restore',JSON.stringify({id:exclusion.id,decision:'neutral',restoreRevision:3,scope,operationId:'restore',queuedAt:2}));
  const server={revision:3,picks:new Set(),exclusions:new Map([[exclusion.id,exclusion]]),puts:[]};
  const snapshot=()=>({revision:server.revision,picks:[...server.picks],exclusions:[...server.exclusions.values()],preferenceSchema:2,role:'editor'});
  const document=new Element();document.body=new Element();document.createElement=()=>new Element();document.createTextNode=text=>text;document.hidden=false;
  const context=vm.createContext({console,document,URL,URLSearchParams,TextEncoder,Uint8Array,crypto:webcrypto,AbortController,localStorage:storage,
    location:{hash:'',pathname:'/bedroom-design-options/fable-def.html',search:''},history:{replaceState(){}},setTimeout,clearTimeout,setInterval(){},addEventListener(){},
    unit408Picks:{get:()=>[],set(){},readonly(){},managed(){},restore(){}},
    fetch:async(_url,options)=>{
      let status=200;
      if(options.method==='PUT'){
        const op=JSON.parse(options.body);server.puts.push(op);
        if((op.decision==='preferred'||op.starred===true)&&server.exclusions.has(op.id))status=409;
        else if(op.restoreRevision!==undefined&&op.restoreRevision!==server.revision)status=409;
        else{if(op.restoreRevision!==undefined)server.exclusions.delete(op.id);if(op.decision==='preferred'||op.starred===true)server.picks.add(op.id);else server.picks.delete(op.id);server.revision++}
      }
      return{ok:status===200,status,json:async()=>snapshot()};
    }});
  context.window=context;
  vm.runInContext(fs.readFileSync(root+'ops/picks/preferences.js','utf8'),context);
  let source=fs.readFileSync(root+'ops/picks/client.js','utf8')
    .replace('__PICKS_API__',JSON.stringify('https://example.test/api/picks')).replace('__PICKS_CATALOG__',JSON.stringify(catalog)).replace('__PICKS_BOARD__','"def"');
  source=source.replace('  if (!importAccess()) {','  window.testClient={connect,refresh,pending,status:()=>status.textContent};\n  if (!importAccess()) {');
  vm.runInContext(source,context);await context.testClient.connect(token);
  return{server,storage,client:context.testClient};
}
for(const positive of ['preferred','legacy'])test(`legacy sender drops ${positive} family conflict before PUT`,async()=>{
  const {server,storage,client}=await harness({positive});assert.equal(server.picks.size,0);assert.equal(server.puts.length,0);
  assert.equal(client.pending().length,0);assert.equal(storage.getItem('unit408-shared-op-v1:preferred'),null);assert.match(client.status(),/exclusion/);
});
test('a future queued restore does not authorize a preceding positive',async()=>{
  const {server,client}=await harness({futureRestore:true});assert.equal(server.picks.size,0);assert.equal(server.puts.length,1);
  assert.equal(server.puts[0].decision,'neutral');assert.equal(server.exclusions.size,0);assert.match(client.status(),/exclusion/);
});
test('known unrelated Astra exclusion does not overblock legacy furniture',async()=>{
  const {server}=await harness({astraExclusion:true});assert.equal(server.picks.has('def:D-BED'),true);assert.equal(server.puts.length,1);
});
