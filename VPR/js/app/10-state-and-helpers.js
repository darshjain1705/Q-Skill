/* ============================================================
 * 10-state-and-helpers.js
 * Global state, item/vendor lookups, evaluator-team tags, nav + setM
 * ------------------------------------------------------------
 * Part of the L&T Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */

// A category's STATUS cell means "not applicable to this team for this PO"
// when it reads NA — but evaluators type this a few different ways in
// practice (NA, N/A, N.A., Not Applicable), and the app only ever recognized
// the bare "NA" spelling. A PO marked "N/A" (or any of the other variants)
// was silently treated as a real, still-pending rating instead: its
// parameters counted toward the evaluator's total, nothing was filled in
// (since the evaluator considered it not applicable and moved on), and the
// vendor stayed stuck as incomplete forever. Single source of truth so
// excel-import / scorecard / completeness / vendor-tier all agree on what
// counts as NA.
function isNAStatus(status){
  return /^(na|n\/a|n\.a\.?|not\s*applicable)$/.test(String(status||'').trim().toLowerCase());
}

// IN-MEMORY STORAGE (replaces localStorage for stateless dashboard)
// _lsParsed()'s cache (85-view-completeness.js) only ever hooked the REAL
// Storage.prototype (localStorage/sessionStorage) to know when to invalidate — since
// this app writes through appStorage instead, that cache was never actually invalidated
// by normal use, so a page that had already read+cached e.g. lnt_itemRatings_H1 could
// keep serving pre-save data for the rest of the session. Referencing invalidateLsCache
// here (defined later, in 85) is safe: these methods only run later, at runtime, by
// which point every script has finished loading into the shared global scope.
window.appStorage = {
  _data: {},
  getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
  setItem(key, value) {
    this._data[key] = String(value);
    try { if (typeof invalidateLsCache === 'function') invalidateLsCache(key); } catch(e) {}
  },
  removeItem(key) {
    delete this._data[key];
    try { if (typeof invalidateLsCache === 'function') invalidateLsCache(key); } catch(e) {}
  },
  clear() {
    this._data = {};
    try { if (typeof invalidateLsCache === 'function') invalidateLsCache(); } catch(e) {}
  },
  // Storage-interface parity: several call sites (30-excel-import.js's stale-PO
  // purge, 70-rating-matrix-and-scope.js's quarter listing/copy/clear-all) iterate
  // every stored key the same way they would on a real Storage object, via
  // `for (let i = 0; i < appStorage.length; i++) appStorage.key(i)`. Without these
  // two, appStorage.length is undefined, "undefined < undefined" loops never run
  // even once, and all of that logic silently no-ops instead of throwing —
  // which is why deleted POs never got purged and quarter-copy silently missed data.
  key(index) {
    const keys = Object.keys(this._data);
    return index >= 0 && index < keys.length ? keys[index] : null;
  }
};
Object.defineProperty(window.appStorage, 'length', {
  get() { return Object.keys(this._data).length; }
});

// STATE

let DB={};
let SHEETS=[];
let _filt=[], _pg=1;
const PG=30;
const _ch=[];
let RAW_ITEMS = [], RAW_VENDORS = [], RAW_POS = [];
// Item name (Cables, Transformer, Inverter, MMS, Panel, Tracker, …) entered by the user
// in the ITEM column of the category sheets (SCM/EDRC/Quality/Operations). Keyed by
// period + PO because the same PO can carry a different item in H1 vs H2.
//   PO_ITEM_MAP["H1|LE/.../000013"] = "Cables"
let PO_ITEM_MAP = {};
function itemKeyOf(period, po){ return String(period||'').trim().toUpperCase() + '|' + String(po||'').trim(); }
// Resolve a PO's item for a given period; if the period-specific entry is missing,
// fall back to any item recorded for that PO in any period.
function itemForPeriodPO(period, po){
  const exact = PO_ITEM_MAP[itemKeyOf(period, po)];
  if (exact) return exact;
  const poStr = String(po||'').trim();
  if (!poStr) return '';
  const suffix = '|' + poStr;
  for (const k in PO_ITEM_MAP){ if (k.endsWith(suffix) && PO_ITEM_MAP[k]) return PO_ITEM_MAP[k]; }
  return '';
}
// ── Scope-aware item resolution ───────────────────────────────────────────
// The same PO can carry a DIFFERENT item in H1 vs H2 (e.g. Cables in H1,
// Transformer in H2). Looking items up against a single half is correct while
// one half is selected, but in "Both" scope it silently drops every item that
// only exists in the other half — which is why the item count stayed frozen at
// the active half's total. These helpers resolve a PO against every half that
// is currently in scope instead.
function scopePeriods(){
  return [activeQuarter];
}
// All distinct items a PO carries across the halves in scope (deduped, ordered).
function itemsForScopePO(po){
  const out = [];
  scopePeriods().forEach(q => {
    const v = itemForPeriodPO(q, po);
    if (v && out.indexOf(v) === -1) out.push(v);
  });
  return out;
}
// Per-half breakdown of a PO's items, for display. Uses the EXACT period entry
// (no cross-period fallback) so the two lines are truthful about which half is which;
// only when neither half has an entry does it fall back to any recorded name.
function itemsByHalfForPO(po){
  const halves = scopePeriods();
  const out = [];
  halves.forEach(q => {
    const exact = String(PO_ITEM_MAP[itemKeyOf(q, po)] || '').trim();
    if (!exact) return;
    const hit = out.find(x => x.name === exact);
    if (hit) hit.halves.push(q); else out.push({ name: exact, halves: [q] });
  });
  if (!out.length) {
    const fb = String(itemForPeriodPO(halves[0], po) || '').trim();
    if (fb) out.push({ name: fb, halves: [] });
  }
  return out;
}

// ITEM table cell. The same PO can carry a different item in each half (Cables in H1,
// Transformer in H2). Showing only the active half's name hid half the picture in
// "Both" scope, so every item is listed on its own line, tagged with its half.
function itemCellHTML(po){
  const rows = itemsByHalfForPO(po);
  if (!rows.length) return '—';
  if (scopePeriods().length < 2) return hesc(rows[0].name);
  return rows.map(x => `<div style="display:flex;align-items:baseline;gap:6px;white-space:nowrap;line-height:1.5;">
      <span style="font-family:var(--mono);font-size:9px;font-weight:600;color:var(--t3);border:1px solid var(--brd2);border-radius:2px;padding:0 3px;">${x.halves.join('+')||'—'}</span>
      <span>${hesc(x.name)}</span>
    </div>`).join('');
}

