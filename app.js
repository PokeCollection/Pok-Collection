const API = 'https://api.tcgdex.net/v2';
const KEY = 'pokeCollection_v1';
const WISH_KEY = 'pokeWishlist_v1';
let collection = load(KEY, []);
let wishlist = load(WISH_KEY, []);
let deferredInstall = null;
let modalState = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (n) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(n)||0);
const safe = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function load(key, fallback){ try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(){ localStorage.setItem(KEY, JSON.stringify(collection)); localStorage.setItem(WISH_KEY, JSON.stringify(wishlist)); renderAll(); }
function imageUrl(base, quality='low'){ return base ? `${base}/${quality}.webp` : ''; }
function uid(){ return crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2200); }

function marketValue(card, variant='normal'){
  const cm = card?.pricing?.cardmarket;
  if(!cm) return 0;
  const holo = ['holo','reverse'].includes(variant);
  const candidates = holo ? [cm['trend-holo'],cm['avg7-holo'],cm['avg30-holo'],cm['avg-holo']] : [cm.trend,cm.avg7,cm.avg30,cm.avg];
  return Number(candidates.find(v => Number.isFinite(Number(v)) && Number(v)>0)) || 0;
}
function itemValue(item){ return (Number(item.manualValue)>0 ? Number(item.manualValue) : Number(item.marketValue)||0) * (Number(item.qty)||1); }
function itemSpent(item){ return (Number(item.paidPrice)||0) * (Number(item.qty)||1); }

function switchView(name){
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='collection') renderCollection();
  if(name==='wishlist') renderWishlist();
}

$$('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.go)));

function renderStats(){
  const count = collection.reduce((s,x)=>s+(Number(x.qty)||1),0);
  const value = collection.reduce((s,x)=>s+itemValue(x),0);
  const spent = collection.reduce((s,x)=>s+itemSpent(x),0);
  const profit = value-spent;
  $('#statCards').textContent = count;
  $('#statValue').textContent = money(value);
  $('#statSpent').textContent = money(spent);
  $('#statProfit').textContent = `${profit>=0?'+':''}${money(profit)}`;
  $('#statProfit').className = profit>=0 ? 'profit-pos' : 'profit-neg';
  const top=[...collection].sort((a,b)=>itemValue(b)-itemValue(a)).slice(0,6);
  $('#topCards').className = top.length ? 'collection-grid' : 'collection-grid empty-state';
  $('#topCards').innerHTML = top.length ? top.map(collectionCardHtml).join('') : 'Nessuna carta ancora inserita.';
  bindCollectionCards($('#topCards'));
}

function collectionCardHtml(item){
  const v=itemValue(item);
  return `<article class="collection-card" data-item-id="${safe(item.uid)}">
    <div class="card-image-wrap">${item.image?`<img loading="lazy" src="${safe(imageUrl(item.image,'low'))}" alt="${safe(item.name)}">`:'<span>🃏</span>'}</div>
    <div class="card-info"><h3>${safe(item.name)}</h3><p>${safe(item.setName||'')} · #${safe(item.localId||'')}</p><p>${safe(item.condition||'')} · ${safe(item.variant||'')}</p>
      <div class="price-line"><strong>${money(v)}</strong><span class="tag">x${Number(item.qty)||1}</span></div></div>
  </article>`;
}
function bindCollectionCards(root=document){ root.querySelectorAll('[data-item-id]').forEach(el=>el.addEventListener('click',()=>openOwned(el.dataset.itemId))); }

function renderCollection(){
  const q=$('#collectionFilter').value.trim().toLowerCase(); const sort=$('#collectionSort').value;
  let items=collection.filter(x=>`${x.name} ${x.setName} ${x.localId}`.toLowerCase().includes(q));
  if(sort==='value') items.sort((a,b)=>itemValue(b)-itemValue(a));
  if(sort==='name') items.sort((a,b)=>a.name.localeCompare(b.name,'it'));
  if(sort==='recent') items.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
  const grid=$('#collectionGrid');
  grid.className=items.length?'collection-grid':'collection-grid empty-state';
  grid.innerHTML=items.length?items.map(collectionCardHtml).join(''):'La collezione è vuota. Cerca una carta e aggiungila.';
  bindCollectionCards(grid);
}
$('#collectionFilter').addEventListener('input',renderCollection); $('#collectionSort').addEventListener('change',renderCollection);

function renderWishlist(){
  const grid=$('#wishlistGrid');
  grid.className=wishlist.length?'collection-grid':'collection-grid empty-state';
  grid.innerHTML=wishlist.length?wishlist.map(w=>`<article class="collection-card" data-wish-id="${safe(w.id)}"><div class="card-image-wrap">${w.image?`<img loading="lazy" src="${safe(imageUrl(w.image,'low'))}" alt="${safe(w.name)}">`:'🃏'}</div><div class="card-info"><h3>${safe(w.name)}</h3><p>#${safe(w.localId||'')}</p><div class="price-line"><span class="tag">Wishlist</span><strong>Apri</strong></div></div></article>`).join(''):'Nessuna carta nella wishlist.';
  grid.querySelectorAll('[data-wish-id]').forEach(el=>el.addEventListener('click',()=>openCardById(el.dataset.wishId,wishlist.find(w=>w.id===el.dataset.wishId)?.lang||'it')));
}


let scanPreviewUrl = null;
let ocrLoadPromise = null;

function setScanProgress(value, message){
  const box=$('#scanProgress'); const bar=$('#scanProgressBar'); const status=$('#scanStatus');
  box.classList.remove('hidden');
  bar.style.width=`${Math.max(2,Math.min(100,Math.round(value)))}%`;
  if(message) status.textContent=message;
}

function loadTesseract(){
  if(window.Tesseract) return Promise.resolve(window.Tesseract);
  if(ocrLoadPromise) return ocrLoadPromise;
  ocrLoadPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
    s.async=true;
    s.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('OCR non disponibile'));
    s.onerror=()=>reject(new Error('Impossibile caricare il motore OCR'));
    document.head.appendChild(s);
  });
  return ocrLoadPromise;
}

