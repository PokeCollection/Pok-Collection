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
let guidedStream = null;
let lastScanCanvas = null;
let lastScanHints = null;

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
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
    script.async=true;
    script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('OCR non disponibile'));
    script.onerror=()=>reject(new Error('Impossibile caricare il motore OCR'));
    document.head.appendChild(script);
  });
  return ocrLoadPromise;
}

async function fileToCanvas(file){
  let source,w,h,cleanup=()=>{};
  if('createImageBitmap' in window){
    try{source=await createImageBitmap(file,{imageOrientation:'from-image'});w=source.width;h=source.height;cleanup=()=>source.close?.();}catch{}
  }
  if(!source){
    const url=URL.createObjectURL(file); const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
    source=img;w=img.naturalWidth;h=img.naturalHeight;cleanup=()=>URL.revokeObjectURL(url);
  }
  const maxSide=2200; const scale=Math.min(1,maxSide/Math.max(w,h));
  const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(w*scale)); canvas.height=Math.max(1,Math.round(h*scale));
  const ctx=canvas.getContext('2d',{alpha:false}); ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);cleanup();
  return canvas;
}

function autoCardCrop(canvas){
  // Per foto scelte dalla galleria/fotocamera semplice: privilegia la zona centrale
  // con il rapporto reale di una carta Pokémon (circa 63 x 88 mm).
  const ratio=63/88, w=canvas.width, h=canvas.height;
  let cw=Math.min(w*.68,h*.72*ratio); let ch=cw/ratio;
  if(ch>h*.78){ch=h*.78;cw=ch*ratio;}
  const cx=w*.5, cy=h*.46;
  const sx=Math.max(0,Math.min(w-cw,cx-cw/2));
  const sy=Math.max(0,Math.min(h-ch,cy-ch/2));
  const out=document.createElement('canvas');out.width=Math.max(1,Math.round(cw));out.height=Math.max(1,Math.round(ch));
  out.getContext('2d',{alpha:false}).drawImage(canvas,sx,sy,cw,ch,0,0,out.width,out.height);
  return out;
}

function processedCrop(src,xf,yf,wf,hf,scale=3,binary=false){
  const sx=Math.max(0,Math.round(src.width*xf)),sy=Math.max(0,Math.round(src.height*yf));
  const sw=Math.max(1,Math.min(src.width-sx,Math.round(src.width*wf))),sh=Math.max(1,Math.min(src.height-sy,Math.round(src.height*hf)));
  const maxW=1800; const targetScale=Math.min(scale,maxW/sw);
  const out=document.createElement('canvas');out.width=Math.max(1,Math.round(sw*targetScale));out.height=Math.max(1,Math.round(sh*targetScale));
  const ctx=out.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(src,sx,sy,sw,sh,0,0,out.width,out.height);
  const img=ctx.getImageData(0,0,out.width,out.height);const d=img.data;
  let min=255,max=0;
  for(let i=0;i<d.length;i+=4){const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];if(g<min)min=g;if(g>max)max=g;}
  const range=Math.max(45,max-min);
  for(let i=0;i<d.length;i+=4){let g=.299*d[i]+.587*d[i+1]+.114*d[i+2];g=Math.max(0,Math.min(255,(g-min)*255/range));if(binary)g=g>145?255:0;d[i]=d[i+1]=d[i+2]=g;d[i+3]=255;}
  ctx.putImageData(img,0,0);return out;
}

function normalizeScanText(text=''){
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
}