// Single representative item, for the places that can only show one string.
function itemForScopePO(po){
  const a = itemsForScopePO(po);
  return a.length ? a[0] : '';
}
// Vendor Master join: normalized vendor code/name → email & cc, loaded from Vendor_Master.xlsx.
// Persisted to appStorage so it survives reloads — load the master once and it sticks.
let VENDOR_EMAILS = {};   // key → primary email
let VENDOR_CC = {};       // key → cc string
let VENDOR_LOCATION = {}; // key → location (city / state / region) driving the Vendor Location map
// Full vendor roster straight from the Vendor Master (code/name/location), independent of any
// PO tracker. Lets the Vendor Location map show something even with only this one file loaded.
let VENDOR_MASTER_ROSTER = {}; // normalized key → {code, name, location}
// Full contact record per vendor, straight from the Vendor Master sheet. Feeds the
// Vendor Details page and the contact block on each vendor's page. Shape:
// {code, name, factory, address, materialDesc, c1Name, c1Email, c1Phone, c2Name, c2Email, c2Phone}
// materialDesc ("what the vendor supplies") is Vendor Master-only, free text — unrelated
// to the ITEM column resolved by itemForScopePO()/itemsForScopePO() from the rating sheets.
let VENDOR_DETAILS = {};  // normalized key → record
// Strip non-breaking/zero-width spaces (common Excel paste artifacts) before normalizing.
function normVenKey(s){ return String(s||'').replace(/[ ​‌‍﻿]/g,' ').trim().toLowerCase().replace(/\s+/g,' '); }
// Vendor codes from SAP are often zero-padded to a fixed width, so the same vendor
// shows as "V007900" in the master but "V0007900" in the PO export. Collapse both to a
// padding-insensitive key: drop separators, then strip leading zeros that sit after any
// alpha prefix (e.g. "V0007900" / "V007900" / "v7900" → "v7900").
function normCodeKey(s){
  const k = normVenKey(s).replace(/[^a-z0-9]/g,'');
  return k.replace(/^([a-z]*)0+(?=\d)/, '$1');
}
function vendorEmailFor(code, name){
  return VENDOR_EMAILS[normVenKey(code)] || VENDOR_EMAILS[normCodeKey(code)]
      || (name?VENDOR_EMAILS[normVenKey(name)]:'') || '';
}
function vendorCcFor(code, name){
  return VENDOR_CC[normVenKey(code)] || VENDOR_CC[normCodeKey(code)]
      || (name?VENDOR_CC[normVenKey(name)]:'') || '';
}
// Vendor's location (city / state) from the Vendor Master, used to place it on the region map.
function vendorLocationFor(code, name){
  return VENDOR_LOCATION[normVenKey(code)] || VENDOR_LOCATION[normCodeKey(code)]
      || (name?VENDOR_LOCATION[normVenKey(name)]:'') || '';
}
// Full Vendor Master contact record for a vendor, looked up by code first (padding
// insensitive) then by name. Returns null when the vendor isn't in the master at all.
function vendorDetailsFor(code, name){
  return VENDOR_DETAILS[normVenKey(code)] || VENDOR_DETAILS[normCodeKey(code)]
      || (name?VENDOR_DETAILS[normVenKey(name)]:null) || null;
}
// Vendor "company" grouping ------------------------------------------------------
// A single parent company (e.g. SIEMENS) can appear in PO Master under several
// distinct VENDOR CODEs — regional offices / legal subsidiaries that each raise
// their own POs (and often have their own row in Vendor_Master.xlsx). Left alone,
// every page that keys off i.vendor (Portfolio tiers, Scorecard, Completeness,
// Team Workload, Vendor Focus) would show these as unrelated vendors.
//
// applyVendorCompanyGrouping() folds them together right after import: every PO
// row whose VENDOR DESC matches (case/space-insensitive) is rewritten to share one
// identity, so the rest of the app treats the whole group as a single vendor with
// zero further changes. Saved ratings are keyed by stableKey(), which is built
// from i.vendor — and the ratings importer (30-excel-import.js) ALWAYS stores each
// PO's ratings under a name-based key (po:PO|ven:VENDOR NAME|item:ITEM) in addition
// to its code-based one, for every entity regardless of which code raised that PO.
// So the canonical identity here MUST be the shared vendor name, not an invented
// code — using a made-up canonical code would point stableKey() at a key that was
// never actually saved for the group's non-canonical entities, silently hiding
// their ratings. The original code is kept on the row (vendorOriginalCode) and the
// full membership list is kept in VENDOR_GROUP_MEMBERS[canonicalName].
let VENDOR_GROUP_MEMBERS = {}; // canonical name -> [{code, name}, ...] (only set for groups of 2+)
function applyVendorCompanyGrouping(items){
  VENDOR_GROUP_MEMBERS = {};
  const byName = {};
  items.forEach(i=>{
    const nm = (i.vendorName||'').trim();
    const code = (i.vendor||'').trim();
    if(nm.length<2 || code.length<2) return;
    const key = normVenKey(nm);
    (byName[key] = byName[key] || []).push(i);
  });
  Object.values(byName).forEach(group=>{
    const codes=[...new Set(group.map(i=>i.vendor.trim()))];
    if(codes.length<2) return; // single-code vendor — nothing to merge
    const canonicalName=group[0].vendorName.trim();
    VENDOR_GROUP_MEMBERS[canonicalName]=codes.map(c=>{
      const rec=group.find(i=>i.vendor.trim()===c);
      const master=vendorDetailsFor(c, rec.vendorName);
      return { code:c, name:(master&&master.name)||rec.vendorName||canonicalName };
    });
    group.forEach(i=>{
      i.vendorOriginalCode=i.vendor;
      i.vendor=canonicalName;   // matches the name-keyed rating entry saved for THIS PO
      i.vendorName=canonicalName;
    });
  });
}
// Display helper for a vendor "code" cell: a grouped company's v.code (or i.vendor)
// is the shared NAME, not a real code — showing it again next to the vendor name is
// just a repeat. Show the underlying member codes instead (one per line by default,
// or comma-separated via sep for inline contexts like <option> text). A normal
// single-entity vendor just shows its own real code, unchanged.
function vendorCodeDisplay(code, sep){
  sep = sep || '<br/>';
  const members = VENDOR_GROUP_MEMBERS[String(code||'').trim()];
  if (members && members.length) return members.map(m=>hesc(m.code)).join(sep);
  return hesc(code||'');
}
function persistVendorMaster(){
  try{
    appStorage.setItem('lnt_vendorEmails', JSON.stringify(VENDOR_EMAILS));
    appStorage.setItem('lnt_vendorCc', JSON.stringify(VENDOR_CC));
    appStorage.setItem('lnt_vendorLocation', JSON.stringify(VENDOR_LOCATION));
    appStorage.setItem('lnt_vendorRoster', JSON.stringify(VENDOR_MASTER_ROSTER));
    appStorage.setItem('lnt_vendorDetails', JSON.stringify(VENDOR_DETAILS));
  }catch(e){}
}
// Heuristic: a stored key that looks like a prose sentence (very long, or contains
// instruction-style words) is corrupt data from a past bad parse. Strip it so it
// never surfaces in the Vendor Details table or on vendor pages.
function _isProseKey(k){
  if(!k) return false;
  if(k.length>60) return true;
  if(/\bdo not\b|\bstep\s+\d|\bdashboard\b|\bworkbook\b|\bcolumn\b|\brow\s*\d|\binstructi|\bvendor master\b/i.test(k)) return true;
  return false;
}
function _sanitizeVendorMap(map){
  Object.keys(map).forEach(k=>{ if(_isProseKey(k)||(map[k]&&(_isProseKey(map[k].code)||_isProseKey(map[k].name)))) delete map[k]; });
}
function hydrateVendorMaster(){
  let cleaned=false;
  try{
    VENDOR_EMAILS = JSON.parse(appStorage.getItem('lnt_vendorEmails')||'{}') || {};
    VENDOR_CC     = JSON.parse(appStorage.getItem('lnt_vendorCc')||'{}')     || {};
    VENDOR_LOCATION = JSON.parse(appStorage.getItem('lnt_vendorLocation')||'{}') || {};
    VENDOR_MASTER_ROSTER = JSON.parse(appStorage.getItem('lnt_vendorRoster')||'{}') || {};
    VENDOR_DETAILS = JSON.parse(appStorage.getItem('lnt_vendorDetails')||'{}') || {};
    // Strip any corrupt prose-text entries that might have been saved in a previous session.
    const before=Object.keys(VENDOR_DETAILS).length+Object.keys(VENDOR_MASTER_ROSTER).length;
    _sanitizeVendorMap(VENDOR_DETAILS);
    _sanitizeVendorMap(VENDOR_MASTER_ROSTER);
    const after=Object.keys(VENDOR_DETAILS).length+Object.keys(VENDOR_MASTER_ROSTER).length;
    cleaned=(after<before);
    addCodeKeyAliases(VENDOR_EMAILS); addCodeKeyAliases(VENDOR_CC); addCodeKeyAliases(VENDOR_LOCATION);
    addCodeKeyAliases(VENDOR_DETAILS);
  }catch(e){ VENDOR_EMAILS={}; VENDOR_CC={}; VENDOR_LOCATION={}; VENDOR_MASTER_ROSTER={}; VENDOR_DETAILS={}; }
  // If corrupt entries were stripped, write the clean version back to appStorage immediately
  // so the fix takes effect even before the user re-uploads the Vendor Master.
  if(cleaned) persistVendorMaster();
}
// Add padding-insensitive aliases for code-like keys saved before normCodeKey existed,
// so a previously-loaded master resolves after a plain refresh (no re-import needed).
// Keys with spaces or no digits are vendor names — left untouched.
function addCodeKeyAliases(map){
  Object.keys(map).forEach(k=>{
    if(/\s/.test(k) || !/\d/.test(k)) return;
    const ck=normCodeKey(k);
    if(ck && !(ck in map)) map[ck]=map[k];
  });
}
hydrateVendorMaster();
let activeRatingKey = (function() {
  try { return appStorage.getItem('lnt_activeRatingKey') || ''; } catch(e) { return ''; }
})();
let itemRatings = {};