async function fileToCanvas(file){
  let source,w,h,cleanup=()=>{};
  if('createImageBitmap' in window){
    try{
      source=await createImageBitmap(file,{imageOrientation:'from-image'});
      w=source.width;h=source.height;cleanup=()=>source.close?.();
    }catch{}
  }
  if(!source){
    const url=URL.createObjectURL(file); const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
    source=img;w=img.naturalWidth;h=img.naturalHeight;cleanup=()=>URL.revokeObjectURL(url);
  }
  const maxSide=1600; const scale=Math.min(1,maxSide/Math.max(w,h));
  const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(w*scale)); canvas.height=Math.max(1,Math.round(h*scale));
  const ctx=canvas.getContext('2d',{alpha:false}); ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);cleanup();
  return canvas;
}

function normalizeScanText(s=''){
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
}

function extractScanHints(topText,bottomText){
  const joined=`${topText}\n${bottomText}`;
  const numberMatches=[];
  const fraction=/\b(\d{1,3})\s*[\/|]\s*(\d{1,3})\b/g;
  for(const source of [bottomText,joined]){
    let m; while((m=fraction.exec(source))){ if(!numberMatches.includes(m[1])) numberMatches.push(m[1]); }
    fraction.lastIndex=0;
  }
  const expanded=[];
  numberMatches.forEach(n=>{expanded.push(n); if(/^0+\d+$/.test(n)){const stripped=String(Number(n)); if(stripped!=='NaN'&&!expanded.includes(stripped))expanded.push(stripped);}});

  const stops=new Set(['BASIC','STAGE','STAGE1','STAGE2','TRAINER','ENERGY','ABILITY','RULE','POKEMON','POKÉMON','ILLUS','WEAKNESS','RESISTANCE','RETREAT','DAMAGE','HP']);
  const lines=topText.split(/\n+/).map(x=>x.replace(/\bHP\s*\d+\b/ig,' ').replace(/\b\d+\s*HP\b/ig,' ').replace(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9'’\- ]+/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean);
  const phrases=[];
  for(const line of lines){
    const words=line.split(' ').filter(Boolean);
    const useful=words.filter(w=>!stops.has(normalizeScanText(w)) && (/^[A-Za-zÀ-ÖØ-öø-ÿ'’\-]{2,}$/.test(w) || /^(EX|GX|VMAX|VSTAR|V)$/i.test(w)));
    if(useful.length && useful.length<=5){
      const phrase=useful.join(' ').trim();
      if(phrase.length>=3 && !phrases.some(x=>normalizeScanText(x)===normalizeScanText(phrase))) phrases.push(phrase);
    }
  }
  const tokens=[];
  phrases.forEach(p=>p.split(/\s+/).forEach(w=>{const n=normalizeScanText(w);if(n.length>=3&&!stops.has(n)&&!tokens.includes(w))tokens.push(w);}));
  return {numbers:expanded.slice(0,3),phrases:phrases.slice(0,4),tokens:tokens.slice(0,5),raw:joined.trim()};
}

function scoreScannedCard(card,hints){
  const ocr=normalizeScanText(hints.raw); const name=normalizeScanText(card.name); let score=0;
  if(name && ocr.includes(name)) score+=30;
  const nameWords=name.split(' ').filter(w=>w.length>=2);
  nameWords.forEach(w=>{if(ocr.includes(w))score+=5;});
  const local=normalizeScanText(card.localId).replace(/ /g,'');
  hints.numbers.forEach((n,i)=>{const nn=normalizeScanText(n).replace(/ /g,''); if(local===nn)score+=30-(i*2);});
  hints.phrases.forEach(p=>{const np=normalizeScanText(p);if(np&&name.includes(np))score+=12;});
  return score;
}

async function findScanCandidates(hints,lang){
  const urls=[];
  hints.numbers.forEach(n=>urls.push(`${API}/${lang}/cards?localId=${encodeURIComponent(n)}&pagination:page=1&pagination:itemsPerPage=100`));
  hints.phrases.slice(0,3).forEach(p=>urls.push(`${API}/${lang}/cards?name=${encodeURIComponent(p)}&pagination:page=1&pagination:itemsPerPage=80`));
  hints.tokens.slice(0,4).forEach(t=>urls.push(`${API}/${lang}/cards?name=${encodeURIComponent(t)}&pagination:page=1&pagination:itemsPerPage=80`));
  if(!urls.length) return [];
  const settled=await Promise.allSettled(urls.map(u=>fetch(u).then(r=>{if(!r.ok)throw new Error();return r.json();})));
  const map=new Map(); settled.forEach(x=>{if(x.status==='fulfilled'&&Array.isArray(x.value))x.value.forEach(c=>map.set(c.id,c));});
  const ranked=[...map.values()].map(c=>({...c,_score:scoreScannedCard(c,hints)})).sort((a,b)=>b._score-a._score).slice(0,12);
  const detailed=await Promise.all(ranked.map(async c=>{try{const r=await fetch(`${API}/${lang}/cards/${encodeURIComponent(c.id)}`);if(r.ok){const d=await r.json();return {...c,setName:d?.set?.name||'',rarity:d?.rarity||''};}}catch{}return c;}));
  return detailed;
}

function renderScanCandidates(cards,lang){
  const grid=$('#scanResults');
  if(!cards.length){grid.innerHTML='<div class="scan-empty">Non ho trovato una corrispondenza sicura. Prova con una foto più ravvicinata e senza riflessi, oppure usa la ricerca manuale qui sotto.</div>';return;}
  grid.innerHTML=cards.map((c,i)=>`<article class="result-card" data-card-id="${safe(c.id)}" data-lang="${safe(lang)}"><div class="card-image-wrap">${c.image?`<img loading="lazy" src="${safe(imageUrl(c.image,'low'))}" alt="${safe(c.name)}">`:'🃏'}</div><div class="card-info"><h3>${safe(c.name)}</h3><p>${safe(c.setName||'')} · #${safe(c.localId||'')}</p><span class="scan-match-note">${i===0?'Corrispondenza più probabile':'Possibile corrispondenza'}</span><div class="price-line"><span class="tag">Conferma</span></div></div></article>`).join('');
  grid.querySelectorAll('[data-card-id]').forEach(el=>el.addEventListener('click',()=>openCardById(el.dataset.cardId,el.dataset.lang)));
}

async function scanCardFile(file){
  if(!file) return;
  if(!file.type.startsWith('image/')){toast('Seleziona una foto della carta');return;}
  const lang=$('#searchLang').value;
  if(scanPreviewUrl)URL.revokeObjectURL(scanPreviewUrl);
  scanPreviewUrl=URL.createObjectURL(file);$('#scanPreview').src=scanPreviewUrl;$('#scanPreviewWrap').classList.remove('hidden');
  $('#scanDetected').classList.add('hidden');$('#scanResults').innerHTML='';
  setScanProgress(4,'Preparazione della foto…');
  let worker;
  try{
    const canvas=await fileToCanvas(file);
    setScanProgress(10,'Caricamento del riconoscimento ottico…');
    await loadTesseract();
    worker=await Tesseract.createWorker('eng',1,{logger:m=>{
      if(m.status==='recognizing text'&&Number.isFinite(m.progress)) setScanProgress(15+(m.progress*55),'Lettura di nome e numero della carta…');
    }});
    const w=canvas.width,h=canvas.height;
    const top=await worker.recognize(canvas,{rectangle:{left:0,top:0,width:w,height:Math.max(1,Math.round(h*.38))}});
    setScanProgress(72,'Lettura del numero della carta…');
    const bottom=await worker.recognize(canvas,{rectangle:{left:0,top:Math.round(h*.58),width:w,height:Math.max(1,Math.round(h*.42))}});
    const topText=top?.data?.text||'', bottomText=bottom?.data?.text||'';
    const hints=extractScanHints(topText,bottomText);
    const compact=hints.raw.replace(/\s+/g,' ').trim().slice(0,260);
    $('#scanDetectedText').textContent=compact||'Nessun testo leggibile';$('#scanDetected').classList.remove('hidden');
    if(hints.numbers[0]) $('#searchInput').value=hints.numbers[0]; else if(hints.phrases[0]) $('#searchInput').value=hints.phrases[0];
    setScanProgress(82,'Confronto con il catalogo Pokémon…');
    const matches=await findScanCandidates(hints,lang);
    renderScanCandidates(matches,lang);
    setScanProgress(100,matches.length?`Trovate ${matches.length} possibili corrispondenze. Tocca la carta corretta.`:'Nessuna corrispondenza automatica. Puoi riprovare o cercare manualmente.');
  }catch(err){
    console.error(err);setScanProgress(100,'Riconoscimento non riuscito. Controlla la connessione e riprova con una foto nitida.');
    $('#scanResults').innerHTML='<div class="scan-empty">La scansione non è riuscita. Puoi comunque cercare la carta manualmente qui sotto.</div>';
  }finally{
    try{await worker?.terminate();}catch{}
  }
}

['scanCamera','scanGallery'].forEach(id=>$('#'+id).addEventListener('change',e=>{const f=e.target.files?.[0];scanCardFile(f);e.target.value='';}));
$('#homeScanBtn').addEventListener('click',()=>{switchView('search');setTimeout(()=>$('#scanCamera').click(),0);});

async function searchCards(){
  const q=$('#searchInput').value.trim(); const lang=$('#searchLang').value;
  if(q.length<2){ $('#searchStatus').textContent='Digita almeno 2 caratteri.'; return; }
  $('#searchStatus').textContent='Ricerca in corso…'; $('#searchResults').innerHTML='';
  try{
    const urls=[`${API}/${lang}/cards?name=${encodeURIComponent(q)}&pagination:page=1&pagination:itemsPerPage=36`];
    if(/^\d+[a-z]?$/i.test(q)) urls.push(`${API}/${lang}/cards?localId=${encodeURIComponent(q)}&pagination:page=1&pagination:itemsPerPage=36`);
    const lists=await Promise.all(urls.map(u=>fetch(u).then(r=>{if(!r.ok)throw new Error();return r.json();})));
    const map=new Map(); lists.flat().forEach(c=>map.set(c.id,c)); const cards=[...map.values()].slice(0,40);
    $('#searchStatus').textContent=cards.length?`${cards.length} risultati. Tocca una carta per vedere i dettagli.`:'Nessun risultato.';
    $('#searchResults').innerHTML=cards.map(c=>`<article class="result-card" data-card-id="${safe(c.id)}" data-lang="${lang}"><div class="card-image-wrap">${c.image?`<img loading="lazy" src="${safe(imageUrl(c.image,'low'))}" alt="${safe(c.name)}">`:'🃏'}</div><div class="card-info"><h3>${safe(c.name)}</h3><p>#${safe(c.localId)}</p><div class="price-line"><span class="tag">Apri</span></div></div></article>`).join('');
    $$('#searchResults [data-card-id]').forEach(el=>el.addEventListener('click',()=>openCardById(el.dataset.cardId,el.dataset.lang)));
  }catch(e){ $('#searchStatus').textContent='Non riesco a contattare il catalogo. Controlla la connessione e riprova.'; }
}
$('#searchBtn').addEventListener('click',searchCards); $('#searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')searchCards();});

async function openCardById(id,lang='it'){
  const dlg=$('#cardDialog'); $('#modalContent').innerHTML='<p class="muted">Caricamento carta…</p>'; dlg.showModal();
  try{ const r=await fetch(`${API}/${lang}/cards/${encodeURIComponent(id)}`); if(!r.ok)throw new Error(); const card=await r.json(); modalState={type:'catalog',card,lang}; renderCatalogModal(card,lang); }
  catch{ $('#modalContent').innerHTML='<h2>Errore</h2><p class="muted">Impossibile caricare i dettagli della carta.</p>'; }
}

function renderCatalogModal(card,lang){
  const cm=card?.pricing?.cardmarket; const normal=marketValue(card,'normal'); const holo=marketValue(card,'holo');
  const variantOptions=[['normal','Normale'],['holo','Holo'],['reverse','Reverse Holo']].filter(([v])=>card?.variants?.[v]!==false || v==='normal');
  const inWish=wishlist.some(w=>w.id===card.id);
  $('#modalContent').innerHTML=`<div class="modal-grid"><div class="modal-img">${card.image?`<img src="${safe(imageUrl(card.image,'high'))}" alt="${safe(card.name)}">`:''}</div><div>
    <div class="eyebrow">${safe(card.rarity||'CARTA')}</div><h2>${safe(card.name)}</h2><p class="modal-sub">${safe(card.set?.name||'')} · #${safe(card.localId||'')} · ${safe(lang.toUpperCase())}</p>
    <div class="market-box"><div class="market-item"><span>Cardmarket trend</span><strong>${normal?money(normal):'n.d.'}</strong></div><div class="market-item"><span>Trend Holo</span><strong>${holo?money(holo):'n.d.'}</strong></div><div class="market-item"><span>Media 7 gg</span><strong>${cm?.avg7?money(cm.avg7):'n.d.'}</strong></div><div class="market-item"><span>Media 30 gg</span><strong>${cm?.avg30?money(cm.avg30):'n.d.'}</strong></div></div>
    <div class="form-grid">
      <div class="form-field"><label>Quantità</label><input id="fQty" type="number" min="1" value="1"></div>
      <div class="form-field"><label>Condizione</label><select id="fCondition"><option>Near Mint</option><option>Excellent</option><option>Good</option><option>Light Played</option><option>Played</option><option>Poor</option></select></div>
      <div class="form-field"><label>Versione</label><select id="fVariant">${variantOptions.map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select></div>
      <div class="form-field"><label>Prezzo pagato (cad.)</label><input id="fPaid" type="number" min="0" step="0.01" placeholder="0,00"></div>
      <div class="form-field"><label>Grading</label><select id="fAgency"><option value="">Non graduata</option><option>PSA</option><option>BGS</option><option>CGC</option><option>ACE</option><option>Altro</option></select></div>
      <div class="form-field"><label>Voto grading</label><input id="fGrade" inputmode="decimal" placeholder="Es. 9.5"></div>
      <div class="form-field full"><label>Valore personale (facoltativo)</label><input id="fManual" type="number" min="0" step="0.01" placeholder="Se vuoto usa il riferimento Cardmarket"></div>
      <div class="form-field full"><label>Note</label><textarea id="fNotes" rows="2" placeholder="Dove l'hai acquistata, dettagli, difetti…"></textarea></div>
    </div>
    <p class="small-note">La quotazione Cardmarket è un riferimento di mercato e non corregge automaticamente per lingua, condizioni o grading.</p>
    <div class="modal-actions"><button id="addCollectionBtn" class="btn btn-primary" type="button">Aggiungi alla collezione</button><button id="wishBtn" class="btn btn-secondary" type="button">${inWish?'Rimuovi wishlist':'♡ Wishlist'}</button></div>
  </div></div>`;
  $('#fVariant').addEventListener('change',()=>{});
  $('#addCollectionBtn').addEventListener('click',()=>addFromModal(card,lang));
  $('#wishBtn').addEventListener('click',()=>toggleWishlist(card,lang));
}

function addFromModal(card,lang){
  const variant=$('#fVariant').value; const item={uid:uid(),cardId:card.id,name:card.name,localId:card.localId,setName:card.set?.name||'',setId:card.set?.id||'',image:card.image||'',rarity:card.rarity||'',lang,qty:Math.max(1,Number($('#fQty').value)||1),condition:$('#fCondition').value,variant,paidPrice:Number($('#fPaid').value)||0,marketValue:marketValue(card,variant),manualValue:Number($('#fManual').value)||0,gradingAgency:$('#fAgency').value,grade:$('#fGrade').value.trim(),notes:$('#fNotes').value.trim(),addedAt:Date.now(),pricingUpdated:card?.pricing?.cardmarket?.updated||null};
  collection.unshift(item); save(); $('#cardDialog').close(); toast('Carta aggiunta alla collezione'); switchView('collection');
}
function toggleWishlist(card,lang){ const i=wishlist.findIndex(w=>w.id===card.id); if(i>=0){wishlist.splice(i,1);toast('Rimossa dalla wishlist');}else{wishlist.unshift({id:card.id,name:card.name,localId:card.localId,image:card.image||'',lang,addedAt:Date.now()});toast('Aggiunta alla wishlist');} save(); renderCatalogModal(card,lang); }

function openOwned(itemId){ const item=collection.find(x=>x.uid===itemId); if(!item)return; modalState={type:'owned',item}; const dlg=$('#cardDialog'); $('#modalContent').innerHTML=`<div class="modal-grid"><div class="modal-img">${item.image?`<img src="${safe(imageUrl(item.image,'high'))}" alt="${safe(item.name)}">`:''}</div><div><div class="eyebrow">NELLA COLLEZIONE</div><h2>${safe(item.name)}</h2><p class="modal-sub">${safe(item.setName)} · #${safe(item.localId)} · ${safe(item.lang?.toUpperCase()||'')}</p>
    <div class="market-box"><div class="market-item"><span>Riferimento mercato</span><strong>${money(item.marketValue)}</strong></div><div class="market-item"><span>Valore usato nel totale</span><strong>${money(itemValue(item))}</strong></div></div>
    <div class="form-grid"><div class="form-field"><label>Quantità</label><input id="eQty" type="number" min="1" value="${Number(item.qty)||1}"></div><div class="form-field"><label>Condizione</label><select id="eCondition">${['Near Mint','Excellent','Good','Light Played','Played','Poor'].map(x=>`<option ${x===item.condition?'selected':''}>${x}</option>`).join('')}</select></div><div class="form-field"><label>Versione</label><select id="eVariant">${[['normal','Normale'],['holo','Holo'],['reverse','Reverse Holo']].map(([v,n])=>`<option value="${v}" ${v===item.variant?'selected':''}>${n}</option>`).join('')}</select></div><div class="form-field"><label>Prezzo pagato (cad.)</label><input id="ePaid" type="number" min="0" step="0.01" value="${Number(item.paidPrice)||0}"></div><div class="form-field"><label>Grading</label><input id="eAgency" value="${safe(item.gradingAgency||'')}" placeholder="PSA, BGS, CGC…"></div><div class="form-field"><label>Voto</label><input id="eGrade" value="${safe(item.grade||'')}"></div><div class="form-field full"><label>Valore personale (cad.)</label><input id="eManual" type="number" min="0" step="0.01" value="${Number(item.manualValue)||''}" placeholder="Automatico se vuoto"></div><div class="form-field full"><label>Note</label><textarea id="eNotes" rows="2">${safe(item.notes||'')}</textarea></div></div>
    <div class="modal-actions"><button id="saveOwnedBtn" class="btn btn-primary" type="button">Salva modifiche</button><button id="refreshPriceBtn" class="btn btn-secondary" type="button">Aggiorna quotazione</button><button id="deleteOwnedBtn" class="btn btn-danger" type="button">Elimina</button></div></div></div>`; dlg.showModal();
  $('#saveOwnedBtn').addEventListener('click',()=>{ item.qty=Math.max(1,Number($('#eQty').value)||1);item.condition=$('#eCondition').value;item.variant=$('#eVariant').value;item.paidPrice=Number($('#ePaid').value)||0;item.gradingAgency=$('#eAgency').value.trim();item.grade=$('#eGrade').value.trim();item.manualValue=Number($('#eManual').value)||0;item.notes=$('#eNotes').value.trim();save();dlg.close();toast('Modifiche salvate'); });
  $('#deleteOwnedBtn').addEventListener('click',()=>{ if(confirm('Eliminare questa carta dalla collezione?')){collection=collection.filter(x=>x.uid!==item.uid);save();dlg.close();toast('Carta eliminata');} });
  $('#refreshPriceBtn').addEventListener('click',()=>refreshOwnedPrice(item));
}
async function refreshOwnedPrice(item){ try{ const r=await fetch(`${API}/${item.lang||'it'}/cards/${encodeURIComponent(item.cardId)}`);if(!r.ok)throw new Error();const c=await r.json();item.marketValue=marketValue(c,item.variant);item.pricingUpdated=c?.pricing?.cardmarket?.updated||null;save();openOwned(item.uid);toast('Quotazione aggiornata'); }catch{toast('Aggiornamento non riuscito');} }

$('#exportBtn').addEventListener('click',()=>{ const data={app:'PokéCollection',version:1,exportedAt:new Date().toISOString(),collection,wishlist}; const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`pokecollection-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000); });
$('#importInput').addEventListener('change',async e=>{ const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.collection))throw new Error();if(confirm(`Importare ${data.collection.length} elementi? I dati attuali verranno sostituiti.`)){collection=data.collection;wishlist=Array.isArray(data.wishlist)?data.wishlist:[];save();toast('Backup importato');}}catch{alert('File di backup non valido.');}e.target.value=''; });

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installBtn').classList.remove('hidden');$('#installBtn2').classList.remove('hidden');});
async function installApp(){ if(!deferredInstall){toast('Usa il menu del browser → Aggiungi alla schermata Home');return;} deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').classList.add('hidden');$('#installBtn2').classList.add('hidden'); }
$('#installBtn').addEventListener('click',installApp); $('#installBtn2').addEventListener('click',installApp);
window.addEventListener('appinstalled',()=>toast('PokéCollection installata'));

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{})); }

function renderAll(){ renderStats(); renderCollection(); renderWishlist(); }
renderAll();