function cleanPokemonName(text=''){
  const stop=new Set(['BASE','BASIC','FASE','FASE1','FASE2','STAGE','STAGE1','STAGE2','HP','PS','PV','POKEMON','POKÉMON','EVOLVE','EVOLVES','FROM','DA']);
  const lines=String(text).split(/\n+/).map(x=>x.replace(/\b(?:HP|PS|PV)\s*\d+\b/ig,' ').replace(/\b\d{1,3}\b/g,' ').replace(/[^A-Za-zÀ-ÖØ-öø-ÿ.'’\- ]+/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean);
  const candidates=[];
  for(const line of lines){
    const words=line.split(' ').filter(w=>{const n=normalizeScanText(w);return n.length>=2&&!stop.has(n);}).slice(0,4);
    if(words.length){const value=words.join(' '); if(value.length>=3&&value.length<=32)candidates.push(value);}
  }
  candidates.sort((a,b)=>{
    const as=a.split(' ').length<=3?1:0,bs=b.split(' ').length<=3?1:0;
    return bs-as || b.replace(/[^A-Za-z]/g,'').length-a.replace(/[^A-Za-z]/g,'').length;
  });
  return candidates[0]||'';
}

function extractNumberHint(text=''){
  const raw=String(text).replace(/[Oo]/g,'0').replace(/[Il|]/g,'1');
  let m=raw.match(/\b(\d{1,3})\s*[\/]\s*(\d{2,3})\b/);
  if(m)return {number:m[1],total:m[2],fraction:`${m[1]}/${m[2]}`};
  const nums=[...raw.matchAll(/\b(\d{2,3})\b/g)].map(x=>x[1]);
  return {number:nums[0]||'',total:nums[1]||'',fraction:nums.length>1?`${nums[0]}/${nums[1]}`:nums[0]||''};
}

function numberVariants(value=''){
  const v=String(value).trim(); if(!v)return [];
  const out=[v]; if(/^0+\d+$/.test(v)){const n=String(Number(v));if(n&&!out.includes(n))out.push(n);} else if(/^\d{1,2}$/.test(v)){const p=v.padStart(3,'0');if(!out.includes(p))out.push(p);}
  return out;
}

function editDistance(a,b){
  a=normalizeScanText(a).replace(/ /g,'');b=normalizeScanText(b).replace(/ /g,'');
  if(!a.length)return b.length;if(!b.length)return a.length;
  let prev=Array.from({length:b.length+1},(_,i)=>i),cur=[];
  for(let i=1;i<=a.length;i++){cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}
  return prev[b.length];
}
function similarity(a,b){const aa=normalizeScanText(a).replace(/ /g,''),bb=normalizeScanText(b).replace(/ /g,'');const max=Math.max(aa.length,bb.length);return max?1-editDistance(aa,bb)/max:0;}
function numericId(v=''){const m=String(v).match(/\d+/);return m?String(Number(m[0])):'';}

function hintsFromFields(){
  return {name:$('#scanNameHint').value.trim(),number:$('#scanNumberHint').value.trim(),total:$('#scanTotalHint').value.trim(),raw:lastScanHints?.raw||''};
}

function displayScanHints(hints){
  $('#scanNameHint').value=hints.name||'';$('#scanNumberHint').value=hints.number||'';$('#scanTotalHint').value=hints.total||'';
  $('#scanDetectedText').textContent=hints.raw||'Nessun testo OCR utile';$('#scanDetected').classList.remove('hidden');
  if(hints.number)$('#searchInput').value=hints.number;else if(hints.name)$('#searchInput').value=hints.name;
}

function scoreScannedCard(card,hints,detail){
  let score=0;
  const local=String(card.localId||'');
  if(hints.number){
    if(numberVariants(hints.number).includes(local))score+=150;
    else if(numericId(local)===numericId(hints.number))score+=135;
  }
  if(hints.name){
    const sim=similarity(card.name,hints.name);
    if(sim===1)score+=180;else if(sim>=.9)score+=150;else if(sim>=.8)score+=115;else if(sim>=.68)score+=65;
  }
  if(hints.total){
    const totals=[detail?.set?.cardCount?.official,detail?.set?.cardCount?.total,detail?.set?.cardCount].map(Number).filter(Number.isFinite);
    if(totals.includes(Number(hints.total)))score+=100;
  }
  return score;
}

async function findScanCandidates(hints,lang){
  const urls=[];
  numberVariants(hints.number).forEach(n=>urls.push(`${API}/${lang}/cards?localId=${encodeURIComponent(n)}&pagination:page=1&pagination:itemsPerPage=100`));
  if(hints.name){
    urls.push(`${API}/${lang}/cards?name=${encodeURIComponent(hints.name)}&pagination:page=1&pagination:itemsPerPage=100`);
    const first=hints.name.split(/\s+/)[0];if(first.length>=4&&first!==hints.name)urls.push(`${API}/${lang}/cards?name=${encodeURIComponent(first)}&pagination:page=1&pagination:itemsPerPage=100`);
  }
  if(!urls.length)return [];
  const settled=await Promise.allSettled(urls.map(u=>fetch(u).then(r=>{if(!r.ok)throw new Error();return r.json();})));
  const map=new Map();settled.forEach(x=>{if(x.status==='fulfilled'&&Array.isArray(x.value))x.value.forEach(c=>map.set(c.id,c));});
  let prelim=[...map.values()].map(c=>({...c,_quick:scoreScannedCard(c,hints,null)})).sort((a,b)=>b._quick-a._quick).slice(0,24);
  const detailed=await Promise.all(prelim.map(async c=>{let d=null;try{const r=await fetch(`${API}/${lang}/cards/${encodeURIComponent(c.id)}`);if(r.ok)d=await r.json();}catch{}return {...c,setName:d?.set?.name||'',rarity:d?.rarity||'',_score:scoreScannedCard(c,hints,d),_detail:d};}));
  detailed.sort((a,b)=>b._score-a._score);
  const strong=detailed.filter(c=>c._score>=100);
  return (strong.length?strong:detailed.filter(c=>c._score>=55)).slice(0,8);
}

function renderScanCandidates(cards,lang){
  const grid=$('#scanResults');
  if(!cards.length){grid.innerHTML='<div class="scan-empty">Non ho trovato una corrispondenza affidabile. Correggi nome o numero nei campi sopra e premi “Cerca con questi dati”.</div>';return;}
  grid.innerHTML=cards.map((c,i)=>`<article class="result-card" data-card-id="${safe(c.id)}" data-lang="${safe(lang)}"><div class="card-image-wrap">${c.image?`<img loading="lazy" src="${safe(imageUrl(c.image,'low'))}" alt="${safe(c.name)}">`:'🃏'}</div><div class="card-info"><h3>${safe(c.name)}</h3><p>${safe(c.setName||'')} · #${safe(c.localId||'')}</p><span class="${c._score>=250?'scan-confidence':'scan-match-note'}">${i===0&&c._score>=250?'Alta probabilità':i===0?'Corrispondenza più probabile':'Possibile corrispondenza'}</span><div class="price-line"><span class="tag">Conferma</span></div></div></article>`).join('');
  grid.querySelectorAll('[data-card-id]').forEach(el=>el.addEventListener('click',()=>openCardById(el.dataset.cardId,el.dataset.lang)));
}

async function recognizeCardCanvas(cardCanvas){
  lastScanCanvas=cardCanvas;
  $('#scanDetected').classList.add('hidden');$('#scanResults').innerHTML='';
  setScanProgress(8,'Preparazione delle zone utili della carta…');
  let worker;
  try{
    await loadTesseract();
    worker=await Tesseract.createWorker('eng',1,{logger:m=>{if(m.status==='recognizing text'&&Number.isFinite(m.progress))setScanProgress(18+m.progress*48,'Lettura di nome e numero…');}});
    const nameCanvas=processedCrop(cardCanvas,.035,.025,.77,.16,3.4,false);
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .'-",preserve_interword_spaces:'1'});
    const nameRes=await worker.recognize(nameCanvas);
    setScanProgress(58,'Lettura precisa del numero carta…');
    const numberCanvas=processedCrop(cardCanvas,.015,.82,.72,.17,4.2,true);
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789/',preserve_interword_spaces:'1'});
    const numberRes=await worker.recognize(numberCanvas);
    let name=cleanPokemonName(nameRes?.data?.text||'');
    let num=extractNumberHint(numberRes?.data?.text||'');
    let fallbackText='';
    if(!name||!num.number){
      setScanProgress(68,'Secondo controllo della carta…');
      const fallback=processedCrop(cardCanvas,.02,.0,.96,.98,1.7,false);
      await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:'',preserve_interword_spaces:'1'});
      const fr=await worker.recognize(fallback);fallbackText=fr?.data?.text||'';
      if(!name)name=cleanPokemonName((fr?.data?.text||'').split(/\n/).slice(0,5).join('\n'));
      if(!num.number)num=extractNumberHint(fr?.data?.text||'');
    }
    const raw=[nameRes?.data?.text,numberRes?.data?.text,fallbackText].filter(Boolean).join('\n---\n').trim();
    lastScanHints={name,number:num.number,total:num.total,raw};displayScanHints(lastScanHints);
    setScanProgress(78,'Confronto con numero, nome e set…');
    const lang=$('#searchLang').value;const matches=await findScanCandidates(lastScanHints,lang);renderScanCandidates(matches,lang);
    setScanProgress(100,matches.length?`Trovate ${matches.length} corrispondenze ordinate per affidabilità.`:'Rilevazione incerta: correggi nome o numero e riprova.');
  }catch(err){
    console.error(err);setScanProgress(100,'Riconoscimento non riuscito. Prova con la fotocamera guidata o inserisci nome e numero.');
    $('#scanResults').innerHTML='<div class="scan-empty">Scansione non riuscita. Puoi correggere i dati o usare la ricerca manuale.</div>';
  }finally{try{await worker?.terminate();}catch{}}
}

async function scanCardFile(file){
  if(!file)return;if(!file.type.startsWith('image/')){toast('Seleziona una foto della carta');return;}
  if(scanPreviewUrl)URL.revokeObjectURL(scanPreviewUrl);scanPreviewUrl=URL.createObjectURL(file);$('#scanPreview').src=scanPreviewUrl;$('#scanPreviewWrap').classList.remove('hidden');
  setScanProgress(3,'Preparazione della foto…');
  try{const full=await fileToCanvas(file);const card=autoCardCrop(full);await recognizeCardCanvas(card);}catch(err){console.error(err);setScanProgress(100,'Non riesco a leggere questa immagine.');}
}

async function startGuidedCamera(){
  if(!navigator.mediaDevices?.getUserMedia){toast('Fotocamera guidata non supportata: usa “Foto semplice”');return;}
  try{
    guidedStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    const video=$('#scanVideo');video.srcObject=guidedStream;await video.play();$('#scannerCameraDialog').showModal();
  }catch(err){console.error(err);toast('Permesso fotocamera non disponibile');}
}
function stopGuidedCamera(){try{guidedStream?.getTracks().forEach(t=>t.stop());}catch{}guidedStream=null;$('#scanVideo').srcObject=null;if($('#scannerCameraDialog').open)$('#scannerCameraDialog').close();}

function captureGuideCanvas(){
  const video=$('#scanVideo'),stage=$('#cameraStage'),guide=$('#cardGuide');
  const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh)throw new Error('Video non pronto');
  const sr=stage.getBoundingClientRect(),gr=guide.getBoundingClientRect();
  const scale=Math.min(sr.width/vw,sr.height/vh),dw=vw*scale,dh=vh*scale,ox=(sr.width-dw)/2,oy=(sr.height-dh)/2;
  let sx=(gr.left-sr.left-ox)/scale,sy=(gr.top-sr.top-oy)/scale,sw=gr.width/scale,sh=gr.height/scale;
  sx=Math.max(0,sx);sy=Math.max(0,sy);sw=Math.min(vw-sx,sw);sh=Math.min(vh-sy,sh);
  const out=document.createElement('canvas');out.width=Math.max(1,Math.round(sw));out.height=Math.max(1,Math.round(sh));out.getContext('2d',{alpha:false}).drawImage(video,sx,sy,sw,sh,0,0,out.width,out.height);return out;
}