// Team Workload: Buyer → Team (SCM / EDRC / Quality / Operation) assignment
const TEAMS = [{id:'scm',label:'SCM'},{id:'edrc',label:'EDRC'},{id:'quality',label:'Quality'},{id:'operation',label:'Operation'}];
const TEAM_LABEL = {scm:'SCM',edrc:'EDRC',quality:'Quality',operation:'Operation'};

/* Top Strengths / Weakest Parameters: show ONE row per team — that team's
   single best (good=true) or single worst (good=false) parameter. Previously
   these panels pooled every parameter and took the top/bottom 5 by score,
   which let a single team (SCM has 15 params vs EDRC's 5) fill every slot.
   Teams with no ratings yet simply don't appear. Ties keep the first seen. */
const bestPerTeam = (agg, good) => {
  const by = {};
  agg.forEach(p => {
    const k = p.cat;
    if (!by[k]) { by[k] = p; return; }
    if (good ? p.avg > by[k].avg : p.avg < by[k].avg) by[k] = p;
  });
  return Object.values(by).sort((x, y) => good ? y.avg - x.avg : x.avg - y.avg);
};
const CAT_IDS = ['scm','edrc','quality','operation'];
let buyerTeams = {};                 // normalized buyer name → team id
let buyerTeamsAuto = {};             // keys auto-tagged from the rating workbook (so manual tags aren't clobbered)
let teamSel = {team:'',buyer:'',status:'',q:''};  // Team Workload filter ('' = All; team='__none__' = unassigned; status/q filter the PO table)
let _taBuyers = [];                  // buyers currently shown in the assign modal
function normBuyerKey(s){ return normVenKey(s); }
// An evaluator's team: the tag auto-applied from whichever category sheet names them,
// or the one the user picked by hand in the assign modal.
function buyerTeamOf(name){ return buyerTeams[normBuyerKey(name)] || ''; }
function persistBuyerTeams(){ try{ appStorage.setItem('lnt_buyerTeams', JSON.stringify(buyerTeams)); }catch(e){} try{ appStorage.setItem('lnt_buyerTeamsAuto', JSON.stringify(buyerTeamsAuto)); }catch(e){} }
function hydrateBuyerTeams(){ try{ buyerTeams = JSON.parse(appStorage.getItem('lnt_buyerTeams')||'{}') || {}; }catch(e){ buyerTeams={}; } try{ buyerTeamsAuto = JSON.parse(appStorage.getItem('lnt_buyerTeamsAuto')||'{}') || {}; }catch(e){ buyerTeamsAuto={}; } }
hydrateBuyerTeams();
// Manual assignment via the modal: set the team AND drop the auto flag so a later import never overrides the user's choice.
function assignBuyerTeam(key, teamId){ if(teamId) buyerTeams[key]=teamId; else delete buyerTeams[key]; delete buyerTeamsAuto[key]; persistBuyerTeams(); }
// Auto-tag buyers to teams from the rating workbook's per-category Buyer columns.
// tally: normKey -> { display, teams:{ catId:count } }. Each category's catId (scm/edrc/quality/operation) IS the team id.
// A buyer is tagged to the team where their name appears most (ties broken by category order). We only set a tag when the
// buyer is unassigned OR was previously auto-tagged — a team the user picked by hand is never overwritten.
function applyBuyerTeamAutoTags(tally){
  const order = ['scm','edrc','quality','operation'];
  let changed = 0;
  Object.keys(tally||{}).forEach(bk=>{
    const teams = (tally[bk]||{}).teams || {};
    let best='', bestN=0;
    order.forEach(t=>{ const n=teams[t]||0; if(n>bestN){ bestN=n; best=t; } });
    if(!best) return;
    const cur = buyerTeams[bk];
    if(!cur || buyerTeamsAuto[bk]){
      if(cur!==best) changed++;
      buyerTeams[bk]=best;
      buyerTeamsAuto[bk]=true;
    }
  });
  if(changed) persistBuyerTeams();
  return changed;
}
// Every name in the rating workbook's Evaluator columns, across all four category sheets.
// Sourced directly from the category buyer index (ratings sheets), NOT from PO Master items.
function distinctEvaluators(){
  const cbi=buildCatBuyerIndex(), s=new Set();
  // Collect from every PO entry in the ratings-sheet index, regardless of whether the PO
  // exists in the loaded tracker (PO Master). This ensures evaluators whose POs only appear
  // in the rating workbook are still visible in Team Workload.
  Object.values(cbi).forEach(m=>{
    CAT_IDS.forEach(c=>{ const n=String(m[c]||'').trim(); if(n.length>1) s.add(n); });
  });
  return [...s].sort((x,y)=>String(x).localeCompare(String(y)));
}
function setTeamFilter(t){ teamSel.team=t; teamSel.buyer=''; rTeam(); }
function setBuyerFilter(b){ teamSel.buyer=b; rTeam(); }

