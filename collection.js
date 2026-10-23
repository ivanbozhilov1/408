'use strict';
const legacyDefIds = new Set(["D-BED", "D-NIGHTSTAND", "D-LAMP", "D-CHAIR", "D-CONSOLE", "D-MIRROR", "D-RUG", "D-CEILING", "D-BEDSPREAD", "D-PILLOWCASES", "D-CUSHION", "D-ART", "D-PLANT", "D-STEMS", "D-DECOR", "D-TRAY", "E-BED", "E-NIGHTSTAND", "E-LAMP", "E-CHAIR", "E-CONSOLE", "E-MIRROR", "E-RUG", "E-CEILING", "E-BEDSPREAD", "E-PILLOWCASES", "E-CUSHION", "E-ART", "E-PLANT", "E-PLANTER", "E-DECOR", "E-TRAY", "F-BED", "F-NIGHTSTAND", "F-LAMP", "F-CHAIR", "F-CONSOLE", "F-MIRROR", "F-RUG", "F-CEILING", "F-BEDSPREAD", "F-PILLOWCASES", "F-CUSHION", "F-ART", "F-PLANT", "F-DECOR", "F-CANDLE", "DUVET-INSERT", "SYS-TV75", "SYS-AC", "SYS-MOUNT", "CUR-BASE", "CUR-BOARD", "CUR-STICKS", "SHARED-FLAT-SHEET", "SHARED-SLEEPING-PILLOWS", "SHARED-RUG-UNDERLAY", "SHARED-CUSHION-INSERT", "LAMP-BULBS-E27", "CEIL-BULBS-E14", "REQUIRED-MATTRESS50", "REQUIRED-FLAT-DECK", "D-CEIL-CORD"]);
const legacyDefAnchors = new Set(["CEIL-BULBS-E14", "CUR-BASE", "CUR-BOARD", "CUR-STICKS", "D-ART", "D-BED", "D-BEDSPREAD", "D-CEIL-CORD", "D-CEILING", "D-CHAIR", "D-CONSOLE", "D-CUSHION", "D-DECOR", "D-LAMP", "D-MIRROR", "D-NIGHTSTAND", "D-PILLOWCASES", "D-PLANT", "D-RUG", "D-STEMS", "D-TRAY", "DUVET-INSERT", "E-ART", "E-BED", "E-BEDSPREAD", "E-CEILING", "E-CHAIR", "E-CONSOLE", "E-CUSHION", "E-DECOR", "E-LAMP", "E-MIRROR", "E-NIGHTSTAND", "E-PILLOWCASES", "E-PLANT", "E-PLANTER", "E-RUG", "E-TRAY", "F-ART", "F-BED", "F-BEDSPREAD", "F-CANDLE", "F-CEILING", "F-CHAIR", "F-CONSOLE", "F-CUSHION", "F-DECOR", "F-LAMP", "F-MIRROR", "F-NIGHTSTAND", "F-PILLOWCASES", "F-PLANT", "F-RUG", "LAMP-BULBS-E27", "REQUIRED-FLAT-DECK", "REQUIRED-MATTRESS50", "SHARED-CUSHION-INSERT", "SHARED-FLAT-SHEET", "SHARED-RUG-UNDERLAY", "SHARED-SLEEPING-PILLOWS", "SYS-AC", "SYS-MOUNT", "SYS-TV75", "brief", "brief-title", "budget", "budget-title", "common-title", "heading-D", "heading-E", "heading-F", "image-caption", "image-close", "image-dialog", "image-full", "image-next", "image-original", "image-position", "image-prev", "main", "picks-title", "procurement-title", "row-CEIL-BULBS-E14", "row-CUR-BASE", "row-CUR-BOARD", "row-CUR-STICKS", "row-D-ART", "row-D-BED", "row-D-BEDSPREAD", "row-D-CEIL-CORD", "row-D-CEILING", "row-D-CHAIR", "row-D-CONSOLE", "row-D-CUSHION", "row-D-DECOR", "row-D-LAMP", "row-D-MIRROR", "row-D-NIGHTSTAND", "row-D-PILLOWCASES", "row-D-PLANT", "row-D-RUG", "row-D-STEMS", "row-D-TRAY", "row-DUVET-INSERT", "row-E-ART", "row-E-BED", "row-E-BEDSPREAD", "row-E-CEILING", "row-E-CHAIR", "row-E-CONSOLE", "row-E-CUSHION", "row-E-DECOR", "row-E-LAMP", "row-E-MIRROR", "row-E-NIGHTSTAND", "row-E-PILLOWCASES", "row-E-PLANT", "row-E-PLANTER", "row-E-RUG", "row-E-TRAY", "row-F-ART", "row-F-BED", "row-F-BEDSPREAD", "row-F-CANDLE", "row-F-CEILING", "row-F-CHAIR", "row-F-CONSOLE", "row-F-CUSHION", "row-F-DECOR", "row-F-LAMP", "row-F-MIRROR", "row-F-NIGHTSTAND", "row-F-PILLOWCASES", "row-F-PLANT", "row-F-RUG", "row-LAMP-BULBS-E27", "row-REQUIRED-FLAT-DECK", "row-REQUIRED-MATTRESS50", "row-SHARED-CUSHION-INSERT", "row-SHARED-FLAT-SHEET", "row-SHARED-RUG-UNDERLAY", "row-SHARED-SLEEPING-PILLOWS", "row-SYS-AC", "row-SYS-MOUNT", "row-SYS-TV75", "schedule-D", "schedule-E", "schedule-F", "schedule-common", "scheme-d", "scheme-e", "scheme-f", "source-title", "top"]);
function routeLegacyGallery() {
const rawHash = location.hash;
let legacyPicks = false;
if (rawHash.startsWith('#picks=')) {
  try { const ids = rawHash.slice(7).split(',').map(decodeURIComponent); legacyPicks = ids.length > 0 && ids.every(id => legacyDefIds.has(id)); } catch { /* Ignore malformed links. */ }
}
const legacyRedirect = legacyDefAnchors.has(rawHash.slice(1)) || legacyPicks;
if (legacyRedirect) location.replace('fable-def.html' + location.search + location.hash);
return legacyRedirect;
}
window.addEventListener('hashchange', routeLegacyGallery);
if (!routeLegacyGallery()) {
'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>Number.isSafeInteger(c)?new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:c%100?2:0}).format(c/100):'Quote required';
const testMode=new URLSearchParams(location.search).has('test'), storageKey=testMode?'unit408-combined-qa-v1':'unit408-combined-picks-v1';
const compareKey=storageKey+'-compare';
if(testMode)document.querySelectorAll('a[href="archive.html"],a[href="./"]').forEach(a=>a.setAttribute('href',a.getAttribute('href')+'?test=1'));
const archivePage=document.body.dataset.collection==='archive';
let data, designs=[], pageDesigns=[], products=new Map(), picks=new Set(), compared=[], activeDesign=null, toastTimer, usageIndex=null;
let rooms=[], activeRoom='';
let sharedController=null, sharedState={managed:false,readonly:false,items:[],pending:0,phase:'local'}, choiceStates=new Map(), localAtConnect=null;
function routeCollectionHash(){
  let id;try{id=decodeURIComponent(location.hash.slice(1))}catch{return false}
  if(id.startsWith('room=')){if(!rooms.some(r=>r.id===id.slice(5)))return false;setRoom(id.slice(5));document.getElementById('collection')?.scrollIntoView({block:'start'});return false}
  const target=id.startsWith('set-')?designs.find(d=>d.namespace===id.slice(4)):id.startsWith('design=')?designs.find(d=>d.id===id.slice(7)):null;
  if(!target)return false;
  if(Boolean(target.archival)!==archivePage){location.replace((target.archival?'archive.html':'./')+location.search+location.hash);return true}
  if(id.startsWith('design=')){openDesign(target.id);return false}
  if(activeRoom&&target.room!==activeRoom)setRoom(target.room);
  $('#author-filter').value='';$('#status-filter').value='';$('#search').value='';renderGrid();
  document.getElementById(id)?.scrollIntoView({block:'start'});
  return false;
}
window.addEventListener('hashchange',()=>{if(data)routeCollectionHash()});
function toast(s){$('#toast').textContent=s;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',4500)}
function save(){if(sharedState.managed)return;try{localStorage.setItem(storageKey,JSON.stringify({schema:'unit408-combined-picks/1',picks:[...picks],updatedAt:new Date().toISOString()}))}catch{toast('Browser storage is unavailable. Export your picks to keep them.')}}
function load(){
  try{const p=JSON.parse(localStorage.getItem(storageKey)||'{}');picks=new Set((Array.isArray(p.picks)?p.picks:[]).filter(x=>typeof x==='string'))}catch{picks=new Set()}
  try{const ids=JSON.parse(sessionStorage.getItem(compareKey)||'[]');compared=Array.isArray(ids)?[...new Set(ids)].filter(id=>designs.some(d=>d.id===id&&(archivePage||!d.archival))).slice(0,3):[]}catch{compared=[]}}
function preferenceMarkup(p){
  const state=choiceStates.get(p.id),decision=sharedState.managed?(state?.decision||'neutral'):(picks.has(p.id)?'preferred':'neutral');
  const readonly=sharedState.managed&&sharedState.readonly,blocked=!!state?.reasons.length,excluded=decision==='excluded';
  const noExclude=!sharedState.managed||readonly||sharedState.preferenceSchema!==2;
  const label=decision.charAt(0).toUpperCase()+decision.slice(1);
  return `<div class="choice-buttons" role="group" aria-label="Choice for ${esc(p.name)}"><button type="button" data-pick="${esc(p.id)}" data-choice="preferred" aria-pressed="${decision==='preferred'}" ${readonly||blocked?'disabled':''}>${decision==='preferred'?'★ Preferred':'☆ Prefer'}</button><button type="button" data-choice-id="${esc(p.id)}" data-choice="neutral" aria-pressed="${decision==='neutral'}" ${readonly||excluded?'disabled':''}>Neutral</button><button type="button" data-choice-id="${esc(p.id)}" data-choice="excluded" aria-pressed="${excluded}" ${noExclude?'disabled':''}>${excluded?'Edit exclusion':'Exclude'}</button>${excluded?`<button type="button" data-choice-id="${esc(p.id)}" data-choice="restore" ${readonly||sharedState.pending||sharedState.busy?'disabled':''}>Restore</button>`:''}</div><p class="choice-status">${label} · ${sharedState.managed?(state?.pending?'waiting for confirmation':sharedState.phase==='offline'?'last loaded shared choice':'shared choice'):'this browser'}</p>${blocked?`<p class="choice-reasons">${esc(state.reasons.join(' '))}</p>`:''}${!sharedState.managed?'<p class="choice-hint">Connect shared choices to save exclusions across devices.</p>':''}`;
}
function updateShared(state){
  if(state.managed&&!sharedState.managed)localAtConnect=[...picks];
  if(!state.managed)localAtConnect=null;
  sharedState=state;choiceStates=new Map((state.items||[]).map(x=>[x.localId,x]));
  if(state.managed)picks=new Set((state.items||[]).filter(x=>x.decision==='preferred').map(x=>x.localId));
  $('#import-picks').disabled=!!(state.managed&&state.readonly);
  $('#export-picks').disabled=!!(state.managed&&(!state.synced||state.busy));
  $('#copy-link').disabled=!!(state.managed&&(!state.synced||state.busy));
  $('#picks-mode').textContent=state.managed?(state.readonly?'Viewing shared furniture choices. This page is read-only.':'Preferred, neutral and excluded choices are shared across devices. Pending changes are shown until the service confirms them.'):'Choices stay in this browser until you connect shared choices. Export or import a shortlist to carry local preferences elsewhere.';
  refreshPicks();
}
function choose(id,decision){
  if(!products.has(id))return false;
  if(sharedState.managed){
    if(sharedState.readonly||!sharedController)return false;
    if(decision==='excluded'){sharedController.openExclusion(id);return true}
    if(decision==='restore'){void sharedController.restore(id);return true}
    return sharedController.decide(id,decision);
  }
  if(decision!=='preferred'&&decision!=='neutral')return false;
  decision==='preferred'?picks.add(id):picks.delete(id);save();refreshPicks();return true;
}
function visibleProducts(d){return d.products.filter(p=>!p.removedFromDesign)}
function badge(d){if(d.isNew)return d.reviewAccepted?'New · reviewed concept':'New · work in review';if(/REJECTED|SUPERSEDED/i.test(d.status))return'Owner rejected · archive';return d.archival?'Historical study':'Existing design study'}
function statusClass(d){return /REJECTED|SUPERSEDED/i.test(d.status)||d.archival?'archive':''}
function viewFor(d,kind){return d.views.find(v=>v.kind===kind)}
const VIEW_LIGHTS=[['-day','Day'],['-night','Night'],['-golden','Golden hour']];
function viewLight(kind=''){const hit=VIEW_LIGHTS.find(([suffix])=>String(kind).endsWith(suffix));return hit?hit[1]:'Other'}
function viewKindLabel(kind,label=''){return {'entrance-day':'Entrance door · Day','bathroom-day':'Bathroom door · Day','window-ac-day':'Window corner · Day','entrance-night':'Entrance door · Night','bathroom-night':'Bathroom door · Night','window-ac-night':'Window corner · Night','entrance-golden':'Entrance door · Golden hour','bathroom-golden':'Bathroom door · Golden hour','window-ac-golden':'Window corner · Golden hour'}[kind]||label||kind.replaceAll('-',' · ')}
function viewTabsMarkup(views){const groups=new Map();views.forEach((v,i)=>{const light=viewLight(v.kind);if(!groups.has(light))groups.set(light,[]);groups.get(light).push(`<button data-view="${i}" aria-pressed="${i===0}">${esc(v.label.replace(' · '+light,''))}</button>`)});return [...groups].map(([light,buttons])=>`<div class="view-group" role="group" aria-label="${esc(light)} views"><span class="view-group-label">${esc(light)}</span>${buttons.join('')}</div>`).join('')}
function syncCompareView(){
  const select=$('#compare-view'),previous=select.value,selected=compared.map(id=>designs.find(d=>d.id===id)).filter(Boolean),available=new Map();
  for(const d of selected.length?selected:pageDesigns)for(const v of d.views)if(v.kind&&!available.has(v.kind))available.set(v.kind,viewKindLabel(v.kind,v.label));
  select.innerHTML=[...available].map(([kind,label])=>`<option value="${esc(kind)}">${esc(label)}</option>`).join('');
  select.disabled=!available.size;select.value=available.has(previous)?previous:available.keys().next().value||'';
  return select.value;
}
function cameraPlanMarkup(view){return view?.cameraPlan?`<p class="subtle"><a href="${esc(view.cameraPlan)}" target="_blank" rel="noopener noreferrer">Camera position plan ↗</a></p>`:''}
function imageButton(src,caption,cls=''){return src?`<img class="${cls}" src="${esc(src)}" alt="${esc(caption)}" loading="lazy" data-enlarge="${esc(src)}" data-caption="${esc(caption)}">`:''}
function openImage(src,caption){$('#large-image').src=src;$('#large-image').alt=caption;$('#large-caption').textContent=caption;$('#lightbox').showModal()}
function usageMarkup(p){
  const usage=usageIndex?.lookup(p);if(!usage?.productUses.length)return '';
  const exact=new Set(usage.exactVariantUses.map(use=>use.designId));
  return `<details class="design-usage"><summary>Saved designs (${usage.productUses.length})</summary><ul>${usage.productUses.map(use=>`<li><a href="${esc(use.href)}">${esc(use.designLabel)}</a>${use.archival?' · Historical':''} · ${exact.has(use.designId)?'Exact variant':'Product model'}</li>`).join('')}</ul></details>`;
}
function productCard(p,showOwner=false){const amount=p.totalCents;return `<article class="product" data-product-id="${esc(p.id)}"><div class="preference-controls" data-choice-controls="${esc(p.id)}">${preferenceMarkup(p)}</div>${p.image?imageButton(p.image,p.name,'product-photo'):'<div class="no-photo">'+(p.unitCents===null?'Specification / quote line':'No verified source photo in this version')+'</div>'}<p class="category">${esc(p.category||'Item')}</p>${showOwner?`<div class="owner-label">${esc(p.designLabel)}</div>`:''}<h4>${esc(p.name)}</h4><div class="amount">${money(amount)}</div><div class="qty">${esc(p.qty??'—')} × ${money(p.unitCents)}${p.priceDate?' · '+esc(p.priceDate):''}</div><p class="state">${esc(p.status||'See source record for price and availability limits.')}</p>${p.source?`<a class="source" href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">Supplier source ↗</a>`:''}${usageMarkup(p)}<details><summary>Variant, dimensions & evidence</summary><p>${esc(p.variant||p.sku||p.originalId||'Exact variant not recorded in this historical version.')}</p>${p.dimensions?`<p>${esc(typeof p.dimensions==='object'?JSON.stringify(p.dimensions):p.dimensions)}</p>`:''}<p>${esc(p.notes||'Current stock, Cebu fulfilment and installed fit require confirmation.')}</p><p>${esc(p.id)}</p></details></article>`}
function refreshPicks(){const selected=[...picks].map(id=>products.get(id)).filter(p=>p&&!p.removedFromDesign&&(archivePage||!p.designArchival));const retained=[...picks].filter(id=>products.has(id)).length-selected.length;$('#pick-count').textContent=selected.length;$('#picks-total').textContent=selected.length?'('+selected.length+')':'';$('#picks-grid').innerHTML=selected.length?selected.map(p=>productCard(p,true)).join(''):'<div class="empty">'+(retained?'No saved pieces in the current designs.':'Choose Prefer on a source piece to add it to your shortlist. Neutral and excluded choices remain visible in each design.')+'</div>';if(retained)$('#picks-grid').insertAdjacentHTML('beforeend',`<p class="subtle">${retained} previous selections retained for export with their current status.</p>`);document.querySelectorAll('[data-choice-controls]').forEach(node=>{const p=products.get(node.dataset.choiceControls);if(p)node.innerHTML=preferenceMarkup(p)})}
function designerFor(d){return /Fable/i.test(d.author)||d.namespace.startsWith('fable-')?'Fable':'Astra'}
function setLabel(d){
  const letters=designs.filter(x=>x.namespace===d.namespace).map(x=>x.letter).join(' / ');
  if(d.isNew)return letters+' · New directions';
  if(designerFor(d)==='Fable')return letters;
  if(d.namespace==='gpt-ghi-rejected-v001-20261021')return letters+' · Originally G / H / I';
  const version=d.namespace.replace(/^(astra|gpt|fable)-[a-z]+-/i,'').replace(/(^|-)\d{8}(?=-|$)/g,'').replace(/(^|-)v\d+(?=-|$)/gi,'').replace(/^-|-$/g,'').replace(/-/g,' ');
  return letters+(version?' · '+version.charAt(0).toUpperCase()+version.slice(1):'');
}
function setStatus(d){
  if(d.isNew)return d.reviewAccepted?'Reviewed concept · physical fit conditional':'New concept · review in progress';
  if(/REJECTED|SUPERSEDED/i.test(d.status))return 'Owner rejected · preserved for reference';
  if(/INCOMPLETE/i.test(d.status))return 'Historical study · incomplete';
  if(/NO_HUMAN_ACCEPTANCE/i.test(d.status))return 'Concept study · no recorded owner acceptance';
  return 'Historical study · preserved source version';
}
function roomDesigns(){return activeRoom?pageDesigns.filter(d=>d.room===activeRoom):pageDesigns}
function setRoom(id){if(!rooms.some(r=>r.id===id))return;activeRoom=id;const sel=$('#room-filter');if(sel&&sel.value!==id)sel.value=id;renderRoom();renderFeatured();renderGrid()}
function roomFigure(f,kind){return `<figure class="room-figure ${kind}"><button type="button" class="room-thumb" data-enlarge="${esc(f.image)}" data-caption="${esc(f.caption||'')}" aria-label="Enlarge"><img src="${esc(f.image)}" alt="${esc(f.caption||'')}" loading="lazy"></button><figcaption>${esc(f.caption||'')}</figcaption></figure>`}
function renderRoom(){
  const box=$('#room-panel');if(!box)return;const room=rooms.find(r=>r.id===activeRoom);if(!room){box.hidden=true;return}
  const count=roomDesigns().length;
  const figures=[...(room.plan?[roomFigure(room.plan,'plan')]:[]),...(room.photos||[]).map(f=>roomFigure(f,'photo')),...(room.model||[]).map(f=>roomFigure(f,'model'))].join('');
  box.innerHTML=`<div class="room-head"><div><p class="eyebrow">ROOM</p><h3>${esc(room.label)}</h3><p class="room-status ${esc(room.status||'')}">${esc(room.statusLabel||'')}${count?' · '+count+' design versions here':''}</p></div><p class="room-lead">${esc(room.lead||'')}</p></div>`
    +(figures?`<div class="room-figures">${figures}</div>`:'')
    +`<div class="room-facts"><div><p class="eyebrow">WHAT IS KNOWN</p><dl class="room-dims">${(room.dimensions||[]).map(x=>`<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)} <span class="basis">${esc(x.basis||'')}</span></dd></div>`).join('')}</dl></div>`
    +`<div><p class="eyebrow">STILL TO MEASURE</p><ul class="room-todo">${(room.toMeasure||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p class="subtle">${esc(room.packs||'')}</p></div></div>`;
  box.hidden=false;
}
function designCard(d){return `<article class="design-card"><button class="thumb-button" data-open="${esc(d.id)}" aria-label="Open ${esc(d.letter+' — '+d.name+' / '+d.author)}">${d.hero?`<img src="${esc(d.hero)}" alt="${esc(d.name)}" loading="lazy">`:'<div class="empty">Images not delivered in this source version</div>'}<span class="badge ${statusClass(d)}">${esc(badge(d))}</span></button><div class="card-meta"><span>${esc(d.author)} · ${esc(d.letter)}</span><span>${esc(d.date)}</span></div><h5>${esc(d.name)}</h5><p class="summary">${esc(d.summary||d.version)}</p><div class="card-actions"><button data-open="${esc(d.id)}">Explore ${esc(d.letter)} →</button><button data-compare="${esc(d.id)}" aria-pressed="${compared.includes(d.id)}">${compared.includes(d.id)?'✓ Comparing':'+ Compare'}</button></div></article>`}
function renderGrid(){
  const author=$('#author-filter').value,status=$('#status-filter').value,search=$('#search').value.trim().toLocaleLowerCase();
  const inRoom=roomDesigns(),room=rooms.find(r=>r.id===activeRoom);
  const list=inRoom.filter(d=>{
    if(author&&designerFor(d)!==author)return false;
    if(status==='new'&&!d.isNew)return false;
    if(status==='study'&&(d.archival||d.isNew))return false;
    if(status==='archive'&&!d.archival)return false;
    if(status==='rejected'&&!/REJECTED|SUPERSEDED/i.test(d.status))return false;
    if(status==='historical'&&/REJECTED|SUPERSEDED/i.test(d.status))return false;
    return !search||[d.letter,d.name,d.author,d.namespace,d.date,d.version,d.summary,setLabel(d),...visibleProducts(d).map(p=>p.name)].join(' ').toLocaleLowerCase().includes(search);
  });
  const groups=['Astra','Fable'].map(author=>{
    const members=list.filter(d=>designerFor(d)===author),sets=new Map();
    members.forEach(d=>{if(!sets.has(d.namespace))sets.set(d.namespace,[]);sets.get(d.namespace).push(d)});
    return {author,title:author==='Astra'?'Astra / GPT':'Fable / Claude',members,sets:[...sets.values()].sort((a,b)=>Number(!!b[0].isNew)-Number(!!a[0].isNew)||Number(!!a[0].archival)-Number(!!b[0].archival)||b[0].date.localeCompare(a[0].date))};
  }).filter(g=>g.members.length);
  const setCount=groups.reduce((n,g)=>n+g.sets.length,0);
  $('#result-count').textContent=`${list.length} of ${inRoom.length} ${archivePage?'archived versions':'finished designs'} · ${setCount} of ${new Set(inRoom.map(d=>d.namespace)).size} sets`;
  $('#collection-jumps').innerHTML=groups.map(g=>`<a href="#designer-${g.author.toLowerCase()}"><strong>${g.title}</strong><span>${g.sets.length} sets · ${g.members.length} design versions</span><span aria-hidden="true">↓</span></a>`).join('');
  $('#design-grid').innerHTML=groups.map(g=>`<section id="designer-${g.author.toLowerCase()}" class="designer-group" aria-labelledby="heading-${g.author.toLowerCase()}"><div class="designer-heading"><div><p class="eyebrow">${g.author==='Astra'?'ASTRA / GPT COLLECTION':'FABLE / CLAUDE COLLECTION'}</p><h3 id="heading-${g.author.toLowerCase()}">${g.title}</h3></div><p class="subtle">${g.sets.length} sets · ${g.members.length} design versions</p></div><nav class="set-jumps" aria-label="${g.title} sets">${g.sets.map(set=>`<a href="#set-${esc(set[0].namespace)}">${esc(setLabel(set[0]))}</a>`).join('')}</nav>${g.sets.map(set=>{
    const d=set[0],source=data.coverage?.sets?.find(s=>s.namespace===d.namespace);
    return `<section id="set-${esc(d.namespace)}" class="design-set" aria-labelledby="heading-${esc(d.namespace)}"><div class="set-heading"><div><p class="set-meta"><time datetime="${esc(d.date)}">${esc(d.date)}</time> · ${d.version!==d.namespace?'Version '+esc(d.version):'Preserved source version'}</p><h4 id="heading-${esc(d.namespace)}">${esc(setLabel(d))}</h4>${source?`<p class="set-description">${esc(source.title)}</p>`:''}<p class="set-namespace">${esc(d.namespace)}</p></div><p class="set-status ${statusClass(d)}">${esc(setStatus(d))}</p></div><div class="design-grid">${set.map(designCard).join('')}</div></section>`;
  }).join('')}</section>`).join('')||'<div class="empty">'+esc(!inRoom.length&&room?.emptyNote||'No designs match these filters.')+'</div>';
}
function renderFeatured(){const fresh=roomDesigns().filter(d=>d.isNew);$('#featured').innerHTML=fresh.map(d=>`<article class="feature" data-open="${esc(d.id)}" tabindex="0" role="button" aria-label="Explore new ${esc(d.letter+' '+d.name)}">${d.hero?`<img src="${esc(d.hero)}" alt="${esc(d.name)}">`:'<div class="empty">New design in preparation</div>'}<div class="feature-text"><span class="feature-letter">${esc(d.letter)}</span><div><h3>${esc(d.name)}</h3><p>${designerFor(d)==='Fable'?'Fable / Claude':'GPT Astra'} · ${d.reviewAccepted?'reviewed concept':'new direction'}</p></div></div></article>`).join('');$('#featured').hidden=!fresh.length}
function budgetMarkup(b){
  if(!b)return'<p>No complete priced schedule was delivered in this historical version.</p>';
  let out='';
  const line=(name,value,total=false)=>`<div class="budget-line ${total?'total':''}"><span>${name}</span><span>${value}</span></div>`;
  for(const [k,n] of [['retailCents','Source-priced items'],['datedAllocationCents','Dated curtain allocation'],['reserveCents','Planning allowances'],['contingencyCents','Contingency']])if(b[k]!=null)out+=line(n,money(b[k]));
  for(const [low,high,label] of [['reserveLowCents','reserveHighCents','Allowance range'],['optionalLowCents','optionalHighCents','Conditional options'],['contingencyLowCents','contingencyHighCents','Contingency range']])if(b[low]!=null)out+=line(label,money(b[low])+'–'+money(b[high]));
  if(b.totalCents!=null)out+=line('Planning total',money(b.totalCents),true);
  else if(b.totalLowCents!=null)out+=line('Planning range',money(b.totalLowCents)+'–'+money(b.totalHighCents),true);
  return out+`<p>${esc(b.note||'Dated source figures and provisional allowances. No order or installation quotation is implied.')}</p>`;
}
const preloaded=new Set(),preloading=new Set();function preloadViews(d){for(const x of d.views||[]){if(!x.image||preloaded.has(x.image))continue;preloaded.add(x.image);const i=new Image();i.fetchPriority='low';preloading.add(i);i.onload=i.onerror=()=>preloading.delete(i);i.src=x.image}}
function openDesign(id){const d=designs.find(x=>x.id===id);if(!d)return;activeDesign=d;preloadViews(d);const v=d.views[0];$('#detail').hidden=false;$('#detail').innerHTML=`<div class="detail-title"><span class="detail-letter">${esc(d.letter)}</span><div><p class="eyebrow">${esc(d.author)} · ${esc(d.date)}</p><h2>${esc(d.name)}</h2><p>${esc(d.version)} · <span class="badge ${statusClass(d)}">${esc(badge(d))}</span></p></div></div><div class="detail-layout"><div class="view-area">${v?imageButton(v.image,d.name+' — '+v.label,'active-view'):'<div class="empty">No delivered view</div>'}<div class="view-tabs">${viewTabsMarkup(d.views)}</div><p class="view-caption">${esc(v?.caption||v?.method||d.viewNote||'Concept image. Review limits and source product photos are part of this design.')}</p><div class="view-camera-plan">${cameraPlanMarkup(v)}</div></div><aside class="notes"><h3>Read the design</h3><p>${esc(d.summary)}</p>${budgetMarkup(d.budget)}<details open><summary>Review & practical limits</summary><ul>${(d.reviewNotes||[]).map(n=>'<li>'+esc(n)+'</li>').join('')}</ul><p class="status-raw">Source status: ${esc(d.status)}</p></details>${d.originalUrl?`<p><a href="${esc(d.originalUrl)}" target="_blank" rel="noopener noreferrer">${esc(d.originalLabel||'Open original gallery')} ↗</a></p>`:''}${d.evidenceUrl?`<p><a href="${esc(d.evidenceUrl)}" target="_blank" rel="noopener noreferrer">Open preserved source record ↗</a></p>`:''}<button data-compare="${esc(d.id)}" aria-pressed="${compared.includes(d.id)}">${compared.includes(d.id)?'✓ Comparing':'+ Compare this room'}</button></aside></div><div class="product-head"><div><p class="eyebrow">REAL PIECES / DATED SOURCES</p><h3>The complete source schedule</h3></div><span class="subtle">${visibleProducts(d).length} lines</span></div><div class="products">${visibleProducts(d).length?visibleProducts(d).map(p=>productCard(p)).join(''):'<div class="empty">This earlier visual study did not contain a complete product schedule. No prices have been invented.</div>'}</div>`;$('#detail').scrollIntoView({behavior:'smooth',block:'start'})}
function renderCompare(){
  try{sessionStorage.setItem(compareKey,JSON.stringify(compared))}catch{ /* Comparison still works on this page when storage is unavailable. */ }
  const kind=syncCompareView();$('#compare-count').textContent=compared.length;$('#compare-grid').innerHTML=compared.length?compared.map(id=>{const d=designs.find(x=>x.id===id),v=viewFor(d,kind);return`<article class="compare-item">${v?imageButton(v.image,d.name+' — '+v.label):`<div class="missing">${esc(viewKindLabel(kind))}<br>No delivered view in this version.</div>`}${cameraPlanMarkup(v)}<h3>${esc(d.letter+' · '+d.name)}</h3><p>${esc(d.author)} · ${esc(d.version)}</p><p>${esc(badge(d))}</p><p>${d.budget?.totalCents!=null?money(d.budget.totalCents)+' planning total':'See original source schedule'}</p><button data-open="${esc(d.id)}">Source pieces</button><button data-remove-compare="${esc(d.id)}">Remove</button></article>`}).join(''):'<div class="empty">Use “Compare” on up to three design cards.</div>';document.querySelectorAll('[data-compare]').forEach(b=>{const on=compared.includes(b.dataset.compare);b.setAttribute('aria-pressed',String(on));b.textContent=on?'✓ Comparing':'+ Compare'})}
function parsePicks(input){const raw=input.trim();if(/(?:[?#&]sync=|shared-access|access.?token|"token"|credential)/i.test(raw))throw Error('This contains shared-access information. Use a picks export or picks-only link instead.');if(!raw)return[];if(raw.startsWith('{')||raw.startsWith('[')){const x=JSON.parse(raw);const list=Array.isArray(x)?x:x.picks||x.items||[];if(!Array.isArray(list))throw Error('The export needs an array of picks.');return list.map(p=>typeof p==='string'?p:p.id||p.itemId||p.item_id).filter(x=>typeof x==='string')}let s=raw;try{const u=new URL(raw,location.href);const params=new URLSearchParams(u.hash.slice(1));if(params.has('picks'))s=params.get('picks');else if(u.searchParams.has('picks'))s=u.searchParams.get('picks')}catch{}return s.split(',').map(x=>decodeURIComponent(x.trim())).filter(Boolean)}
function importPicks(raw,scope=''){if(sharedState.managed&&sharedState.readonly)return{added:0,missing:[],error:'This shared viewing page is read-only. No choices were imported.'};let ids;try{ids=parsePicks(raw)}catch(e){return{added:0,missing:[],error:e.message}}if(ids.length>3000)return{added:0,missing:[],error:'The import exceeds 3000 items.'};let added=0;const missing=[];for(const id of ids){let match=products.has(id)?[products.get(id)]:[...products.values()].filter(p=>(p.legacyIds||[]).includes(id)&&(!scope||p.namespace===scope));const unique=[...new Map(match.map(p=>[p.id,p])).values()];if(unique.length===1){if(!picks.has(unique[0].id)){if(choose(unique[0].id,'preferred'))added++;else missing.push(id)}}else missing.push(id)}return{added,missing}}
function exportObject(){if(sharedState.managed&&(!sharedState.synced||sharedState.busy))throw Error('Wait for shared choices to sync before exporting.');return{schema:'unit408-combined-picks/1',exportedAt:new Date().toISOString(),build:data.build,scope:sharedState.managed?'Confirmed shared preferred items; exclusions are in the shared-choices export':'Local preferred items',picks:[...picks].filter(id=>products.has(id)),items:[...picks].map(id=>products.get(id)).filter(Boolean).map(p=>({id:p.id,name:p.name,design:p.designLabel,source:p.source,qty:p.qty,totalCents:p.totalCents,removedFromDesign:Boolean(p.removedFromDesign),archival:Boolean(p.designArchival)}))}}
document.addEventListener('click',e=>{const open=e.target.closest('[data-open]');if(open){openDesign(open.dataset.open);return}const enlarge=e.target.closest('[data-enlarge]');if(enlarge){openImage(enlarge.dataset.enlarge,enlarge.dataset.caption);return}const choice=e.target.closest('[data-choice]');if(choice){if(!choice.disabled)choose(choice.dataset.pick||choice.dataset.choiceId,choice.dataset.choice);return}const comp=e.target.closest('[data-compare]');if(comp){const id=comp.dataset.compare;if(compared.includes(id))compared=compared.filter(x=>x!==id);else if(compared.length<3)compared.push(id);else{toast('Compare up to three designs. Remove one to add another.');return}renderCompare();return}const rm=e.target.closest('[data-remove-compare]');if(rm){compared=compared.filter(x=>x!==rm.dataset.removeCompare);renderCompare();return}const view=e.target.closest('[data-view]');if(view&&activeDesign){const v=activeDesign.views[Number(view.dataset.view)],im=$('#detail .active-view');im.src=v.image;if(!im.complete){im.classList.add('is-loading');const done=()=>im.classList.remove('is-loading');im.addEventListener('load',done,{once:true});im.addEventListener('error',done,{once:true})}im.alt=activeDesign.name+' — '+v.label;im.dataset.enlarge=v.image;im.dataset.caption=im.alt;$('#detail .view-caption').textContent=v.caption||v.method||activeDesign.viewNote||'Concept view; see source and review notes.';$('#detail .view-camera-plan').innerHTML=cameraPlanMarkup(v);$('#detail').querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===view)))}});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.feature')){e.preventDefault();openDesign(e.target.dataset.open)}});
$('#lightbox .close').onclick=()=>$('#lightbox').close();$('#lightbox').addEventListener('click',e=>{if(e.target===$('#lightbox'))$('#lightbox').close()});
$('#author-filter').onchange=renderGrid;$('#status-filter').onchange=renderGrid;$('#search').oninput=renderGrid;$('#compare-view').onchange=renderCompare;
$('#export-picks').onclick=()=>{try{const blob=new Blob([JSON.stringify(exportObject(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='408-combined-picks.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(sharedState.managed?'Confirmed preferred items exported. Use Export shared choices to include exclusions.':'Local preferred items exported.')}catch(error){toast(error.message)}};
$('#copy-link').onclick=async()=>{if(sharedState.managed&&(!sharedState.synced||sharedState.busy)){toast('Wait for shared choices to sync before copying a link.');return}const url=location.origin+location.pathname+'#picks='+[...picks].filter(id=>products.has(id)).map(encodeURIComponent).join(',');try{await navigator.clipboard.writeText(url);toast('Picks link copied. Open it in another browser to add these choices.')}catch{$('#import-text').value=url;$('#import-text').closest('details').open=true;toast('The link is shown in the import box for copying.')}};
$('#import-picks').onclick=()=>{const r=importPicks($('#import-text').value,$('#legacy-scope').value);$('#import-result').textContent=r.error||`Added ${r.added} picks.${r.missing.length?' '+r.missing.length+' unknown or ambiguous IDs were not imported: '+r.missing.slice(0,12).join(', '):' Existing picks preserved.'}`};
async function init(){try{
  const response=await fetch('collection-data.json',{cache:'no-store'});if(!response.ok)throw Error('Cannot load design data');
  data=await response.json();designs=data.designs;pageDesigns=designs.filter(d=>Boolean(d.archival)===archivePage);
  rooms=Array.isArray(data.rooms)&&data.rooms.length?data.rooms:[{id:'master',label:'Master bedroom',status:'designs',statusLabel:'Finished designs'}];
  for(const d of designs)d.room=d.room||'master';
  const roomSelect=$('#room-filter');
  if(roomSelect){roomSelect.innerHTML=rooms.map(r=>{const n=pageDesigns.filter(d=>d.room===r.id).length;return `<option value="${esc(r.id)}">${esc(r.label)} · ${n?n+' designs':r.status==='placeholder'?'placeholder':'no designs yet'}</option>`}).join('');roomSelect.onchange=()=>{location.hash='room='+roomSelect.value};activeRoom=rooms[0].id}
  usageIndex=globalThis.Unit408Usage?.build(designs)||null;
  for(const d of designs)for(const p of d.products){p.namespace=d.namespace;p.designArchival=Boolean(d.archival);p.designLabel=d.author+' · '+d.letter+' · '+d.name;products.set(p.id,p)}
  load();if(testMode){document.body.classList.add('testing');$('#build-label').textContent='ISOLATED QA STORAGE'}else $('#build-label').textContent=data.build;
  $('#review-url').textContent=location.origin+location.pathname;$('#review-url').href=location.origin+location.pathname;
  $('#footer-build').textContent=pageDesigns.length+(archivePage?' archived versions':' finished designs');
  $('#scope-summary').innerHTML=['Astra','Fable'].map(author=>{const count=pageDesigns.filter(d=>designerFor(d)===author).length;return count?`<a href="#designer-${author.toLowerCase()}"><strong>${author==='Astra'?'Astra / GPT':'Fable / Claude'} · ${count} ${archivePage?'archived versions':'designs'}</strong></a>`:''}).filter(Boolean).join(' &nbsp; / &nbsp; ');
  const otherCount=designs.length-pageDesigns.length;
  if($('#other-collection'))$('#other-collection').textContent=archivePage?`View ${otherCount} finished designs →`:`Archive · ${otherCount} older and rejected versions →`;
  renderRoom();renderFeatured();renderGrid();renderCompare();refreshPicks();
  if(window.unit408CollectionSync)sharedController=await window.unit408CollectionSync.start({testMode,get:()=>localAtConnect||[...picks],restore:()=>{load()},update:updateShared});
  const namespaces=new Set(pageDesigns.map(d=>d.namespace));
  $('#coverage').innerHTML=`<p>${pageDesigns.length} ${archivePage?'archived versions':'finished designs'} across ${namespaces.size} sets. Original source and review statuses are preserved.</p>`+(data.coverage?.sets||[]).filter(s=>namespaces.has(s.namespace)).map(s=>`<div class="coverage-row"><strong>${esc(s.title)}</strong><br>${esc(s.namespace)} · ${esc(s.status)}</div>`).join('');
  if(location.hash.startsWith('#picks=')){const r=importPicks(location.href);toast(r.error||`Imported ${r.added} picks${r.missing.length?'; '+r.missing.length+' need a legacy set choice':''}.`)}
  if(routeCollectionHash())return;
  if(new URLSearchParams(location.search).get('shared-picks')==='1')$('#picks').scrollIntoView({block:'start'});
}catch(e){$('#design-grid').innerHTML='<div class="empty">'+esc(e.message)+'</div>'}}
init();

}