$('#openGuidedCamera').addEventListener('click',startGuidedCamera);
$('#closeGuidedCamera').addEventListener('click',stopGuidedCamera);
$('#scannerCameraDialog').addEventListener('cancel',e=>{e.preventDefault();stopGuidedCamera();});
$('#captureGuidedCard').addEventListener('click',async()=>{
  try{
    const card=captureGuideCanvas();stopGuidedCamera();
    const url=card.toDataURL('image/jpeg',.92);$('#scanPreview').src=url;$('#scanPreviewWrap').classList.remove('hidden');
    await recognizeCardCanvas(card);
  }catch(err){console.error(err);toast('Non riesco a catturare la carta');}
});
['scanCamera','scanGallery'].forEach(id=>$('#'+id).addEventListener('change',e=>{const f=e.target.files?.[0];scanCardFile(f);e.target.value='';}));
$('#homeScanBtn').addEventListener('click',()=>{switchView('search');setTimeout(startGuidedCamera,150);});
$('#scanRefineBtn').addEventListener('click',async()=>{
  const hints=hintsFromFields();lastScanHints={...hints,raw:lastScanHints?.raw||''};
  if(!hints.name&&!hints.number){toast('Inserisci almeno nome o numero');return;}
  setScanProgress(82,'Ricerca con i dati corretti…');const matches=await findScanCandidates(hints,$('#searchLang').value);renderScanCandidates(matches,$('#searchLang').value);setScanProgress(100,matches.length?`Trovate ${matches.length} corrispondenze.`:'Nessuna corrispondenza: controlla nome e numero.');
});

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