document.getElementById('tdate').textContent=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});

function toast(m,t='ok'){const e=document.getElementById('toast');e.textContent=m;e.className='toast show '+t;clearTimeout(e._t);e._t=setTimeout(()=>e.className='toast',3000)}

function startScorecardOnly() {
  document.getElementById('upscreen').style.display='none';
  document.getElementById('cf').textContent='Scorecard Mode';
  go('scorecard');
}


// STATUS HELPERS

// Memoized flatten of every sheet's rows. Invalidated whenever DB changes (load/home).
let _allCache=null;
function invalidateAll(){ _allCache=null; if(typeof invalidateRisk==='function') invalidateRisk(); }
function all(){ return _allCache || (_allCache=[].concat(...Object.values(DB).map(d=>d.rows))); }

// Collapse keystroke bursts so typing in a filter never triggers a scan per character.
function debounce(fn, ms=140){ let t; return function(...a){ const c=this; clearTimeout(t); t=setTimeout(()=>fn.apply(c,a), ms); }; }
const shFltD                  = debounce(()=>shFlt(), 130);
const rSrchD                  = debounce(()=>rSrch(), 170);
const updateScorecardFiltersD = debounce(()=>updateScorecardFilters(), 160);
const compFilterD             = debounce(v=>compFilter(v), 120);
const fltVD                   = debounce(v=>fltV(v), 120);
const renderTeamAssignRowsD   = debounce(v=>renderTeamAssignRows(v), 150);
const renderDetailRowsD       = debounce(v=>renderDetailRows(v), 150);
const filterMSD               = debounce((id,v)=>filterMS(id,v), 120);

// Progressive row rendering: paint the first chunk instantly, stream the rest so a large
// sheet never blocks the UI thread. Falls back to setTimeout when requestIdleCallback is
// unavailable; idle timeout keeps it progressing even in a background tab.
function streamRows(tbody, rowsHtml, onDone){
  if(!tbody) return;
  const total = rowsHtml.length;
  // Small tables: one write, no scheduling overhead.
  if(total <= 150){
    tbody.insertAdjacentHTML('beforeend', rowsHtml.join(''));
    if(onDone) onDone();
    return;
  }
  const CH = 250;
  let i = 0;
  (function paint(){
    const buf = rowsHtml.slice(i, i+CH).join('');
    i += CH;
    if(buf){
      // Parse into a detached fragment, then append once — one layout pass per
      // chunk instead of one per row.
      const tpl=document.createElement('template');
      tpl.innerHTML='<table><tbody>'+buf+'</tbody></table>';
      const src=tpl.content.querySelector('tbody');
      const frag=document.createDocumentFragment();
      while(src && src.firstChild) frag.appendChild(src.firstChild);
      tbody.appendChild(frag);
    }
    if(i < total){ requestAnimationFrame(paint); }
    else if(onDone){ onDone(); }
  })();
}
function tr(s,n=40){s=String(s||'');return s.length>n?s.slice(0,n-1)+'…':s}
/* hesc: full HTML escaper — safe for element text AND quoted attributes.
   Turns <,>,&,",' into harmless entities so workbook data can never become markup. */
