const SERVICES = [
  {
    id:'cashflow', cls:'cashflow', name:'Cashflow Dashboard', src:'tools/cashflow.html', badge:'Local',
    desc:'Project cash flows, drawdowns and SOI — milestone inflows, outflows and the net position over time.',
    feats:['Excel upload','Charts','Multi-project'],
    icon:'<path d="M5 19V5"/><path d="M5 19h14"/><path d="M8 15l3.5-4 3 2.5L19 8"/>'
  },
  {
    id:'tracker', cls:'tracker', name:'Procurement Tracker', src:'tools/tracker.html', badge:'Local',
    desc:'Purchase orders, deliveries and milestones across the pipeline, with live status, risk flags and progress analytics.',
    feats:['PO pipeline','Status flags','Timeline'],
    icon:'<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'
  },
  {
    id:'vendor', cls:'vendor', name:'Vendor Rating', src:'tools/vendor-rating.html', badge:'Offline',
    desc:'A procurement control tower plus the Acme half-yearly vendor scorecard — portfolio KPIs, risk, team workload and the 41-parameter rating matrix, all in one dashboard.',
    feats:['Portfolio + scorecard','41-parameter matrix','Fully offline'],
    icon:'<path d="M12 4l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4L7.5 17.7l.9-5L4.8 9.2l5-.7z"/>'
  }
];

/* build module cards */
const cardsEl = document.getElementById('cards');
cardsEl.innerHTML = SERVICES.map((s,i)=>`
  <div class="row ${s.cls}" onclick="location.hash='${s.id}'">
    <div class="r-top">
      <div class="r-icon"><svg viewBox="0 0 24 24">${s.icon}</svg></div>
      <div class="r-num">${String(i+1).padStart(2,'0')} / ${String(SERVICES.length).padStart(2,'0')}</div>
    </div>
    <div class="r-nm">${s.name}</div>
    <div class="r-ds">${s.desc}</div>
    <div class="r-tags">${s.feats.map(f=>`<span>${f}</span>`).join('')}</div>
    <div class="r-foot">
      <div class="r-open"><span>Open module</span>
        <span class="arw"><svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span>
      </div>
      <span class="r-badge">${s.badge}</span>
    </div>
  </div>`).join('');

/* build top-bar switcher */
const swEl = document.getElementById('switcher');
swEl.innerHTML = SERVICES.map(s=>`
  <div class="sw-tab" id="sw-${s.id}" onclick="location.hash='${s.id}'">${s.name}</div>`).join('');

const framesEl = document.getElementById('frames');
const loader   = document.getElementById('ltLoad');
const ltVid    = loader.querySelector('.ltl-vid');
const ltSub    = document.getElementById('ltlSub');
const iframes  = {};
let current = null;

function showLoader(label){
  if(label && ltSub) ltSub.textContent = label;
  loader.classList.remove('hide');
  if(ltVid){ try{ ltVid.currentTime = 0; ltVid.play(); }catch(e){} }
}
function hideLoader(){ loader.classList.add('hide'); }

function ensureFrame(s){
  if(iframes[s.id]) return iframes[s.id];
  const el = document.createElement('iframe');
  el.title = s.name;
  el.setAttribute('data-id', s.id);
  const rec = { el, loaded:false };
  el.addEventListener('load', ()=>{
    rec.loaded = true;
    if(current === s.id) hideLoader();
  });
  el.src = s.src;
  framesEl.appendChild(el);
  iframes[s.id] = rec;
  return rec;
}

function openService(id){
  const s = SERVICES.find(x=>x.id===id);
  if(!s) return;
  current = id;
  document.getElementById('launcher').style.display='none';
  document.getElementById('workspace').style.display='block';
  document.getElementById('switcher').style.display='flex';
  document.getElementById('btnHome').style.display='inline-flex';
  document.querySelectorAll('.sw-tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('sw-'+id).classList.add('on');

  const rec = ensureFrame(s);
  Object.values(iframes).forEach(r=>r.el.classList.remove('active'));
  rec.el.classList.add('active');
  if(rec.loaded) hideLoader(); else showLoader('Loading '+s.name+'…');

  document.title = 'Acme RE · '+s.name;
}

function goHome(){
  current=null;
  document.getElementById('workspace').style.display='none';
  document.getElementById('switcher').style.display='none';
  document.getElementById('btnHome').style.display='none';
  document.getElementById('launcher').style.display='flex';
  document.querySelectorAll('.sw-tab').forEach(t=>t.classList.remove('on'));
  document.title = 'Acme RE · Procurement Suite';
}

/* top bar: pull it down when the top edge/handle is hovered; small delay before it hides again */
(function(){
  const bar=document.getElementById('topbar'),
        zone=document.getElementById('topHover'),
        handle=document.getElementById('topHandle');
  if(!bar) return;
  let hideT;
  const show=()=>{ clearTimeout(hideT); bar.classList.add('reveal'); handle.classList.add('hide'); };
  const hide=()=>{ hideT=setTimeout(()=>{ bar.classList.remove('reveal'); handle.classList.remove('hide'); }, 420); };
  [zone,handle,bar].forEach(el=>{ if(el){ el.addEventListener('mouseenter',show); el.addEventListener('mouseleave',hide); } });
})();

/* date readouts */
(function(){
  const d=new Date();
  const m=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('tdate').textContent = d.getDate()+' '+m[d.getMonth()]+' '+d.getFullYear();
  document.getElementById('mDate').textContent = d.getDate()+' '+m[d.getMonth()];
})();

/* deep-link */
function applyHash(){
  const h=(location.hash||'').replace('#','');
  if(SERVICES.some(s=>s.id===h)){ if(h!==current) openService(h); }
  else if(h===''&&current){ goHome(); }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', applyHash);
else applyHash();
window.addEventListener('hashchange', applyHash);

/* initial splash — show the flame-in-glass screen briefly, then reveal the suite.
   If a tool is opening via deep-link, let that iframe's load event clear it. */
(function(){
  const MIN = 1900;
  const t0  = Date.now();
  function finish(){
    if(current && iframes[current] && !iframes[current].loaded) return; // tool still loading
    setTimeout(hideLoader, Math.max(0, MIN - (Date.now() - t0)));
  }
  if(document.readyState === 'complete') finish();
  else window.addEventListener('load', finish);
})();