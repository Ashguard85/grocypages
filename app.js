'use strict';

const APP_VERSION = 'v5';
const BACKUP_FORMAT = 'grocy-article-pwa-backup';
const DB_NAME = 'grocy-article-pwa';
const DB_VERSION = 1;
const state = { mode: localStorage.getItem('mode') || 'local', products: [], stock: [], shopping: [], locations: [], units: [], journal: [], stockFilter: 'all', shoppingTab: 'open', waitingWorker: null };

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const n = v => Number(v || 0);
const fmt = v => Number(v || 0).toLocaleString('de-DE',{maximumFractionDigits:3});
const today = () => new Date().toISOString().slice(0,10);

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)}
function normalizeUrl(u){return String(u||'').trim().replace(/\/+$/,'').replace(/\/api$/,'')}

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;['config','products','stock','shopping','locations','units','journal'].forEach(s=>{if(!db.objectStoreNames.contains(s)) db.createObjectStore(s,{keyPath:'id'})})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function dbGetAll(store){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readonly');const r=tx.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbGet(store,id){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(store,'readonly').objectStore(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbPut(store,obj){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(obj);tx.oncomplete=()=>res(obj);tx.onerror=()=>rej(tx.error)})}
async function dbDelete(store,id){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
async function dbClear(store){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}

class LocalProvider {
  async init(){
    const products=await dbGetAll('products');
    if(!products.length){
      const seed=[
        {id:1,name:'Milch 1,5 %',location_id:1,qu_id_stock:1,min_stock_amount:2,barcode:'',active:1},
        {id:2,name:'Brot Vollkorn',location_id:2,qu_id_stock:1,min_stock_amount:1,barcode:'',active:1},
        {id:3,name:'Spaghetti',location_id:2,qu_id_stock:2,min_stock_amount:2,barcode:'',active:1}
      ];
      for(const p of seed) await dbPut('products',p);
      await dbPut('locations',{id:1,name:'Kühlschrank'});await dbPut('locations',{id:2,name:'Vorrat'});
      await dbPut('units',{id:1,name:'Stück',name_plural:'Stück'});await dbPut('units',{id:2,name:'Packung',name_plural:'Packungen'});
      await dbPut('stock',{id:1,product_id:1,amount:3,best_before_date:''});await dbPut('stock',{id:2,product_id:2,amount:2,best_before_date:''});await dbPut('stock',{id:3,product_id:3,amount:5,best_before_date:''});
    }
  }
  async info(){return {grocy_version:{Version:'Lokaler Modus'}}}
  async products(){return dbGetAll('products')}
  async stock(){const ps=await this.products(), ss=await dbGetAll('stock'), loc=await dbGetAll('locations'), us=await dbGetAll('units');return ps.map(p=>{const s=ss.find(x=>x.product_id===p.id)||{amount:0};return {product_id:p.id,product:p,amount:s.amount||0,amount_opened:s.amount_opened||0,best_before_date:s.best_before_date||'',location_name:(loc.find(x=>x.id===p.location_id)||{}).name||'',quantity_unit_stock:(us.find(x=>x.id===p.qu_id_stock)||{}).name||''}})}
  async shopping(){return dbGetAll('shopping')}
  async locations(){return dbGetAll('locations')}
  async units(){return dbGetAll('units')}
  async journal(){return (await dbGetAll('journal')).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,20)}
  async resolveProduct(q){const ps=await this.products(); const s=String(q).trim().toLowerCase(); return ps.find(p=>String(p.id)===s || p.name.toLowerCase()===s || String(p.barcode||'')===s) || ps.find(p=>p.name.toLowerCase().includes(s))}
  async add(productId, amount, extra={}){return this._adjust(productId, n(amount), 'purchase', extra)}
  async consume(productId, amount, spoiled=false){return this._adjust(productId, -Math.abs(n(amount)), spoiled?'consume-spoiled':'consume')}
  async open(productId, amount){const s=await dbGet('stock',productId)||{id:productId,product_id:productId,amount:0};s.amount_opened=n(s.amount_opened)+n(amount);await dbPut('stock',s);await this._log(productId,n(amount),'product-opened');return s}
  async inventory(productId, newAmount){const s=await dbGet('stock',productId)||{id:productId,product_id:productId,amount:0};const diff=n(newAmount)-n(s.amount);s.amount=n(newAmount);await dbPut('stock',s);await this._log(productId,diff,'inventory-correction');return s}
  async transfer(productId, amount, locationId){const p=await dbGet('products',productId);p.location_id=n(locationId);await dbPut('products',p);await this._log(productId,n(amount),'transfer');return p}
  async _adjust(productId,diff,type,extra={}){const s=await dbGet('stock',productId)||{id:productId,product_id:productId,amount:0};s.amount=Math.max(0,n(s.amount)+diff);if(extra.best_before_date)s.best_before_date=extra.best_before_date;await dbPut('stock',s);await this._log(productId,diff,type);return s}
  async _log(productId,amount,type){await dbPut('journal',{id:crypto.randomUUID(),product_id:productId,amount,type,created_at:new Date().toISOString()})}
  async addShopping(productId,amount=1){const items=await dbGetAll('shopping');let it=items.find(x=>x.product_id===productId&&x.done!==1);if(it){it.amount=n(it.amount)+n(amount)}else{it={id:Date.now(),product_id:productId,amount:n(amount),done:0,note:''}}await dbPut('shopping',it);return it}
  async updateShopping(id,data){const it=await dbGet('shopping',id);Object.assign(it,data);await dbPut('shopping',it);return it}
  async deleteShopping(id){return dbDelete('shopping',id)}
  async createProduct(data){const ps=await this.products();const id=Math.max(0,...ps.map(x=>n(x.id)))+1;const p={id,active:1,...data};await dbPut('products',p);await dbPut('stock',{id,product_id:id,amount:0});return p}
  async updateProduct(id,data){const p=await dbGet('products',id);Object.assign(p,data);await dbPut('products',p);return p}
  async deleteProduct(id){await dbDelete('products',id);await dbDelete('stock',id)}
  async raw(path,method='GET',body){throw new Error('API-Test ist nur im Server-Modus verfügbar.')}
}

class GrocyProvider {
  async cfg(){return (await dbGet('config','server'))||{id:'server'}}
  async request(path,method='GET',body=null,overrideConfig=null){
    const c=overrideConfig||await this.cfg();
    if(!c.baseUrl||!c.apiKey) throw new Error('Server-URL und Grocy API-Key fehlen.');
    const url=`${normalizeUrl(c.baseUrl)}/api${path}`;
    const headers={'Accept':'application/json','GROCY-API-KEY':c.apiKey};
    if(body!==null) headers['Content-Type']='application/json';
    if(c.cfClientId) headers['CF-Access-Client-Id']=c.cfClientId;
    if(c.cfClientSecret) headers['CF-Access-Client-Secret']=c.cfClientSecret;
    let r;
    try{r=await fetch(url,{method,headers,body:body===null?undefined:JSON.stringify(body),cache:'no-store',credentials:'omit'})}
    catch(e){throw new Error('Netzwerk/CORS-Fehler: Browser blockiert die Anfrage oder der Server ist nicht erreichbar. Bei Cloudflare Access ist häufig der OPTIONS-Preflight nicht erlaubt.')}
    const txt=await r.text(); let data=null; if(txt){try{data=JSON.parse(txt)}catch{data=txt}}
    if(!r.ok){
      const html=typeof data==='string' && /<html|cloudflare|access/i.test(data);
      let msg=data?.error_message||data?.message||`HTTP ${r.status}`;
      if(r.status===401) msg='Grocy API-Key wurde abgelehnt (HTTP 401).';
      if(r.status===403 && html) msg='Cloudflare Access hat die Anfrage abgelehnt (HTTP 403). Prüfe Service-Auth-Policy und Service Token.';
      else if(r.status===403) msg=`Zugriff verweigert (HTTP 403): ${msg}`;
      throw new Error(msg);
    }
    if(typeof data==='string' && /<html|cloudflare access/i.test(data)) throw new Error('Statt Grocy-JSON kam eine HTML-Seite zurück. Wahrscheinlich greift Cloudflare Access/Login statt Service Auth.');
    return data;
  }
  info(config=null){return this.request('/system/info','GET',null,config)}
  products(){return this.request('/objects/products?order=name:asc')}
  stock(){return this.request('/stock')}
  shopping(){return this.request('/objects/shopping_list?order=id:asc')}
  locations(){return this.request('/objects/locations?order=name:asc')}
  units(){return this.request('/objects/quantity_units?order=name:asc')}
  async journal(){try{return await this.request('/objects/stock_log?order=row_created_timestamp:desc&limit=20')}catch{return []}}
  async resolveProduct(q){const x=String(q).trim();if(/^\d+$/.test(x)){try{const b=await this.request(`/stock/products/by-barcode/${encodeURIComponent(x)}`);if(b?.product)return b.product}catch{}}const ps=state.products.length?state.products:await this.products();return ps.find(p=>String(p.id)===x)||ps.find(p=>String(p.name||'').toLowerCase()===x.toLowerCase())||ps.find(p=>String(p.name||'').toLowerCase().includes(x.toLowerCase()))}
  add(id,amount,extra={}){const body={amount:n(amount),transaction_type:'purchase'};if(extra.price!==''&&extra.price!==undefined)body.price=n(extra.price);if(extra.best_before_date)body.best_before_date=extra.best_before_date;if(extra.location_id)body.location_id=n(extra.location_id);if(extra.shopping_location_id)body.shopping_location_id=n(extra.shopping_location_id);return this.request(`/stock/products/${id}/add`,'POST',body)}
  consume(id,amount,spoiled=false){return this.request(`/stock/products/${id}/consume`,'POST',{amount:n(amount),spoiled:!!spoiled,transaction_type:'consume'})}
  open(id,amount){return this.request(`/stock/products/${id}/open`,'POST',{amount:n(amount)})}
  inventory(id,newAmount){return this.request(`/stock/products/${id}/inventory`,'POST',{new_amount:n(newAmount)})}
  transfer(id,amount,locationFrom,locationTo){return this.request(`/stock/products/${id}/transfer`,'POST',{amount:n(amount),location_id_from:n(locationFrom),location_id_to:n(locationTo)})}
  addShopping(id,amount=1){return this.request('/stock/shoppinglist/add-product','POST',{product_id:n(id),product_amount:n(amount),list_id:1})}
  updateShopping(id,data){return this.request(`/objects/shopping_list/${id}`,'PUT',data)}
  removeShoppingProduct(productId,amount,listId=1){return this.request('/stock/shoppinglist/remove-product','POST',{product_id:n(productId),product_amount:n(amount),list_id:n(listId)||1})}
  deleteShopping(id){return this.request(`/objects/shopping_list/${id}`,'DELETE')}
  createProduct(data){return this.request('/objects/products','POST',data)}
  updateProduct(id,data){return this.request(`/objects/products/${id}`,'PUT',data)}
  deleteProduct(id){return this.request(`/objects/products/${id}`,'DELETE')}
  raw(path,method='GET',body){let p=String(path||'').trim();if(!p.startsWith('/'))p='/'+p;if(p.startsWith('/api/'))p=p.slice(4);return this.request(p,method,body)}
}

let provider;
function setProvider(){provider=state.mode==='server'?new GrocyProvider():new LocalProvider();$('#modeBadge').textContent=state.mode==='server'?'Server':'Lokal'}

async function refreshAll(){
  try{
    setProvider(); if(provider.init) await provider.init();
    [state.products,state.stock,state.shopping,state.locations,state.units,state.journal]=await Promise.all([provider.products(),provider.stock(),provider.shopping(),provider.locations(),provider.units(),provider.journal()]);
    fillProducts();renderStock();renderShopping();renderInventory();renderJournal();
  }catch(e){toast(e.message); renderError(e.message)}
}
function renderError(msg){const active=$('.view.active .card-list');if(active) active.innerHTML=`<div class="error-box">${esc(msg)}</div>`}
function productById(id){return state.products.find(p=>n(p.id)===n(id))}
function stockProduct(row){return row.product||productById(row.product_id)||{id:row.product_id,name:`Artikel ${row.product_id}`}}
function unitFor(p){const u=state.units.find(x=>n(x.id)===n(p.qu_id_stock));return u?.name||u?.name_plural||''}
function locationFor(p,row){return row?.location_name||state.locations.find(x=>n(x.id)===n(p.location_id))?.name||''}
function fillProducts(){$('#productOptions').innerHTML=state.products.map(p=>`<option value="${esc(p.name)}"></option>`).join('')}

function renderStock(){
  const q=$('#stockSearch').value.trim().toLowerCase(); const now=today();
  let rows=state.products.filter(p=>n(p.active)!==0).map(p=>state.stock.find(r=>n(r.product_id)===n(p.id))||{product_id:p.id,product:p,amount:0,amount_opened:0,best_before_date:''}).filter(r=>{const p=stockProduct(r);return !q||p.name.toLowerCase().includes(q)||String(p.id)===q});
  if(state.stockFilter==='low')rows=rows.filter(r=>n(r.amount)<n(stockProduct(r).min_stock_amount));
  if(state.stockFilter==='due')rows=rows.filter(r=>r.best_before_date&&r.best_before_date<=now);
  rows.sort((a,b)=>stockProduct(a).name.localeCompare(stockProduct(b).name,'de'));
  $('#stockList').innerHTML=rows.length?rows.map(r=>{const p=stockProduct(r),amt=n(r.amount),min=n(p.min_stock_amount),cls=amt===0&&min>0?'critical':amt<min?'low':(r.best_before_date&&r.best_before_date<=now?'due':'');return `<button class="card product-card ${cls}" data-product-id="${p.id}" style="text-align:left;width:100%"><div class="product-icon">${iconFor(p.name)}</div><div><div class="product-title">${esc(p.name)}</div><div class="product-sub">${esc(locationFor(p,r))}${r.best_before_date?` · MHD ${esc(r.best_before_date)}`:''}</div></div><div class="qty">${fmt(amt)} ${esc(r.quantity_unit_stock||unitFor(p))}<small>${min?`Min. ${fmt(min)}`:''}</small></div></button>`}).join(''):'<div class="panel muted">Keine passenden Artikel.</div>';
}
function iconFor(name){const x=name.toLowerCase();if(x.includes('milch'))return '🥛';if(x.includes('brot'))return '🍞';if(x.includes('nudel')||x.includes('spaghetti'))return '🍝';if(x.includes('kaffee'))return '☕';if(x.includes('ei'))return '🥚';if(x.includes('apfel'))return '🍎';return '📦'}

function renderShopping(){
  const q=$('#shoppingSearch').value.trim().toLowerCase(); let items=state.mode==='server'?(state.shoppingTab==='done'?[]:state.shopping):state.shopping.filter(i=>state.shoppingTab==='done'?n(i.done)===1:n(i.done)!==1);
  if(q)items=items.filter(i=>(productById(i.product_id)?.name||i.note||'').toLowerCase().includes(q));
  $('#shoppingList').innerHTML=items.length?items.map(i=>{const p=productById(i.product_id)||{name:i.note||'Freier Eintrag'};return `<div class="card shopping-card"><input type="checkbox" data-shop-check="${i.id}" ${n(i.done)===1?'checked':''}><div><div class="product-title">${esc(p.name)}</div><div class="product-sub">${esc(i.note||'')}</div></div><div class="qty-stepper"><button data-shop-minus="${i.id}">−</button><input data-shop-amount="${i.id}" type="number" value="${fmt(i.amount)}" step="0.1"><button data-shop-plus="${i.id}">+</button></div></div>`}).join(''):'<div class="panel muted">Einkaufsliste ist leer.</div>';
}
function renderInventory(){
  const rows=state.products.filter(p=>n(p.active)!==0).map(p=>state.stock.find(r=>n(r.product_id)===n(p.id))||{product_id:p.id,product:p,amount:0});
  $('#inventoryList').innerHTML=rows.map(r=>{const p=stockProduct(r);return `<div class="card inventory-card"><div><div class="product-title">${esc(p.name)}</div><div class="product-sub">Erfasst: ${fmt(r.amount)} ${esc(r.quantity_unit_stock||unitFor(p))}</div></div><input data-inventory-id="${p.id}" type="number" step="0.001" value="${fmt(r.amount)}" aria-label="Gezählter Bestand ${esc(p.name)}"></div>`}).join('')
}
function renderJournal(){
  $('#journalList').innerHTML=state.journal.length?state.journal.map(j=>{const p=productById(j.product_id)||{name:j.product_name||'Artikel'};const type=j.transaction_type||j.type||'';const amount=j.amount??j.amount_aggregated??'';return `<div class="card"><div class="product-title">${esc(p.name)}</div><div class="product-sub">${esc(type)} · ${fmt(amount)} · ${esc(j.row_created_timestamp||j.created_at||'')}</div></div>`}).join(''):'<div class="panel muted">Keine Journal-Daten verfügbar.</div>'
}

async function selectProduct(id){const r=state.stock.find(x=>n(x.product_id)===n(id))||{},p=productById(id)||stockProduct(r);showSheet('Artikel',`<div class="form-stack"><div class="panel"><div class="product-title">${esc(p.name)}</div><div class="product-sub">Bestand ${fmt(r.amount)} ${esc(r.quantity_unit_stock||unitFor(p))}</div></div><button type="button" class="primary-button" data-action="purchase" data-id="${id}">Einkauf buchen</button><button type="button" class="secondary-button" data-action="consume" data-id="${id}">Verbrauchen / Öffnen</button><button type="button" class="secondary-button" data-action="shopping" data-id="${id}">Auf Einkaufsliste</button><button type="button" class="secondary-button" data-action="edit" data-id="${id}">Artikel bearbeiten</button></div>`)}

function showSheet(title,html){$('#sheetTitle').textContent=title;$('#sheetBody').innerHTML=html;$('#sheet').showModal()}
function productSelect(name='product'){return `<label>Artikel<input name="${name}" list="productOptions" required placeholder="Artikelname oder Barcode"></label>`}
function locationSelect(name='location_id'){return `<label>Ort<select name="${name}">${state.locations.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>`}

function openPurchase(prefill=''){showSheet('Einkauf buchen',`<div class="form-stack">${productSelect()}<div class="two-col"><label>Menge<input name="amount" type="number" min="0.001" step="0.001" value="1"></label><label>Preis<input name="price" type="number" min="0" step="0.01" value="0"></label></div><label>MHD<input name="best_before_date" type="date" value="${today()}"></label>${locationSelect()}<button type="button" class="primary-button" id="doPurchase">Einlagern</button></div>`);if(prefill)$('[name=product]',$('#sheetBody')).value=prefill}
function openTransfer(){showSheet('Umlagern',`<div class="form-stack">${productSelect()}<label>Menge<input name="amount" type="number" min="0.001" step="0.001" value="1"></label>${locationSelect('location_from')}${locationSelect('location_to')}<button type="button" class="primary-button" id="doTransfer">Umlagern</button></div>`);const sels=$$('#sheetBody label');if(sels[2])sels[2].childNodes[0].textContent='Von ';if(sels[3])sels[3].childNodes[0].textContent='Nach '}
function openProduct(){showSheet('Artikel verwalten',`<div class="form-stack"><label>Vorhandener Artikel<select id="editProductSelect"><option value="">Neuer Artikel</option>${state.products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label>Name<input id="editName"></label><div class="two-col"><label>Mindestbestand<input id="editMin" type="number" step="0.001" value="0"></label><label>Barcode<input id="editBarcode" inputmode="numeric"></label></div>${locationSelect('edit_location')}<label>Bestandseinheit<select id="editUnit">${state.units.map(u=>`<option value="${u.id}">${esc(u.name||u.name_plural)}</option>`).join('')}</select></label><button type="button" class="primary-button" id="saveProduct">Speichern</button><button type="button" class="danger-button" id="deleteProduct" hidden>Artikel löschen</button></div>`)}
function openSettings(){showSheet('Setup',`<div class="form-stack"><label>Betriebsmodus<select id="modeSelect"><option value="local" ${state.mode==='local'?'selected':''}>Lokal – IndexedDB</option><option value="server" ${state.mode==='server'?'selected':''}>Server – Grocy API</option></select></label><div id="serverSettings"><label>Grocy URL<input id="serverUrl" type="url" inputmode="url" autocapitalize="none" placeholder="https://grocy.example.com"></label><div class="muted">Basis-URL eintragen; ein angehängtes /api wird automatisch entfernt.</div><label>Grocy API-Key<input id="apiKey" type="password" autocomplete="off" autocapitalize="none"></label><details open><summary>Cloudflare Access Service Token</summary><div class="form-stack details-stack"><label>Client ID<input id="cfId" autocomplete="off" autocapitalize="none"></label><label>Client Secret<input id="cfSecret" type="password" autocomplete="off" autocapitalize="none"></label><div class="muted">Access braucht eine Service-Auth-Policy für dieses Token. Cross-Origin OPTIONS-Preflight muss ebenfalls erlaubt sein.</div></div></details><button type="button" class="secondary-button" id="testServer">Verbindung vollständig prüfen</button><div id="connectionResult" class="panel compact muted">Noch nicht geprüft.</div></div><button type="button" class="primary-button" id="saveSettings">Speichern</button><button type="button" class="danger-button" id="clearSecrets">Zugangsdaten löschen</button><div class="muted">Version ${APP_VERSION}. Secrets bleiben ausschließlich in IndexedDB dieses Browsers und werden nicht exportiert.</div></div>`);loadSettingsForm()}
async function loadSettingsForm(){const c=(await dbGet('config','server'))||{};$('#serverUrl').value=c.baseUrl||'';$('#apiKey').value=c.apiKey||'';$('#cfId').value=c.cfClientId||'';$('#cfSecret').value=c.cfClientSecret||'';$('#serverSettings').hidden=$('#modeSelect').value!=='server'}
function openBackup(){showSheet('Backup & Restore',`<div class="form-stack"><button type="button" class="primary-button" id="exportBackup">Backup exportieren</button><label>Backup importieren<input id="backupFile" type="file" accept="application/json,.json"></label><button type="button" class="secondary-button" id="importBackup">Backup prüfen & importieren</button><div class="muted">Im Server-Modus exportiert dieses PWA-Backup nur lokale PWA-Einstellungen ohne API-Keys. Grocy-Serverdaten werden nicht kopiert.</div></div>`)}
function openApi(){showSheet('API-Test',`<div class="form-stack"><label>Pfad<input id="rawPath" value="/system/info"></label><label>Methode<select id="rawMethod"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label><label>JSON Body<textarea id="rawBody" rows="5" placeholder='{"amount":1}'></textarea></label><button type="button" class="primary-button" id="rawSend">Senden</button><pre id="rawResult" class="raw-result"></pre></div>`)}

async function exportBackup(){const data={format:BACKUP_FORMAT,version:1,created_at:new Date().toISOString(),mode:state.mode,data:{}};if(state.mode==='local'){for(const s of ['products','stock','shopping','locations','units','journal'])data.data[s]=await dbGetAll(s)}data.data.preferences={mode:state.mode};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const file=new File([blob],`grocy-pwa-backup-${today()}.json`,{type:'application/json'});if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Grocy PWA Backup'}).catch(()=>{})}else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}}
async function importBackup(){const f=$('#backupFile').files[0];if(!f)throw new Error('Backup-Datei auswählen.');const data=JSON.parse(await f.text());if(data.format!==BACKUP_FORMAT||data.version!==1)throw new Error('Unbekanntes Backup-Format.');if(!confirm(`Backup vom ${data.created_at||'unbekannt'} importieren? Bestehende lokale Daten werden ersetzt.`))return;for(const s of ['products','stock','shopping','locations','units','journal']){await dbClear(s);for(const row of data.data?.[s]||[])await dbPut(s,row)}state.mode='local';localStorage.setItem('mode','local');$('#sheet').close();await refreshAll();toast('Backup importiert')}

async function saveSettings(){const mode=$('#modeSelect').value;const c={id:'server',baseUrl:normalizeUrl($('#serverUrl').value),apiKey:$('#apiKey').value.trim(),cfClientId:$('#cfId').value.trim(),cfClientSecret:$('#cfSecret').value.trim()};if(mode==='server'&&(!c.baseUrl||!c.apiKey))throw new Error('Für Server-Modus sind Grocy URL und API-Key erforderlich.');await dbPut('config',c);state.mode=mode;localStorage.setItem('mode',mode);$('#sheet').close();await refreshAll();toast('Setup gespeichert')}
async function testServer(){const c={id:'server',baseUrl:normalizeUrl($('#serverUrl').value),apiKey:$('#apiKey').value.trim(),cfClientId:$('#cfId').value.trim(),cfClientSecret:$('#cfSecret').value.trim()};const out=$('#connectionResult');if(!c.baseUrl||!c.apiKey){out.textContent='❌ Grocy URL und API-Key sind erforderlich.';return}if(!/^https:\/\//i.test(c.baseUrl)){out.textContent='❌ Für GitHub Pages muss die Grocy URL mit https:// beginnen.';return}out.textContent='Prüfe /api/system/info …';try{const p=new GrocyProvider();const info=await p.info(c);out.innerHTML=`✅ Verbindung funktioniert.<br>Grocy ${esc(info?.grocy_version?.Version||'erreichbar')}<br><small>${esc(c.baseUrl)}/api/system/info</small>`;toast('Grocy-Verbindung funktioniert')}catch(e){let hint='';if(/CORS|Preflight|Netzwerk/i.test(e.message))hint='<br><br><strong>Cloudflare:</strong> Access → Anwendung → Advanced settings → CORS. OPTIONS zum Origin durchlassen oder Preflight in Access beantworten. Erlaubte Header: GROCY-API-KEY, Content-Type, CF-Access-Client-Id, CF-Access-Client-Secret.';else if(/Cloudflare|403/i.test(e.message))hint='<br><br><strong>Cloudflare:</strong> Die Access-Anwendung braucht eine Service-Auth-Policy, die dieses Service Token einschließt.';else if(/401|API-Key/i.test(e.message))hint='<br><br><strong>Grocy:</strong> API-Key neu kopieren und ohne Leerzeichen einsetzen.';out.innerHTML=`❌ ${esc(e.message)}${hint}`}}

function nav(view){$$('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));$$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===view));const titles={stock:'Artikel',shopping:'Einkauf',consume:'Verbrauch',inventory:'Inventur',more:'Mehr'};$('#viewTitle').textContent=titles[view];localStorage.setItem('lastView',view);if(view==='inventory')renderInventory()}

async function handleSheetClick(e){
  const a=e.target.closest('[data-action]');if(a){const id=n(a.dataset.id),p=productById(id);if(a.dataset.action==='purchase'){openPurchase(p.name)}if(a.dataset.action==='consume'){$('#sheet').close();nav('consume');$('#consumeProduct').value=p.name}if(a.dataset.action==='shopping'){await provider.addShopping(id,1);$('#sheet').close();await refreshAll();toast('Zur Einkaufsliste hinzugefügt')}if(a.dataset.action==='edit'){openProduct();setTimeout(()=>{$('#editProductSelect').value=id;$('#editProductSelect').dispatchEvent(new Event('change'))},0)}return}
  if(e.target.id==='doPurchase'){const root=$('#sheetBody'),p=await provider.resolveProduct($('[name=product]',root).value);if(!p)throw new Error('Artikel nicht gefunden.');await provider.add(p.id,$('[name=amount]',root).value,{price:$('[name=price]',root).value,best_before_date:$('[name=best_before_date]',root).value,location_id:$('[name=location_id]',root).value});$('#sheet').close();await refreshAll();toast('Einkauf gebucht')}
  if(e.target.id==='doTransfer'){const root=$('#sheetBody'),p=await provider.resolveProduct($('[name=product]',root).value);if(!p)throw new Error('Artikel nicht gefunden.');await provider.transfer(p.id,$('[name=amount]',root).value,$('[name=location_from]',root).value,$('[name=location_to]',root).value);$('#sheet').close();await refreshAll();toast('Umlagerung gebucht')}
  if(e.target.id==='saveProduct'){const id=n($('#editProductSelect').value),data={name:$('#editName').value.trim(),min_stock_amount:n($('#editMin').value),location_id:n($('#edit_location').value),qu_id_stock:n($('#editUnit').value),active:1,default_best_before_days:0,qu_factor_purchase_to_stock:1};if(!data.name)throw new Error('Name fehlt.');if(state.mode==='local')data.barcode=$('#editBarcode').value.trim();if(id)await provider.updateProduct(id,data);else{if(state.mode==='server'){data.qu_id_purchase=data.qu_id_stock;data.qu_id_consume=data.qu_id_stock}else data.barcode=$('#editBarcode').value.trim();const r=await provider.createProduct(data);if(state.mode==='server'&&$('#editBarcode').value.trim()&&r?.created_object_id)await provider.raw('/objects/product_barcodes','POST',{product_id:r.created_object_id,barcode:$('#editBarcode').value.trim(),qu_id:data.qu_id_stock,amount:1})}$('#sheet').close();await refreshAll();toast('Artikel gespeichert')}
  if(e.target.id==='deleteProduct'){const id=n($('#editProductSelect').value);if(id&&confirm('Artikel wirklich löschen?')){await provider.deleteProduct(id);$('#sheet').close();await refreshAll();toast('Artikel gelöscht')}}
  if(e.target.id==='saveSettings')await saveSettings();if(e.target.id==='testServer')await testServer();if(e.target.id==='clearSecrets'){await dbPut('config',{id:'server'});await loadSettingsForm();toast('Zugangsdaten gelöscht')}
  if(e.target.id==='exportBackup')await exportBackup();if(e.target.id==='importBackup')await importBackup();
  if(e.target.id==='rawSend'){let body=null;const txt=$('#rawBody').value.trim();if(txt)body=JSON.parse(txt);const r=await provider.raw($('#rawPath').value,$('#rawMethod').value,body);$('#rawResult').textContent=JSON.stringify(r,null,2)}
}

document.addEventListener('click',async e=>{try{
  const navBtn=e.target.closest('[data-nav]');if(navBtn){nav(navBtn.dataset.nav);return}
  const filter=e.target.closest('[data-filter]');if(filter){state.stockFilter=filter.dataset.filter;$$('[data-filter]').forEach(b=>b.classList.toggle('active',b===filter));renderStock();return}
  const st=e.target.closest('[data-shopping-tab]');if(st){state.shoppingTab=st.dataset.shoppingTab;$$('[data-shopping-tab]').forEach(b=>b.classList.toggle('active',b===st));renderShopping();return}
  const pc=e.target.closest('[data-product-id]');if(pc){selectProduct(pc.dataset.productId);return}
  const open=e.target.closest('[data-open-sheet]');if(open){({purchase:openPurchase,transfer:openTransfer,product:openProduct,settings:openSettings,backup:openBackup,api:openApi}[open.dataset.openSheet])();return}
  if(e.target.id==='quickAddBtn'){if($('.view.active').dataset.view==='shopping')showSheet('Zur Einkaufsliste',`<div class="form-stack">${productSelect()}<label>Menge<input name="amount" type="number" value="1" min="0.001" step="0.001"></label><button type="button" class="primary-button" id="quickShoppingAdd">Hinzufügen</button></div>`);else openPurchase();return}
  if(e.target.id==='quickShoppingAdd'){const p=await provider.resolveProduct($('[name=product]',$('#sheetBody')).value);if(!p)throw new Error('Artikel nicht gefunden.');await provider.addShopping(p.id,$('[name=amount]',$('#sheetBody')).value);$('#sheet').close();await refreshAll();toast('Hinzugefügt');return}
  if(e.target.id==='consumeBtn'){const p=await provider.resolveProduct($('#consumeProduct').value);if(!p)throw new Error('Artikel nicht gefunden.');const amount=$('#consumeAmount').value,mode=$('#consumeMode').value;if(mode==='open')await provider.open(p.id,amount);else await provider.consume(p.id,amount,mode==='spoiled');await refreshAll();toast('Buchung gespeichert');return}
  if(e.target.id==='refreshJournal'){state.journal=await provider.journal();renderJournal();return}
  if(e.target.id==='saveInventoryBtn'){const changed=$$('[data-inventory-id]').map(i=>({id:n(i.dataset.inventoryId),newAmount:n(i.value),old:n(state.stock.find(r=>n(r.product_id)===n(i.dataset.inventoryId))?.amount)})).filter(x=>x.newAmount!==x.old);if(!changed.length){toast('Keine Änderungen');return}if(!confirm(`${changed.length} Bestände aktualisieren?`))return;for(const x of changed)await provider.inventory(x.id,x.newAmount);await refreshAll();toast('Inventur gespeichert');return}
  const c=e.target.closest('[data-shop-check]');if(c){const it=state.shopping.find(x=>n(x.id)===n(c.dataset.shopCheck));if(state.mode==='server'){if(c.checked&&it){await provider.removeShoppingProduct(it.product_id,it.amount,it.shopping_list_id||1);await refreshAll();toast('Von Einkaufsliste entfernt')}}else{await provider.updateShopping(n(c.dataset.shopCheck),{done:c.checked?1:0});await refreshAll()}return}
  const m=e.target.closest('[data-shop-minus]');const p=e.target.closest('[data-shop-plus]');if(m||p){const id=n((m||p).dataset[m?'shopMinus':'shopPlus']),it=state.shopping.find(x=>n(x.id)===id),amount=Math.max(.001,n(it.amount)+(p?1:-1));await provider.updateShopping(id,{amount});await refreshAll();return}
  if(e.target.id==='storeShoppingBtn'){const selected=state.mode==='server'?state.shopping.filter(i=>i.product_id):state.shopping.filter(i=>n(i.done)!==1&&i.product_id);if(!selected.length){toast('Keine offenen Produktpositionen');return}if(!confirm(`${selected.length} Positionen in den Bestand buchen?`))return;for(const it of selected){await provider.add(it.product_id,it.amount,{best_before_date:today()});if(state.mode==='server')await provider.removeShoppingProduct(it.product_id,it.amount,it.shopping_list_id||1);else await provider.updateShopping(it.id,{done:1})}await refreshAll();toast('Einkauf eingelagert');return}
  const scan=e.target.closest('[data-scan-target]');if(scan){await scanBarcode(scan.dataset.scanTarget);return}
  if($('#sheet').open)await handleSheetClick(e)
}catch(err){toast(err.message||String(err))}});

document.addEventListener('change',async e=>{try{
  if(e.target.id==='modeSelect'){$('#serverSettings').hidden=e.target.value!=='server'}
  if(e.target.id==='editProductSelect'){const id=n(e.target.value),p=productById(id);$('#deleteProduct').hidden=!id;$('#editName').value=p?.name||'';$('#editMin').value=p?.min_stock_amount||0;$('#editBarcode').value=p?.barcode||'';if(p?.location_id)$('#edit_location').value=p.location_id;if(p?.qu_id_stock)$('#editUnit').value=p.qu_id_stock}
  if(e.target.matches('[data-shop-amount]')){await provider.updateShopping(n(e.target.dataset.shopAmount),{amount:n(e.target.value)});await refreshAll()}
}catch(err){toast(err.message)}});
$('#stockSearch').addEventListener('input',renderStock);$('#shoppingSearch').addEventListener('input',renderShopping);

async function scanBarcode(targetId){
  if(!('BarcodeDetector'in window)){toast('Kamera-Barcodescanner wird auf diesem Browser nicht unterstützt. Barcode kann manuell eingegeben werden.');document.getElementById(targetId).focus();return}
  const detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128']});const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});const video=document.createElement('video');video.playsInline=true;video.srcObject=stream;await video.play();showSheet('Barcode scannen','<div class="muted">Kamera aktiv – Barcode ruhig vor die Kamera halten.</div>');$('#sheetBody').prepend(video);video.className='scanner-video';const stop=()=>stream.getTracks().forEach(t=>t.stop());let done=false;for(let i=0;i<100&&!done;i++){await new Promise(r=>setTimeout(r,120));const codes=await detector.detect(video).catch(()=>[]);if(codes[0]){done=true;document.getElementById(targetId).value=codes[0].rawValue;stop();$('#sheet').close();document.getElementById(targetId).dispatchEvent(new Event('input'));toast('Barcode erkannt')}}if(!done)stop()}

function swVersion(worker){return new Promise(resolve=>{if(!worker)return resolve(null);const channel=new MessageChannel();const timer=setTimeout(()=>resolve(null),1200);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data?.version||null)};try{worker.postMessage({type:'GET_VERSION'},[channel.port2])}catch{clearTimeout(timer);resolve(null)}})}
async function handleWaitingWorker(worker){if(!worker)return;const version=await swVersion(worker);if(version===APP_VERSION){state.waitingWorker=null;$('#updateBar').hidden=true;worker.postMessage({type:'SKIP_WAITING'});return}state.waitingWorker=worker;$('#updateBar').hidden=false}
async function initSW(){
  if(!('serviceWorker'in navigator))return;
  const bar=$('#updateBar'),btn=$('#applyUpdateBtn');
  bar.hidden=true;
  const reg=await navigator.serviceWorker.register('service-worker.js');
  reg.addEventListener('updatefound',()=>{const w=reg.installing;w?.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)handleWaitingWorker(reg.waiting||w)})});
  if(reg.waiting)await handleWaitingWorker(reg.waiting);
  btn.addEventListener('click',()=>{if(!state.waitingWorker)return;btn.disabled=true;btn.textContent='Aktualisiere …';sessionStorage.setItem('reloadAfterUpdate','1');state.waitingWorker.postMessage({type:'SKIP_WAITING'})});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{bar.hidden=true;state.waitingWorker=null;if(sessionStorage.getItem('reloadAfterUpdate')==='1'){sessionStorage.removeItem('reloadAfterUpdate');location.reload()}});
  try{await reg.update()}catch{}
}

(async()=>{setProvider();const last=localStorage.getItem('lastView')||'stock';nav(last);await refreshAll();await initSW();if(!localStorage.getItem('mode'))setTimeout(openSettings,300)})();