function hesc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
// PO numbers and vendor codes (e.g. "LE/LE25M141/POD/25/000036") are one long
// unbroken token with no spaces, so a narrow column has nowhere sanctioned to
// wrap and falls back to breaking mid-digit -- which is what strands a single
// trailing character ("...00003" / "6") on its own line. Slashes are the only
// sensible place to break a code like this, so mark each one with <wbr>: a
// real break opportunity the browser only uses when the line actually needs
// it, instead of an arbitrary mid-token cut.
function hescCode(s){ return hesc(s).replace(/\//g,'/<wbr>'); }
// Same break-opportunity treatment, for strings (like vendorCodeDisplay's output)
// that are already HTML-escaped -- re-running hesc() on those would double-encode
// entities, so this just inserts the <wbr> markers without touching the escaping.
function wbrCode(escapedHtml){ return String(escapedHtml==null?'':escapedHtml).replace(/\//g,'/<wbr>'); }
/* esc: safe to drop inside a single-quoted JS string in an inline handler, e.g.
   onclick="goSheet('${esc(name)}')". Backslash-escapes ' and \ (so the JS string can't
   be closed early), entity-escapes &,",<,> (so the HTML attribute can't be broken out of),
   and neutralises newlines. Keeps ordinary names like O'Brien / L&T working correctly. */
function esc(s){return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\r\n]/g,' ')}

// Scrolls back to the top of the page after a nav change / card-detail open. #main is a
// plain flow element (the document itself scrolls, not #main), so the old `#main.scrollTop=0`
// calls scattered across the view files never actually moved anything — this is the real thing,
// and animates unless the user has asked the OS for reduced motion.
function scrollMainToTop(){
  let reduce=false; try{ reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  try{ window.scrollTo({top:0, left:0, behavior: reduce?'auto':'smooth'}); }catch(e){ window.scrollTo(0,0); }
}

function poSt(i){
  const s=String(i.poIssued||'').toLowerCase().trim();
  if(s.includes('po issued')||s.includes('released')||s==='done'||s==='ü'||s==='✓') return 'released';
  if(s.includes('loa issued')) return 'confirmed';
  if(s.includes('order conf')||s.includes('confirmed')) return 'confirmed';
  if(s.includes('hpc')||s.includes('bafo')||s.includes('technical')||s.includes('rfq')) return 'pending';
  if(s==='na'||s==='n/a'||s.includes('not applic')||s.includes('no require')) return 'na';
  if(s===''||s.includes('yet')||s.includes('finali')||s.includes('tbd')||s==='pending') return 'pending';
  if(s.length>0 && s!=='no' && s!=='false') return 'released';
  return 'pending';
}
function mfcSt(i){
  const s=String(i.mfcStatus||'').toLowerCase();
  if(s.includes('issued')&&!s.includes('partial')) return 'issued';
  if(s.includes('partial')) return 'partial';
  if(s.includes('pending')||s.includes('awaited')) return 'pending';
  return 'na';
}
const PILL={released:['pill-g','● Released'],confirmed:['pill-b','● Confirmed'],pending:['pill-a','● Pending'],na:['pill-m','● N/A'],issued:['pill-g','● Issued'],partial:['pill-a','● Partial']};
function pill(st){const[c,l]=PILL[st]||PILL.pending;return `<span class="pill ${c}">${l}</span>`}

function riskOf(i){
  const ms=String(i.mfcStatus||'').toLowerCase();
  const rem=String(i.remarks||'').toLowerCase();
  const v=String(i.vendor||'').toLowerCase();
  const po=poSt(i);
  const isCAT1=ms.includes('cat-1')||ms.includes('cat1')||rem.includes('cat-1')||rem.includes('agel');
  const isMFCP=ms.includes('pending')||ms.includes('awaited');
  const isTBD=(v==='tbd'||v==='ytd'||v==='');
  const isPB=rem.includes('pre bid')||rem.includes('prebid');
  if(isCAT1) return{level:'high',reason:'CAT-1 / AGEL approval awaited'};
  if(isMFCP&&po!=='released') return{level:'high',reason:'MFC pending & PO not released'};
  if(isTBD&&!isPB&&po!=='released'&&po!=='confirmed') return{level:'medium',reason:'Vendor not finalised'};
  if(isPB) return{level:'medium',reason:'Pre-bid stage'};
  return{level:'none',reason:''};
}
let _riskCache=null,_riskIdx=null;
function _riskKey(item,sheetId){return String(sheetId||'')+'\u0000'+String(item||'')}
function getRisk(){
  if(_riskCache) return _riskCache;
  _riskCache = all().map(i=>{const r=riskOf(i);return r.level!=='none'?{...i,...r}:null}).filter(Boolean);
  _riskIdx = new Map();
  for(const r of _riskCache){
    const k=_riskKey(r.item,r.sheetId);
    if(!_riskIdx.has(k)) _riskIdx.set(k,r);
    const k2='\u0001'+String(r.item||'');
    if(!_riskIdx.has(k2)) _riskIdx.set(k2,r);
  }
  return _riskCache;
}
// O(1) replacement for the per-row linear scans. Two-key lookups must NOT fall
// back to an item-only match: the original find(item && sheetId) returns
// undefined on a sheet mismatch, and callers depend on that.
function riskFor(item,sheetId){
  if(!_riskIdx) getRisk();
  if(sheetId!==undefined) return _riskIdx.get(_riskKey(item,sheetId));
  return _riskIdx.get('\u0001'+String(item||''));
}
function invalidateRisk(){_riskCache=null;_riskIdx=null;}


// NAV + CHARTS

function buildNav(){
  const pnav=document.getElementById('pnav');
  if(!pnav) return;
  pnav.innerHTML=SHEETS.map((s,idx)=>{
    const id='nav-sh-'+idx;
    return `<div class="nav" id="${id}" data-sheet="${esc(s)}" onclick="goSheet('${esc(s)}')" title="${hesc(DB[s].name)}">`+
      `<svg class="nav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`+
      `${hesc(DB[s].name)}<span class="nbadge">${DB[s].rows.length}</span></div>`;
  }).join('');
}

function go(v, keepActive=false, fromHistory=false){
  if(v==='scorecard' && !keepActive){
    activeRatingKey = '';
    try { appStorage.removeItem('lnt_activeRatingKey'); } catch(e) {}
  }
  // Completeness page was removed from the UI — redirect any stale bookmark/link to Portfolio
  // instead of silently rendering nothing. itemCompleteness() itself (85-view-completeness.js)
  // stays loaded and is still used internally by tier-completion gating.
  if(v==='completeness'){ v='overview'; }
  const h = '#' + v;
  if(!fromHistory && window.location.hash !== h) {
    window.history.pushState(null, '', h);
  }
  document.querySelectorAll('.nav').forEach(e=>e.classList.remove('on'));
  const el=document.getElementById('nav-'+v);if(el)el.classList.add('on');
  scrollMainToTop();
  ({overview:rOverview,risk:rRisk,pipeline:rPipeline,team:rTeam,vendors:rVendors,payments:rPayments,blockers:rBlockers,raw:rRaw,scorecard:rScorecard,vdetails:rVendorDetails})[v]?.();
}
function goSheet(s, fromHistory=false){
  const h = '#sheet:' + encodeURIComponent(s);
  if(!fromHistory && window.location.hash !== h) {
    window.history.pushState(null, '', h);
  }
  document.querySelectorAll('.nav').forEach(e=>e.classList.remove('on'));
  const el=document.querySelector(`.nav[data-sheet='${esc(s)}']`);
  if(el)el.classList.add('on');
  scrollMainToTop();
  rSheet(s);
}

let _inAppNav = false;
const _origPushState = window.history.pushState;
window.history.pushState = function() {
  _inAppNav = true;
  return _origPushState.apply(this, arguments);
};

function goBack(fallback = 'overview') {
  if (_inAppNav) {
    window.history.back();
  } else {
    go(fallback);
  }
}

window.addEventListener('popstate', () => { _inAppNav = true; handleHash(); });
function handleHash(preserveState) {
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#overview') { go('overview', false, true); return; }
  if (hash.startsWith('#sheet:')) {
    goSheet(decodeURIComponent(hash.slice(7)), true);
  } else if (hash.startsWith('#vendor:')) {
    openVendorPage(decodeURIComponent(hash.slice(8)), true);
  } else if (hash.startsWith('#project:')) {
    openProjectPage(decodeURIComponent(hash.slice(9)), true);
  } else if (hash.startsWith('#tier:')) {
    showTierVendors(decodeURIComponent(hash.slice(6)), true);
  } else if (hash.startsWith('#vdetail:')) {
    openVendorDetail(decodeURIComponent(hash.slice(9)), true);
  } else if (hash.startsWith('#card:')) {
    openCardDetail(decodeURIComponent(hash.slice(6)), true);
  } else {
    // `preserveState` (set by setActiveQuarter's H1/H2 switch) keeps whatever in-page
    // focus is open — e.g. the specific item being rated in Vendor Scorecard — instead
    // of go()'s normal fresh-navigation reset for that view (see go()'s activeRatingKey
    // clear, gated on the same flag via its `keepActive` parameter).
    go(hash.slice(1), !!preserveState, true);
  }
}

// ---- Clickable-card drill-downs ----------------------------------------------
// Each page stashes the records behind its cards into CARD_DATA at render time;
// clicking a card opens a full detail page (openCardDetail) that lists them.
let CARD_DATA = {};
let CARD_RETURN = 'overview';
function setCardData(key, obj){ CARD_DATA[key] = obj; }
function cardDetailBack(){
  const r = CARD_RETURN || 'overview';
  // A nested drill-down returns to its parent card instead of the source page.
  if(typeof r === 'string' && r.startsWith('card:')){ openCardDetail(r.slice(5)); return; }
  go(r);
}
// presetFilter: optional value to pre-select in the column-filter dropdown (d.filterCol)
// when a caller already knows which slice the user wants — e.g. clicking a specific
// team's row should open straight into that team's rows, not the unfiltered full list.
function openCardDetail(key, fromHistory, presetFilter){
  const d = CARD_DATA[key];
  if(!d){ go('overview'); return; }              // e.g. deep-link before the source page rendered
  CARD_RETURN = d.back || 'overview';
  const h = '#card:' + key;
  if(!fromHistory && window.location.hash !== h){ window.history.pushState(null, '', h); }
  const cols = d.columns || [];
  const head = cols.map(c=>`<th style="text-align:${c.align||'left'}">${hesc(c.label)}</th>`).join('');
  // A row can carry `code` (open that vendor), `project` (open that project page) or a
  // raw `go` handler. Rows that navigate get a hover affordance + a chevron column.
  const anyNav = (d.rows||[]).some(r=>r.code||r.project||r.go);
  const totalRows = (d.rows||[]).length;
  const rows = totalRows ? d.rows.map(r=>{
    const cells = r.cells.map((c,i)=>`<td style="text-align:${(cols[i]&&cols[i].align)||'left'}">${c}</td>`).join('');
    // esc() makes the value safe inside the JS string literal; hesc() then makes the whole
    // handler safe inside the double-quoted HTML attribute (names may contain " & < >).
    const nav = r.go ? r.go
      : r.project ? `openProjectPage('${esc(r.project)}')`
      : r.code ? `openVendorPage('${esc(r.code)}')` : '';
    const chev = anyNav
      ? `<td style="text-align:right;width:28px;">${nav?`<svg class="cdd-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`:''}</td>`
      : '';
    return `<tr class="${nav?'cdd-nav':''}" ${nav?`onclick="${nav}" title="${hesc(r.navTitle||'Open full details')}"`:''}>${cells}${chev}</tr>`;
  }).join('') : `<tr><td colspan="${(cols.length||1)+(anyNav?1:0)}" style="text-align:center;padding:26px;color:var(--t2);font-style:italic;">No records for this selection.</td></tr>`;

  // Optional KPI tiles above the table.
  const kpis = (d.kpis && d.kpis.length) ? `<div class="cdd-kpis">${d.kpis.map(k=>`
    <div class="cdd-kpi" ${k.go?`onclick="${k.go}" style="cursor:pointer"`:''}>
      <div class="cdd-kpi-l">${hesc(k.label)}</div>
      <div class="cdd-kpi-v" style="${k.color?`color:${k.color}`:''}">${k.value}${k.unit?`<small>${hesc(k.unit)}</small>`:''}</div>
      ${k.foot?`<div class="cdd-kpi-f">${k.foot}</div>`:''}
    </div>`).join('')}</div>` : '';

  // Optional chart(s) rendered above the table (Chart.js config(s) supplied by the caller).
  // `d.charts` (array) renders a responsive multi-panel grid; `d.chart` (single, legacy) is
  // normalised into the same array so both call styles keep working.
  const _chartList = (d.charts && d.charts.length) ? d.charts : (d.chart ? [d.chart] : []);
  const chart = _chartList.length ? `<div class="cdd-chartgrid" style="display:grid;grid-template-columns:${_chartList.length>1?'repeat(auto-fit,minmax(300px,1fr))':'1fr'};gap:14px;align-items:start;">${_chartList.map((cc,ci)=>`
    <div class="pn cdd-chartpn"><div class="phd"><h3 class="pt">${hesc(cc.title||'Visual breakdown')}</h3>${cc.badge?`<span class="ch ch-b">${hesc(cc.badge)}</span>`:''}</div>
    <div class="pb"><div class="cbox" style="height:${cc.height||300}px"><canvas id="cdd-chart-${ci}"></canvas></div></div>
    ${cc.note?`<div style="padding:0 14px 12px;font-size:11.5px;color:var(--t3);font-family:var(--fn);">${cc.note}</div>`:''}</div>`).join('')}</div>` : '';

  // Optional free-form panels (HTML) rendered below the table.
  const extras = (d.panels||[]).map(pn=>`<div class="pn" style="margin-top:14px;"><div class="phd"><h3 class="pt">${hesc(pn.title||'')}</h3>${pn.badge?`<span class="ch ch-b">${hesc(pn.badge)}</span>`:''}</div><div class="pb">${pn.html}</div></div>`).join('');

  // Every drill-down table gets the same live filter box, regardless of what the card is
  // showing (vendors, items, projects, POs, ...) — one generic text filter that searches
  // every visible cell, rather than a bespoke filter per card. A column-scoped dropdown
  // (d.filterCol) is layered on top when the caller flags one column as the "obvious" one
  // to narrow by (BU, tier, region, etc.) — both can be used together.
  const filterColIdx = d.filterCol ? cols.findIndex(c=>c.label===d.filterCol) : -1;
  const filterOptions = filterColIdx>-1
    ? [...new Set((d.rows||[]).map(r=>(r.cells[filterColIdx]||'').replace(/<[^>]+>/g,' ').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))
    : [];
  const filterBar = totalRows ? `
      <select class="sinp cdd-filter-sel" id="cdd-col-filter" onchange="cddFilterRows()" style="${filterColIdx>-1?'':'display:none;'}max-width:170px;">
        <option value="">${hesc(d.filterCol||'All')}</option>
        ${filterOptions.map(o=>`<option value="${hesc(o)}" ${presetFilter===o?'selected':''}>${hesc(o)}</option>`).join('')}
      </select>
      <input class="sinp" id="cdd-text-filter" placeholder="Filter rows…" oninput="cddFilterRows()" style="flex:1;min-width:140px;max-width:260px;"/>` : '';

  setM(`
    <div class="shd" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <button class="btn-exp" onclick="cardDetailBack()"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Back</button>
      <h2 class="stitle">${hesc(d.title)}</h2>
      ${d.headline!=null?`<span class="ch ch-b" style="font-size:15px;padding:5px 13px;">${hesc(String(d.headline))}</span>`:''}
    </div>
    ${d.sub?`<div style="margin:-4px 0 16px;color:var(--t2);font-size:14px;font-family:var(--fn);">${d.sub}</div>`:''}
    ${kpis}
    ${d.note?`<div class="pn" style="margin-bottom:14px;"><div class="pb" style="padding:14px 18px;line-height:1.6;">${d.note}</div></div>`:''}
    ${chart}
    <div class="pn"><div class="phd" style="flex-wrap:wrap;row-gap:8px;"><h3 class="pt">${hesc(d.tableTitle||'Details')}</h3>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;">${filterBar}<span class="ch ch-b" id="cdd-row-count">${totalRows} row${totalRows===1?'':'s'}</span></div></div>
      <div class="tw"><table class="dt" id="cdd-table"><thead><tr>${head}${anyNav?'<th></th>':''}</tr></thead><tbody>${rows}</tbody></table></div>
      <div id="cdd-empty" style="display:none;text-align:center;padding:26px;color:var(--t2);font-style:italic;">No rows match this filter.</div></div>
    ${extras}
    ${anyNav?`<div style="margin:10px 2px 0;font-size:11px;color:var(--t3);font-family:var(--mono);">Tip: click any row to open its full breakdown.</div>`:''}
  `);
  _chartList.forEach((cc,ci)=>{ if(cc && cc.config) mkCh('cdd-chart-'+ci, cc.config); });
  if(d.mapInit && typeof renderVendorLocationMap==='function'){
    requestAnimationFrame(()=>renderVendorLocationMap(d.mapInit.id, d.mapInit.opts||{}));
  }
  _cddFilterColIdx = filterColIdx;
  if(presetFilter) cddFilterRows();
  scrollMainToTop();
}
// Backs openCardDetail's filter bar: re-run on every keystroke / dropdown change. Column
// index is stashed by openCardDetail itself since it's fixed for the life of that page.
let _cddFilterColIdx = -1;
function cddFilterRows(){
  const table = document.getElementById('cdd-table');
  if(!table) return;
  const textQ = (document.getElementById('cdd-text-filter')?.value||'').trim().toLowerCase();
  const colQ = document.getElementById('cdd-col-filter')?.value || '';
  const rowsEls = [...table.tBodies[0].rows];
  let shown = 0;
  rowsEls.forEach(tr=>{
    const hay = tr.textContent.toLowerCase();
    const colVal = _cddFilterColIdx>-1 ? (tr.cells[_cddFilterColIdx]?.textContent||'').trim() : '';
    const matchText = !textQ || hay.includes(textQ);
    const matchCol = !colQ || colVal===colQ;
    const show = matchText && matchCol;
    tr.style.display = show ? '' : 'none';
    if(show) shown++;
  });
  const countEl = document.getElementById('cdd-row-count');
  if(countEl) countEl.textContent = (textQ||colQ) ? `${shown} of ${rowsEls.length} row${rowsEls.length===1?'':'s'}` : `${rowsEls.length} row${rowsEls.length===1?'':'s'}`;
  const emptyEl = document.getElementById('cdd-empty');
  if(emptyEl) emptyEl.style.display = shown===0 ? '' : 'none';
  table.style.display = shown===0 ? 'none' : '';
}


function dCh(){_ch.forEach(c=>{try{c.destroy()}catch(e){}});_ch.length=0}
// Mirrors the view's own on-page title (.stitle — the one heading class every
// view renders) into the persistent #page-title <h1> and #route-announcer.
// setM() replaces #main's entire innerHTML on every navigation, which
// otherwise leaves the page with no <h1> and no signal to screen readers
// that anything changed. Reading .stitle instead of keeping a separate
// view->title map means this can't drift out of sync with what's on screen.
function announcePageTitle(m){
  const t=m.querySelector('.stitle');
  const text=t?t.textContent.trim():'';
  if(!text) return;
  const h1=document.getElementById('page-title'); if(h1) h1.textContent=text;
  const live=document.getElementById('route-announcer'); if(live) live.textContent=text;
}
function setM(h){
  dCh();
  const m=document.getElementById('main');
  // Detach before writing: mutating a disconnected node skips layout/style
  // recalc, so a big view swap costs one reflow instead of many.
  const parent=m.parentNode, next=m.nextSibling;
  if(parent) parent.removeChild(m);
  m.classList.remove('vswap');
  m.innerHTML=h;
  if(parent) parent.insertBefore(m,next);
  announcePageTitle(m);
  // rAF instead of `void m.offsetWidth` — restarts the animation with no
  // synchronous reflow.
  requestAnimationFrame(()=>m.classList.add('vswap'));
}

// Real-world land + country-border SVG paths (Natural Earth 110m, via d3-geo /
// world-atlas), pre-rendered at build time to an equirectangular projection
// (viewBox 0 0 960 500) so no mapping library is needed at runtime.
const WORLD_LAND_PATH='M321,484L319,486L303,484ZM55,482L55,482L55,482ZM359,478L364,484L345,486L336,484L350,478ZM156,466L156,466L156,466ZM145,466L145,466L145,466ZM216,462L216,462L216,462ZM297,459L296,463L282,463L292,454ZM-1,496L-1,496L-1,496L26,494L58,498L83,499L98,496L70,493L72,489L61,487L78,487L88,483L65,481L61,476L76,477L95,472L119,468L160,469L176,467L193,471L211,471L203,464L223,467L244,465L276,468L300,464L297,457L299,450L312,443L314,447L305,450L316,460L315,469L291,475L274,475L282,477L272,479L279,484L321,490L325,492L347,488L366,489L404,485L401,482L385,482L384,479L403,475L420,473L438,469L436,467L453,460L462,459L479,461L505,457L531,457L540,459L558,457L570,453L583,456L587,455L610,451L630,446L647,452L664,451L666,456L661,462L670,463L677,457L687,455L701,449L715,447L722,450L746,450L755,445L764,449L783,446L803,449L807,448L824,448L840,447L847,449L869,449L872,451L892,453L914,459L937,461L932,467L919,472L917,476L926,480L912,481L907,486L917,490L943,495L956,496L961,496L961,510L480,510L-1,510ZM299,414L306,416L298,419L290,417L297,411ZM324,406L324,406L324,406ZM668,403L668,403L668,403ZM868,379L876,379L875,385L870,386ZM942,379L945,382L932,395L926,390ZM946,367L957,371L950,380L944,376ZM926,329L926,329L926,329ZM956,316L956,316L956,316ZM961,314L959,315L959,314L961,313L961,314ZM-1,313L-1,313L-1,314L-1,314L-1,314L-1,313ZM928,314L928,314L928,314ZM926,310L926,310L926,310ZM614,306L615,311L606,337L598,337L596,329L598,324L599,313L607,309L611,302ZM863,307L868,310L871,321L888,337L890,345L888,354L881,370L871,374L856,372L853,367L843,363L839,357L831,354L817,356L810,360L795,364L787,361L789,356L783,335L785,328L803,323L808,314L819,307L823,310L833,300L846,303L842,309L852,316L856,316L861,298ZM913,298L913,298L913,298ZM802,297L802,297L802,297ZM910,296L910,296L910,296ZM912,296L912,296L912,296ZM812,297L812,297L812,297ZM795,292L795,292L795,292ZM808,292L808,292L808,292ZM907,292L907,292L907,292ZM901,290L901,290L901,290ZM770,288L776,287L789,292L786,293L761,288ZM840,287L840,287L840,287ZM896,288L896,288L896,288ZM886,285L886,285L886,285ZM820,279L820,279L820,279ZM828,278L828,278L828,278ZM889,282L889,282L889,282ZM838,273L842,279L849,275L866,280L877,294L875,297L867,290L861,295L850,290L848,284L837,279L829,273ZM814,266L812,269L801,269L809,284L797,277L803,267ZM824,267L824,267L824,267ZM763,286L754,281L743,265L735,257L740,256L757,270L763,278ZM795,265L790,281L774,278L771,271L793,251L798,256ZM817,248L815,255L810,249ZM697,253L697,253L697,253ZM317,243L317,243L317,243ZM811,243L811,243L811,243ZM796,245L796,245L796,245ZM805,238L805,238L805,238ZM815,238L815,238L815,238ZM805,235L805,235L805,235ZM804,221L807,224L805,232L801,230ZM305,221L305,221L305,221ZM275,222L275,222L275,222ZM286,217L298,220L289,222ZM775,220L775,220L775,220ZM65,219L65,219L65,219ZM63,215L63,215L63,215ZM61,213L61,213L61,213ZM59,213L59,213L59,213ZM54,211L54,211L54,211ZM267,209L282,216L272,217ZM273,207L273,207L273,207ZM804,209L804,209L804,209ZM272,199L272,199L272,199ZM274,199L274,199L274,199ZM840,179L840,179L840,179ZM572,175L572,175L572,175ZM543,175L543,175L543,175ZM521,168L520,172L513,170ZM505,160L505,160L505,160ZM856,171L855,176L830,180L831,186L826,181L834,175L842,175L852,168L855,160L859,165ZM506,157L506,157L506,157ZM864,152L869,154L858,156L859,148ZM310,146L310,146L310,146ZM315,139L315,139L315,139ZM150,140L150,140L150,140ZM330,135L339,143L322,143ZM126,126L126,126L126,126ZM864,134L863,145L859,147L861,126ZM462,130L453,132L454,126L465,124ZM514,122L514,122L514,122ZM71,117L71,117L71,117ZM472,113L474,121L481,129L481,134L465,136L468,133L470,124L464,118ZM38,110L38,110L38,110ZM268,104L268,104L268,104ZM261,103L261,103L261,103ZM21,100L21,100L21,100ZM253,95L258,99L252,102ZM441,93L444,96L430,100L415,95ZM277,91L277,91L277,91ZM611,160L611,170L624,171L621,161L626,161L614,151L622,149L617,144L605,151ZM961,96L961,96L954,97L959,102L944,105L935,110L931,108L917,110L913,124L899,134L895,122L903,115L917,107L919,103L908,108L899,106L892,110L860,112L841,124L857,128L854,141L840,154L833,154L821,164L826,172L825,176L818,178L817,169L812,163L803,166L805,161L794,167L803,172L798,177L806,185L806,190L797,204L789,209L776,213L770,212L762,219L771,229L772,239L761,247L761,244L747,234L745,243L756,257L756,267L751,263L746,250L742,248L744,239L739,225L732,227L732,221L724,209L712,213L694,228L693,242L687,249L676,227L674,213L668,214L657,202L644,203L626,199L618,196L614,189L608,190L618,206L631,203L640,210L634,219L610,233L596,236L594,225L585,213L584,210L574,195L567,193L578,211L580,220L585,227L596,237L598,242L616,238L612,252L604,262L588,277L584,287L588,299L589,309L585,315L573,323L574,335L568,338L567,346L555,358L549,361L532,363L521,342L518,329L511,315L516,302L512,283L503,273L506,262L503,257L496,259L492,253L475,257L460,258L445,249L436,238L433,231L436,227L434,214L441,200L454,190L457,181L464,175L474,176L484,172L505,170L510,181L521,184L531,189L536,183L557,188L572,187L577,174L554,172L550,165L558,160L574,158L582,161L591,156L578,149L584,144L570,148L562,146L554,156L557,160L541,162L544,168L538,172L532,159L515,148L514,152L529,162L523,169L521,163L504,152L497,155L488,155L474,172L466,174L456,172L455,155L459,153L475,154L477,147L468,140L476,140L490,132L493,128L504,126L503,117L509,126L518,126L537,123L542,112L555,111L555,108L541,110L536,103L548,96L539,94L528,102L530,110L522,120L515,122L508,111L495,114L493,105L508,98L519,89L531,84L555,80L560,83L588,89L582,94L571,92L573,98L599,92L596,87L604,88L604,92L623,86L637,86L642,83L663,88L658,80L667,75L677,87L670,93L680,89L675,79L693,77L695,73L712,73L713,69L729,67L749,66L752,64L777,65L784,69L772,72L809,75L809,73L823,75L831,81L833,78L854,79L855,75L879,77L888,81L905,81L910,85L935,83L957,85L961,86L961,96ZM-1,86L-1,86L-1,86L26,94L16,98L0,94L-1,96L-1,96L-1,86ZM225,85L225,85L225,85ZM961,80L961,81L957,80L961,79L961,80ZM-1,79L-1,79L-1,79L-1,80L-1,79ZM-1,79L-1,79L-1,79ZM238,84L247,91L252,83L263,85L263,91L251,92L239,100L228,107L227,113L234,118L260,123L263,131L270,130L267,124L276,119L270,113L271,104L283,103L294,107L299,115L308,109L315,120L327,124L331,131L320,136L303,136L290,145L302,139L308,147L320,147L305,154L301,150L293,153L293,159L285,160L278,169L278,175L262,188L266,198L263,203L256,190L241,189L241,192L227,191L220,197L219,210L228,222L238,219L239,214L248,212L243,228L258,230L256,240L263,247L268,244L275,247L278,242L288,237L289,241L315,241L313,243L327,254L339,256L350,271L364,276L373,278L386,285L386,294L376,307L374,322L368,331L356,334L351,339L349,347L333,363L324,362L328,369L322,373L314,374L314,379L306,380L311,384L300,394L305,396L295,405L298,410L290,414L280,410L278,395L281,388L285,369L289,357L293,327L292,319L277,309L263,283L266,268L274,260L269,246L266,250L251,243L246,236L236,233L227,227L222,228L204,221L198,215L197,209L180,193L178,187L174,189L188,208L174,198L167,182L159,178L150,166L147,156L147,141L152,139L140,134L122,115L87,107L71,113L57,120L40,124L59,116L43,110L36,106L51,97L40,98L31,95L41,92L38,88L48,82L62,79L73,81L97,83L115,86L138,82L176,87L177,89L197,86L201,88L227,88L222,83L226,78ZM175,75L183,77L199,76L201,80L210,83L206,86L197,85L177,87L161,79ZM201,74L201,74L201,74ZM276,75L276,75L276,75ZM249,75L260,73L264,78L272,76L296,82L296,86L315,91L309,96L302,93L306,103L296,100L296,104L272,96L282,95L284,88L269,83L263,84L243,82L239,77ZM212,73L220,73L217,80L206,76ZM863,74L863,74L863,74ZM231,76L228,72L238,73ZM158,79L144,78L146,72L166,72L172,74ZM883,69L883,69L883,69ZM230,70L230,70L230,70ZM867,68L851,71L847,67ZM217,65L218,70L206,66ZM191,67L196,70L180,71L181,69L166,69L172,66L189,68ZM634,81L618,79L629,70L643,66L662,65L662,66L644,69L628,77ZM227,64L242,68L263,68L261,71L233,70ZM170,63L160,67L152,67ZM229,63L229,63L229,63ZM186,63L186,63L186,63ZM546,62L546,62L546,62ZM187,60L187,60L187,60ZM224,62L224,62L224,62ZM213,61L213,61L213,61ZM761,61L746,62L750,58ZM529,57L526,65L508,57ZM548,55L549,58L534,58L526,56ZM617,55L617,55L617,55ZM747,59L729,58L723,55L736,53L748,57ZM248,57L242,61L232,61L222,56L233,53ZM297,48L315,50L290,57L275,58L279,60L265,67L241,66L253,58L235,51L268,48ZM408,47L424,49L395,50L418,53L438,51L447,53L433,56L427,60L431,64L428,72L415,76L422,81L412,79L410,82L420,83L406,87L395,88L389,92L374,95L366,103L364,110L351,107L342,100L336,91L344,83L337,85L331,79L334,76L324,68L316,67L297,67L285,61L305,58L298,56L327,51L355,49L386,47Z';

// ---- Real-geography world map for the Vendor Location panels ------------------
// Built from actual Natural Earth land shapes (see WORLD_LAND_PATH above), projected
// and heavily simplified once at build time — a full-detail coastline/border mesh was
// tried first but made the panel noticeably laggy to paint on every re-render, so this
// keeps only the ~1000 points that matter at dashboard scale (not a schematic drawing,
// just a simplified real one).
// One function builds both the compact overview version and the bigger "full scale"
// version on the detail page (same paths, same badge anchors, just bigger/more labels).
function _worldBadge(cx, cy, r, color, count, label, full){
  const fs = full ? 15 : 12, lfs = full ? 10.5 : 8.5, lY = cy + r + (full ? 17 : 12);
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="${full?3:2}"/>
    <text x="${cx}" y="${cy+fs*0.35}" text-anchor="middle" class="vpd-region-badge" style="font-size:${fs}px">${count}</text>
    <text x="${cx}" y="${lY}" text-anchor="middle" class="vpd-region-label" style="font-size:${lfs}px">${label}</text>`;
}
