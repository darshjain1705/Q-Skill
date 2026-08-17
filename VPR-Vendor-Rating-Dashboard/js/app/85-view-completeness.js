/* ============================================================
 * 85-view-completeness.js
 * Rating Completeness page
 * ------------------------------------------------------------
 * Part of the Acme Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */
let _compQuery = '';
let _compStatusFilter = '';
function rCompleteness() {
  const a = all();
  if (!a.length) {
    setM(`
      <div class="shd"><h2 class="stitle">Rating Completeness</h2></div>
      <div class="pn"><div class="pb"><div class="empty">
        No tracker data loaded. Upload a PO report to see which vendors still need rating.
        <div style="margin-top:16px;"><button class="btn1" onclick="goHome()" style="margin-top:0;">Upload Excel</button></div>
      </div></div></div>`);
    return;
  }

  const groups = groupItemsByVendor(a);

  // Every count on this page is per PURCHASE ORDER, not per raw tracker line — a PO with
  // more than one ITEM row (or one that shows up more than once across sheets) must still
  // only count once. Items with no PO number at all have nothing to dedupe against, so
  // they're kept as their own line.
  const dedupeByPO = items => {
    const seen = new Set(), out = [];
    items.forEach(it => {
      const po = String(it.poNum || '').trim();
      if (!po) { out.push(it); return; }
      if (seen.has(po)) return;
      seen.add(po); out.push(it);
    });
    return out;
  };
  const aPO = dedupeByPO(a);   // portfolio-wide unique-PO list, used for every headline count below

  // global item-level counters
  let gFilled = 0, gTotal = 0, iFull = 0, iProgress = 0, iNotStarted = 0, iApproved = 0, iPending = 0;

  const vendors = Object.values(groups).map(g => {
    let filled = 0, total = 0, ratedItems = 0, fullItems = 0, approvedItems = 0;
    let rateableItems = 0; // POs NOT fully NA (Option A: all-NA POs excluded)
    const catAgg = {}; LNT_MATRIX.forEach(c => catAgg[c.id] = { filled: 0, total: 0, rated: 0, done: 0, units: 0 });
    dedupeByPO(g.items).forEach(it => {
      const comp = itemCompleteness(stableKey(it));
      // Option A: if ALL categories are NA across every in-scope half, exclude this
      // PO entirely from Completeness totals — it is not applicable for the period.
      if (comp.allCatsNA) return;
      rateableItems++;
      filled += comp.filled; total += comp.total;
      if (comp.rated) ratedItems++;
      if (comp.full) fullItems++;
      if (comp.rated && comp.approvedCats === LNT_MATRIX.length) approvedItems++;
      LNT_MATRIX.forEach(c => {
        catAgg[c.id].filled += comp.cat[c.id].filled;
        catAgg[c.id].total  += comp.cat[c.id].total;
        catAgg[c.id].rated  += comp.cat[c.id].ratedUnits;
        catAgg[c.id].done   += comp.cat[c.id].doneUnits;
        catAgg[c.id].units  += comp.cat[c.id].units;
      });
    });
    const n = rateableItems; // PO count excludes all-NA POs
    const pct = total ? Math.round(filled / total * 100) : 0;
    let status;
    if (n === 0) status = 'notstarted';          // all POs for this vendor are NA
    else if (ratedItems === 0) status = 'notstarted';
    else if (filled === total && approvedItems === n) status = 'complete';
    else if (filled === total) status = 'pending';
    else status = 'progress';
    return { code: g.code, name: g.name, n, filled, total, pct, ratedItems, fullItems, approvedItems, catAgg, status };
  });

  const order = { progress: 0, pending: 1, notstarted: 2, complete: 3 };
  vendors.sort((x, y) => (order[x.status] - order[y.status]) || (x.pct - y.pct) ||
    (x.name || x.code || '').localeCompare(y.name || y.code || ''));

  // The portfolio-wide "Fully Rated / Awaiting Approval / Approved" counts are one PO's
  // completeness, once each — summing them straight out of the per-vendor loop above
  // would double back to counting a shared/duplicate PO more than once, so they're
  // recomputed here directly off aPO instead of accumulated inside that loop.
  aPO.forEach(it => {
    const comp = itemCompleteness(stableKey(it));
    if (comp.allCatsNA) return;
    gFilled += comp.filled; gTotal += comp.total;
    if (!comp.rated) { iNotStarted++; }
    else if (comp.full) { iFull++; if (comp.approvedCats === LNT_MATRIX.length) iApproved++; else iPending++; }
    else { iProgress++; }
  });

  const gPct = gTotal ? Math.round(gFilled / gTotal * 100) : 0;
  const itemsTotal = aPO.length;

  // ---- Clickable-card drill-down data for the KPI cards on this page ----
  const _statusMeta = { complete:{t:'Approved',c:'var(--grn)'}, pending:{t:'Awaiting approval',c:'var(--amb)'}, progress:{t:'In progress',c:'var(--acc)'}, notstarted:{t:'Not started',c:'var(--red)'} };
  const _pill = s => { const m=_statusMeta[s]||{t:s,c:'var(--t2)'}; return `<span style="font-family:var(--mono);font-size:12.5px;font-weight:600;color:${m.c};">${m.t}</span>`; };
  const _mono = x => `<span style="font-family:var(--mono);">${hesc(x||'—')}</span>`;
  const _itemCols = [{label:'Vendor'},{label:'Code'},{label:'Item / Job'},{label:'Filled',align:'right'}];
  const _fully=[], _await=[], _appr=[];
  aPO.forEach(it=>{
    const c = itemCompleteness(stableKey(it));
    if(!c.full) return;
    const rec = { code:(it.vendor||'').trim(), cells:[
      `<strong>${hesc(it.vendorName||it.vendor||'—')}</strong>`, _mono(it.vendor),
      hesc(it.jobDesc||it.item||it.poNum||'—'), `${c.filled}/${c.total}` ] };
    _fully.push(rec);
    if(c.approvedCats===LNT_MATRIX.length) _appr.push(rec); else _await.push(rec);
  });
  const _venRows = vendors.map(v=>({ code:v.code, cells:[
    `<strong>${hesc(v.name||v.code)}</strong>`, _mono(v.code), String(v.n), `${v.pct}%`, _pill(v.status) ] }));
  const _allItemRows = aPO.map(it=>({ code:(it.vendor||'').trim(), cells:[
    `<strong>${hesc(it.vendorName||it.vendor||'—')}</strong>`, _mono(it.vendor),
    hesc(it.jobDesc||it.item||'—'), _mono(it.poNum) ] }));
  const _catSum = LNT_MATRIX.map(c=>{ let f=0,t=0; vendors.forEach(v=>{ f+=v.catAgg[c.id].filled; t+=v.catAgg[c.id].total; }); return { name:c.name, f, t, p:t?Math.round(f/t*100):0 }; });
  setCardData('comp_vendors', { back:'completeness', title:'Vendors in Tracker', headline:vendors.length, sub:'Every vendor in the tracker with its rating progress. Click a row to open that vendor.', tableTitle:'All vendors',
    filterCol:'Status',
    columns:[{label:'Vendor'},{label:'Code'},{label:'Items',align:'right'},{label:'Filled',align:'right'},{label:'Status'}], rows:_venRows });
  setCardData('comp_items', { back:'completeness', title:'POs', headline:itemsTotal, sub:'Every distinct Purchase Order in the current period.', tableTitle:'All POs',
    columns:[{label:'Vendor'},{label:'Code'},{label:'Item / Job'},{label:'PO Number'}], rows:_allItemRows });
  setCardData('comp_filled', { back:'completeness', title:'Overall Filled', headline:gPct+'%', sub:`${gFilled} of ${gTotal} rating parameters filled across all vendors.`, tableTitle:'Filled by category',
    note:`<div style="font-size:14px;">Overall parameter completion is <b>${gPct}%</b> — <b>${gFilled}</b> filled out of <b>${gTotal}</b> parameters across the four categories.</div>`,
    columns:[{label:'Category'},{label:'Filled',align:'right'},{label:'Total',align:'right'},{label:'Filled %',align:'right'}],
    rows:_catSum.map(c=>({ cells:[`<strong>${hesc(c.name)}</strong>`, String(c.f), String(c.t), `${c.p}%`] })) });
  setCardData('comp_fully', { back:'completeness', title:'Fully Rated POs', headline:iFull, sub:'POs where every rating parameter has been filled in.', tableTitle:'Fully rated POs', columns:_itemCols, rows:_fully });
  setCardData('comp_await', { back:'completeness', title:'Awaiting Approval', headline:iPending, sub:'Fully rated, but at least one of the four teams (SCM / EDRC / Quality / Operation) still has a blank STATUS.', tableTitle:'Awaiting approval', columns:_itemCols, rows:_await });
  setCardData('comp_approved', { back:'completeness', title:'Approved', headline:iApproved, sub:'Fully rated, and STATUS recorded (Approved / Changed / NA) by all four teams.', tableTitle:'Approved POs', columns:_itemCols, rows:_appr });

  /* The half-year selector lives in ONE place: the H1 / H2 / Both control in the
     top bar. Each view used to carry its own copy, which drifted out of sync with
     the header (and this page's copy was missing "Both" entirely, so Completeness
     could never show the combined view). Kept as an empty string so the render
     templates below are untouched. */
  const quarterSelector = '';

  const kpi = (label, value, sub, cls, key) => `
    <div class="kpi${key?' kpi-click':''}"${key?` onclick="openCardDetail('${key}')" title="View full details"`:''}>
      <div class="kl">${label}</div>
      <div class="kv ${cls||''}">${value}</div>
      <div class="ks">${sub||''}</div>
    </div>`;

  // Shows fill progress FIRST — "9/15" parameters actually scored — since that's what
  // blocks a vendor's completion %, with the approval sub-status (STATUS set or not)
  // directly underneath rather than hidden behind a hover tooltip. Used to show only
  // the approval fraction ("1/1"), which stayed green even when a category was, say,
  // 9 of 15 parameters filled in under an "Approved" status — so nothing in the row
  // revealed which category was actually holding a vendor back from 100%.
  const catCell = (cf) => {
    if (!cf.units) return `<div style="min-width:80px;color:var(--t4);font-size:11px;">—<div class="rp" style="margin-top:2px;">not on this sheet</div></div>`;
    const allNA = cf.total === 0;   // every in-scope half for this vendor/category was marked NA
    const fillPct = allNA ? 100 : Math.round(cf.filled / cf.total * 100);
    const apprDone = cf.done === cf.units;
    const color = fillPct === 100 ? (apprDone ? 'var(--grn)' : 'var(--amb)') : (fillPct > 0 ? 'var(--amb)' : 'var(--t4)');
    const fillLabel = allNA ? 'N/A' : `${cf.filled}/${cf.total}`;
    const apprLabel = allNA ? 'Excluded (N/A)' : apprDone ? 'Approved' : cf.done > 0 ? `${cf.done}/${cf.units} approved` : 'Awaiting approval';
    const tip = `${cf.filled}/${cf.total} parameter scores filled · ${cf.done}/${cf.units} PO(s) through approval (STATUS set) · ${cf.rated}/${cf.units} rated by the evaluator`;
    return `<div style="min-width:80px;" title="${tip}">
      <div style="font-family:var(--mono);font-size:11.5px;font-weight:600;color:${color};">${fillLabel}</div>
      <div style="height:4px;background:var(--s4);border:1px solid var(--brd);overflow:hidden;margin-top:3px;"><div style="height:100%;width:${fillPct}%;background:${color};"></div></div>
      <div style="font-size:9.5px;color:var(--t3);margin-top:2px;white-space:nowrap;">${apprLabel}</div>
    </div>`;
  };

  const rows = vendors.map(v => {
    const [scls, slabel] = COMP_STATUS[v.status];
    const bar = v.pct === 100 ? 'var(--grn)' : v.pct > 0 ? 'var(--amb)' : 'var(--brd2)';
    const k = `${v.name||''} ${v.code||''}`.toLowerCase();
    return `
      <tr data-k="${hesc(k)}" data-status="${v.status}" style="cursor:pointer;" onclick="rateVendorFromCompleteness('${esc(v.code)}','${esc(v.name)}')" title="Click to rate this vendor">
        <td><strong>${hesc(v.name || v.code || 'TBD')}</strong>${v.code && v.name ? `<div class="rp">${vendorCodeDisplay(v.code)}</div>` : ''}</td>
        <td style="text-align:center;font-family:var(--mono);">${v.n}</td>
        <td style="min-width:150px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="flex:1;height:6px;background:var(--s4);border:1px solid var(--brd);overflow:hidden;"><div style="height:100%;width:${v.pct}%;background:${bar};"></div></div>
            <span style="font-family:var(--mono);font-size:11.5px;font-weight:600;color:var(--t2);width:34px;text-align:right;">${v.pct}%</span>
          </div>
          <div class="rp" style="margin-top:3px;">${v.fullItems}/${v.n} items fully rated</div>
        </td>
        <td>${catCell(v.catAgg.scm)}</td>
        <td>${catCell(v.catAgg.edrc)}</td>
        <td>${catCell(v.catAgg.quality)}</td>
        <td>${catCell(v.catAgg.operation)}</td>
        <td style="text-align:center;font-family:var(--mono);font-size:11.5px;color:${v.approvedItems===v.n&&v.ratedItems>0?'var(--grn)':'var(--t3)'};">${v.approvedItems}/${v.n}</td>
        <td><span class="pill ${scls}">${slabel}</span></td>
      </tr>`;
  }).join('');

  // ---- status filter chips (mirrors the KPI cards, same pattern as Team Workload) ----
  const compStatusCounts = { progress:0, pending:0, notstarted:0, complete:0 };
  vendors.forEach(v => compStatusCounts[v.status]++);
  const compChipColor = { progress:'#9a6a07', pending:'#1a73e8', notstarted:'#a82f1c', complete:'#1e7d34' };
  const compChip = (k) => {
    const [,label] = COMP_STATUS[k]; const c = compChipColor[k]; const n = compStatusCounts[k];
    return `<button class="pgb" onclick="compSetStatusFilter('${k}')" style="${_compStatusFilter===k?`background:${c};color:#fff;border-color:${c};`:`color:${c};border-color:${c}66;`}font-weight:600">${label} · ${n}</button>`;
  };
  const compChips = `<div class="tc" style="gap:8px;flex-wrap:wrap;align-items:center;">
    <span style="font-family:var(--hd);font-size:11px;letter-spacing:.8px;color:var(--t3);text-transform:uppercase">Show</span>
    <button class="pgb" onclick="compSetStatusFilter('')" style="${!_compStatusFilter?'background:var(--acc);color:#fff;border-color:var(--acc);':''}font-weight:600">All · ${vendors.length}</button>
    ${compChip('progress')}${compChip('pending')}${compChip('notstarted')}${compChip('complete')}
  </div>`;

  setM(`
    <div class="shd" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <h2 class="stitle">Rating Completeness</h2>
        <span class="ch ch-p">${scopeLabel()}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        ${quarterSelector}
        <button class="btn-exp" onclick="openPrintPicker()">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print / PDF
        </button>
      </div>
    </div>

    <div class="kg">
      ${kpi('Vendors', vendors.length, 'in tracker', null, 'comp_vendors')}
      ${kpi('POs', itemsTotal, 'distinct purchase orders', null, 'comp_items')}
      ${kpi('Overall Filled', gPct + '%', `${gFilled} of ${gTotal} parameters`, gPct===100?'cg':gPct>0?'ca':'cm', 'comp_filled')}
      ${kpi('Fully Rated POs', iFull, `of ${itemsTotal} · ${iProgress} in progress · ${iNotStarted} not started`, iFull?'cg':'cm', 'comp_fully')}
      ${kpi('Awaiting Approval', iPending, 'rated, at least one team\u2019s STATUS still blank', iPending?'ca':'cm', 'comp_await')}
      ${kpi('Approved', iApproved, 'all 4 teams\u2019 STATUS recorded', iApproved?'cg':'cm', 'comp_approved')}
    </div>

    <div class="pn">
      <div class="phd" style="flex-wrap:wrap;gap:10px;">
        <h3 class="pt">Vendor Progress</h3>
        <div class="tc">
          <input class="sinp" placeholder="Filter vendor…" value="${hesc(_compQuery)}" oninput="compFilterD(this.value)" style="min-width:180px;"/>
          <span class="pgi">${vendors.length} vendor${vendors.length===1?'':'s'}</span>
        </div>
      </div>
      <div class="pb" style="padding-bottom:8px;padding-top:10px;">${compChips}</div>
      <div class="tw">
        <table class="dt">
          <thead><tr>
            <th>Vendor</th><th style="text-align:center;">POs</th><th>Completion</th>
            <th>SCM<br><span style="font-weight:400;text-transform:none;letter-spacing:0;">30% weight</span></th>
            <th>EDRC<br><span style="font-weight:400;text-transform:none;letter-spacing:0;">25% weight</span></th>
            <th>Quality<br><span style="font-weight:400;text-transform:none;letter-spacing:0;">25% weight</span></th>
            <th>Operation<br><span style="font-weight:400;text-transform:none;letter-spacing:0;">20% weight</span></th>
            <th style="text-align:center;">Approved</th><th>Status</th>
          </tr></thead>
          <tbody id="comp-body">${rows}</tbody>
        </table>
      </div>
    </div>

    <div style="font-size:11.5px;color:var(--t3);padding:2px 4px;line-height:1.6;">
      Tip: click any vendor row to open the scorecard filtered to that vendor. Hover a team's cell for the raw PO counts behind it.
      Each <strong>SCM / EDRC / Quality / Operation</strong> cell shows two things: the bold fraction is <strong>parameter fill progress</strong> (e.g. "9/15" — how many rating fields are actually filled in, which is what drives the Completion % on the left), and the small line underneath is <strong>approval progress</strong> (whether STATUS has been typed in — Approved, Changed and Approved, or NA). A category can show 100% filled and still say "Awaiting approval" if the evaluator has finished but that team's approver hasn't set STATUS yet.
      A PO only counts as <strong>Approved</strong> once <strong>all four teams</strong> have their STATUS column filled in — one team left blank keeps the whole PO at <strong>Awaiting Approval</strong>, regardless of how many parameters are filled or how far along the approver's own review is.
    </div>
  `);
  // Re-apply the persisted search text + status filter to the freshly-rendered rows —
  // setM() just built them all visible; without this, clicking a status chip updated
  // its own highlighted/active look but never actually hid the non-matching rows.
  compFilter();
}

function compFilter(q){
  if (q !== undefined) _compQuery = (q||'').toLowerCase().trim();
  document.querySelectorAll('#comp-body tr').forEach(tr => {
    const okQ = !_compQuery || (tr.dataset.k||'').includes(_compQuery);
    const okS = !_compStatusFilter || tr.dataset.status === _compStatusFilter;
    tr.style.display = (okQ && okS) ? '' : 'none';
  });
}
function compSetStatusFilter(s){
  _compStatusFilter = (_compStatusFilter === s) ? '' : s;
  rCompleteness();
}

function rateVendorFromCompleteness(code, name){
  activeVendorForRating = code || '';
  activeVendorNameForRating = code ? '' : (name || '');
  activeJobCodeForRating = '';
  activeJobDescForRating = '';
  activePOForRating = '';
  activeItemForRating = '';        // clear the item filter too, or the drill-down shows 0 matches
  scorecardMatchPage = 1;
  scorecardMatchFilterKey = '';
  go('scorecard');
}

// Vendors that will actually appear in the printed report — those with at least one PO
// rated in H1 or H2 (mirrors printVendorReport's own inclusion test).
function printableVendors() {
  const groups = groupItemsByVendor(all());
  const out = [];
  Object.values(groups).forEach(g => {
    const hasRating = g.items.some(it =>
      itemScoreBreakdown(stableKey(it), 'H1') || itemScoreBreakdown(stableKey(it), 'H2'));
    if (hasRating) out.push({ code: g.code || '', name: g.name || '' });
  });
  return out.sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || ''));
}

// Print / PDF entry point. Lets the user print every rated vendor or pick a single vendor
// (categorised vendor-wise) before opening the browser print dialog.
function openPrintPicker() {
  if (!all().length) { toast('No data to print', 'err'); return; }
  const vends = printableVendors();
  if (!vends.length) { toast('No rated vendors in H1 or H2 to print', 'err'); return; }

  let modal = document.getElementById('print-picker-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'print-picker-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:1003;background:rgba(16,24,40,.45);backdrop-filter:blur(3px);align-items:center;justify-content:center;';
    modal.onclick = e => { if (e.target.id === 'print-picker-modal') modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }

  const rows = vends.map(v => `
    <button type="button" onclick="printVendorReport('${esc(v.code)}')"
      style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:9px 12px;border:1px solid var(--brd2);background:var(--s1);border-radius:2px;cursor:pointer;font-family:var(--fn);">
      <span style="min-width:0;">
        <span style="display:block;font-size:12.5px;font-weight:600;color:var(--navy);word-break:normal;overflow-wrap:break-word;text-wrap:pretty;">${hesc(v.name || v.code)}</span>
        ${v.name && v.code ? `<span style="display:block;font-family:var(--mono);font-size:10px;color:var(--t3);word-break:normal;overflow-wrap:normal;">${wbrCode(vendorCodeDisplay(v.code))}</span>` : ''}
      </span>
      <span style="font-size:11px;color:var(--acc);font-family:var(--hd);font-weight:600;white-space:nowrap;">Print &rarr;</span>
    </button>`).join('');

  modal.innerHTML = `
    <div style="background:var(--s2);border:1px solid var(--brd2);border-radius:2px;width:92%;max-width:460px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 14px 30px -12px rgba(15,18,22,.42);overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--brd2);">
        <div>
          <div style="font-family:var(--hd);font-size:17px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--navy);">Print Vendor Report</div>
          <div style="font-size:11px;color:var(--t2);font-family:var(--mono);margin-top:2px;">${vends.length} rated vendor${vends.length===1?'':'s'} · H1 &amp; H2</div>
        </div>
        <button type="button" class="modal-x-close" onclick="document.getElementById('print-picker-modal').style.display='none'">&times;</button>
      </div>
      <div style="padding:12px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;">
        <button type="button" onclick="printVendorReport()"
          style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:11px 12px;border:1px solid var(--btn-solid-bg);background:var(--btn-solid-bg);color:var(--btn-solid-fg);border-radius:2px;cursor:pointer;font-family:var(--fn);">
          <span style="font-family:var(--hd);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">All Vendors</span>
          <span style="font-size:11px;font-family:var(--hd);font-weight:600;white-space:nowrap;">Print all ${vends.length} &rarr;</span>
        </button>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--t2);font-family:var(--hd);font-weight:600;margin:4px 0 -2px;">Or a single vendor</div>
        ${rows}
      </div>
    </div>`;
  modal.style.display = 'flex';
}

// Build a clean, one-page-per-vendor printable report into #print-root, then open the
// browser print dialog (which doubles as "Save as PDF"). Only vendors with at least one
// rated PO in the active half-year are included.
// filterCode (optional): restrict the report to a single vendor code. Omit for all vendors.
function printVendorReport(filterCode) {
  const picker = document.getElementById('print-picker-modal');
  if (picker) picker.style.display = 'none';
  const a = all();
  if (!a.length) { toast('No data to print', 'err'); return; }
  const HALVES = ['H1', 'H2'];
  const fc = (filterCode || '').trim().toLowerCase();
  let groups = groupItemsByVendor(a);
  if (fc) {
    groups = Object.fromEntries(Object.entries(groups).filter(([, g]) => (g.code || '').trim().toLowerCase() === fc));
  }

  const tierOf = (s) => s >= 80 ? 'Preferred Partner' : s >= 50 ? 'Tier 2 / Moderate' : 'High Risk Review';
  const col = (s) => s >= 80 ? '#3f6d2c' : s >= 50 ? '#9a6a07' : '#a82f1c';
  const mean = (arr) => arr.length ? +(arr.reduce((s,v) => s+v, 0) / arr.length).toFixed(1) : null;
  const genDate = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const TH = 'padding:6px 8px;border:1px solid #bcc1c6;font-family:var(--hd);font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;';
  const TD = 'padding:5px 8px;border:1px solid #bcc1c6;';

  const pages = [];
  Object.values(groups)
    .sort((x,y) => (x.name||x.code||'').localeCompare(y.name||y.code||''))
    .forEach(g => {
      // For each PO collect a breakdown per half-year (null when that half is unrated).
      const perPO = g.items.map(it => ({
        it,
        halves: HALVES.map(h => ({ h, b: itemScoreBreakdown(stableKey(it), h) })).filter(x => x.b)
      })).filter(x => x.halves.length);
      if (!perPO.length) return;

      const h1finals = [], h2finals = [], flatB = [];
      perPO.forEach(x => x.halves.forEach(({h,b}) => { (h==='H1'?h1finals:h2finals).push(b.final); flatB.push(b); }));
      const h1avg = mean(h1finals), h2avg = mean(h2finals);
      const overall = mean([h1avg, h2avg].filter(v => v != null));

      const cell = (b,id) => {
        const c = b.cats.find(x => x.id === id);
        if (!c) return `<td style="${TD}text-align:center;font-family:var(--mono);color:#9a9fa5;">—</td>`;
        // A category still Pending approval shows as such rather than a numeric score —
        // this is a formal printed rating document, and c.score here is the evaluator's
        // provisional number, not yet a finished figure. b.final (below) already excludes
        // it from the weighted average via itemScoreBreakdown()'s eligible check.
        if (!c.eligible) {
          const label = isNAStatus(c.status) ? 'N/A' : 'Pending';
          return `<td style="${TD}text-align:center;font-family:var(--mono);font-size:9.5px;color:#9a6a07;">${label}</td>`;
        }
        return `<td style="${TD}text-align:center;font-family:var(--mono);color:${col(c.score)};">${(c.score||0).toFixed(1)}</td>`;
      };
      const itemRows = perPO.map(({it, halves}) =>
        halves.map(({h,b}, ri) => `<tr>
          ${ri===0 ? `<td style="${TD}font-family:var(--mono);" rowspan="${halves.length}">${hesc(it.poNum || '—')}</td><td style="${TD}" rowspan="${halves.length}">${hesc(it.jobDesc || it.item || '—')}</td>` : ''}
          <td style="${TD}text-align:center;font-family:var(--hd);font-weight:700;">${h}</td>
          ${cell(b,'scm')}${cell(b,'edrc')}${cell(b,'quality')}${cell(b,'operation')}
          <td style="${TD}text-align:center;font-family:var(--mono);font-weight:700;color:${col(b.final)};">${b.final.toFixed(1)}</td>
        </tr>`).join('')
      ).join('');

      // Representative sign-off per category (first half/PO that carries values).
      const metaRows = REPORT_CATS.map(rc => {
        let st='—', by='—', ap='—';
        for (const b of flatB) {
          const c = b.cats.find(x => x.id === rc.id);
          if (c && (c.status || c.buyer || c.approver)) { st = c.status||'Pending'; by = c.buyer||'—'; ap = c.approver||'—'; break; }
        }
        // Remarks are per-PO commentary, not a vendor-level constant like status/buyer/
        // approver tend to be - picking just the first PO/half's entry (like above) would
        // silently drop every other PO's remark whenever the first happened to be blank.
        // Collect every distinct non-blank remark this team left across all of this
        // vendor's rated POs/halves instead.
        const remarksList = [];
        flatB.forEach(b => {
          const c = b.cats.find(x => x.id === rc.id);
          if (c && c.remarks && !remarksList.includes(c.remarks)) remarksList.push(c.remarks);
        });
        const rm = remarksList.length ? remarksList.join(' · ') : '—';
        return `<tr><td style="${TD}">${hesc(rc.label)}</td><td style="${TD}">${hesc(st)}</td><td style="${TD}">${hesc(by)}</td><td style="${TD}">${hesc(ap)}</td><td style="${TD}">${hesc(rm)}</td></tr>`;
      }).join('');
      const repNote = flatB.length > 1 ? ' <span style="font-weight:400;color:#888f97;text-transform:none;letter-spacing:0;">(representative · first rated half)</span>' : '';

      const splitBits = [];
      if (h1avg != null) splitBits.push(`H1 <strong style="color:${col(h1avg)};">${h1avg.toFixed(1)}%</strong>`);
      if (h2avg != null) splitBits.push(`H2 <strong style="color:${col(h2avg)};">${h2avg.toFixed(1)}%</strong>`);

      pages.push(`
        <section class="pv-page" style="font-family:var(--fn);color:#191c1f;padding-bottom:6mm;">
          <div class="pv-keep" style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #14171a;padding-bottom:8px;margin-bottom:14px;">
            <div>
              <div style="font-family:var(--hd);font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#0072bc;">Acme Renewable Energy</div>
              <div style="font-family:var(--hd);font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">Vendor Rating Report</div>
            </div>
            <div style="text-align:right;font-size:11px;color:#5e656d;font-family:var(--mono);line-height:1.7;">
              Half-Years: <strong style="color:#191c1f;">H1 &amp; H2</strong><br>Generated: ${genDate}
            </div>
          </div>

          <div class="pv-keep" style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;gap:16px;">
            <div>
              <div style="font-family:var(--hd);font-size:20px;font-weight:700;text-transform:uppercase;">${hesc(g.name || g.code || 'TBD')}</div>
              <div style="font-size:12px;color:#5e656d;font-family:var(--mono);margin-top:2px;">Vendor Code: ${hesc(g.code || '—')} · ${perPO.length} PO${perPO.length===1?'':'s'} evaluated</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:34px;font-weight:700;line-height:1;color:${col(overall)};">${overall.toFixed(1)}%</div>
              <div style="font-size:11px;color:#5e656d;text-transform:uppercase;letter-spacing:.5px;margin-top:2px;">${tierOf(overall)} · overall</div>
              ${splitBits.length ? `<div style="font-size:11px;color:#5e656d;font-family:var(--mono);margin-top:3px;">${splitBits.join(' &nbsp;·&nbsp; ')}</div>` : ''}
            </div>
          </div>

          <table style="width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:16px;">
            <thead><tr style="background:#e3e6e9;">
              <th style="${TH}text-align:left;">PO Number</th>
              <th style="${TH}text-align:left;">Job Description</th>
              <th style="${TH}">Half</th>
              <th style="${TH}">SCM<br>30%</th><th style="${TH}">EDRC<br>25%</th>
              <th style="${TH}">Quality<br>25%</th><th style="${TH}">Operation<br>20%</th>
              <th style="${TH}">Final</th>
            </tr></thead>
            <tbody>${itemRows}</tbody>
          </table>

          <div class="pv-keep">
            <div style="font-family:var(--hd);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Category Sign-off${repNote}</div>
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead><tr style="background:#e3e6e9;">
                <th style="${TH}text-align:left;">Category</th><th style="${TH}text-align:left;">Status</th>
                <th style="${TH}text-align:left;">Buyer</th><th style="${TH}text-align:left;">Approver</th>
                <th style="${TH}text-align:left;">Remarks</th>
              </tr></thead>
              <tbody>${metaRows}</tbody>
            </table>
          </div>

          <div style="margin-top:14px;font-size:9.5px;color:#888f97;border-top:1px solid #bcc1c6;padding-top:6px;line-height:1.5;">
            Scores are weighted ratings (SCM 30% · EDRC 25% · Product Quality 25% · Operation 20%), computed from rated parameters. Overall = average of the rated half-years (H1, H2). Generated from the Acme Procurement Control dashboard.
          </div>
        </section>`);
    });

  if (!pages.length) { toast(fc ? 'This vendor has no H1/H2 ratings to print' : 'No rated vendors in H1 or H2 to print', 'err'); return; }

  document.getElementById('print-root').innerHTML = pages.join('');
  toast(`Preparing ${pages.length} vendor page${pages.length===1?'':'s'}…`, 'ok');
  // Let the DOM paint before opening the print dialog.
  setTimeout(() => { window.print(); }, 80);
}

function clrScorecardFilters(){
  activeVendorForRating='';
  activeVendorNameForRating='';
  activeJobCodeForRating='';
  activeJobDescForRating='';
  activePOForRating='';
  activeItemForRating='';
  scorecardMatchPage=1;
  scorecardMatchFilterKey='';
  const elIds=['sc-ven','sc-ven-name','sc-job-code','sc-job-desc','sc-po','sc-item'];
  elIds.forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
  updateScorecardFilters();
}

function scorecardPage(delta){
  scorecardMatchPage += delta;
  updateScorecardFilters();
}

function updateScorecardFilters(){
  const a = all();
  const jobCodeFilter = (document.getElementById('sc-job-code')?.value || '').toLowerCase();
  const jobDescFilter = (document.getElementById('sc-job-desc')?.value || '').toLowerCase();
  const vendorFilter = (document.getElementById('sc-ven')?.value || '').toLowerCase();
  const vendorNameFilter = (document.getElementById('sc-ven-name')?.value || '').toLowerCase();
  const poFilter = (document.getElementById('sc-po')?.value || '').toLowerCase();
  const itemFilter = (document.getElementById('sc-item')?.value || '').toLowerCase();
  const filterKey = [jobCodeFilter, jobDescFilter, vendorFilter, vendorNameFilter, poFilter, itemFilter].join('|');
  if(filterKey !== scorecardMatchFilterKey){
    scorecardMatchFilterKey = filterKey;
    scorecardMatchPage = 1;
  }
  const matches = a.filter(i => {
    const itemCodeText = (i.jobCode||'').toLowerCase();
    const itemDescText = (i.jobDesc||'').toLowerCase();
    // Item name(s) for this PO across every half in scope (H1, H2, or both).
    const itemName = itemsForScopePO(i.poNum).join(' | ').toLowerCase();
    return (!jobCodeFilter || itemCodeText.includes(jobCodeFilter))
      && (!jobDescFilter || itemDescText.includes(jobDescFilter))
      && (!vendorFilter || (i.vendor||'').toLowerCase().includes(vendorFilter))
      && (!vendorNameFilter || (i.vendorName||'').toLowerCase().includes(vendorNameFilter))
      && (!poFilter || (i.poNum||'').toLowerCase().includes(poFilter))
      && (!itemFilter || itemName.includes(itemFilter));
  });
  const body = document.getElementById('score-match-body');
  const count = document.getElementById('score-match-count');
  const pager = document.getElementById('score-match-pager');
  const pageSize = 40;
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  scorecardMatchPage = Math.min(Math.max(scorecardMatchPage, 1), totalPages);
  const start = (scorecardMatchPage - 1) * pageSize;
  const pageItems = matches.slice(start, start + pageSize);
    if(body){
    const rows = pageItems.map(i=>{
      const key = stableKey(i);
      const jd = i.jobDesc || i.item || '—';
      const itemNm = itemCellHTML(i.poNum);
      return `<tr><td style="white-space:nowrap;font-weight:600;color:var(--navy,#1a3a5c);">${itemNm}</td><td title="${hesc(jd)}" style="min-width:240px;"><strong>${hesc(jd)}</strong></td><td style="font-family:var(--mono);color:var(--t3);white-space:nowrap;">${hesc(i.jobCode||'—')}</td><td style="white-space:nowrap;">${hesc(i.vendor||'TBD')}</td><td>${hesc(i.vendorName||'—')}</td><td style="font-family:var(--mono);color:var(--txt);white-space:nowrap;">${hesc(i.poNum||'—')}</td><td style="white-space:nowrap;"><button class="pgb" onclick="gotoRatingItem('${esc(key)}')" style="padding:4px 8px;">Go</button></td></tr>`;
    }).join('');
    body.innerHTML = rows || `<tr><td colspan="7" style="color:var(--t3);font-size:11px;">No matched items found.</td></tr>`;
  }
  if(pager){
    const from = matches.length ? start + 1 : 0;
    const to = Math.min(start + pageSize, matches.length);
    pager.innerHTML = `
      <span class="pgi">Showing ${from}-${to} of ${matches.length} matched items</span>
      <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
        <button class="pgb" onclick="scorecardPage(-1)" ${scorecardMatchPage<=1?'disabled':''}>Prev</button>
        <span class="pgi">Page ${scorecardMatchPage} of ${totalPages}</span>
        <button class="pgb" onclick="scorecardPage(1)" ${scorecardMatchPage>=totalPages?'disabled':''}>Next</button>
      </div>
    `;
  }
  if(count) count.textContent = `${matches.length} item${matches.length===1?'':'s'} matched`;
}

window.rCategoryDetail = function(catId) {
  if (!activeRatingKey) {
    rScorecard();
    return;
  }
  const cat = LNT_MATRIX.find(c => c.id === catId);
  const ratings = getRatingSet();
  const weightPerParam = (cat.w / cat.params.length).toFixed(2);
  const catRemark = getCategoryRemark(catId);
  const catMeta = getCategoryMeta(catId);

  // Overall Remarks: prefer manually-entered remark; fall back to Excel REMARKS column.
  // The Excel value (catMeta.remarks) is read-only display — typing in the textarea
  // saves to the manual store (categoryRemarks) which then takes priority.
  const excelRemark = (catMeta.remarks || '').trim();
  const hasManualRemark = catRemark && catRemark.trim().length > 0;
  const displayRemark = hasManualRemark ? catRemark : excelRemark;
  const fromExcel = !hasManualRemark && excelRemark.length > 0;

  const parameterRows = cat.params.map((p, i) => {
    const key = `${cat.id}_${i}`;
    const currentVal = ratings[key] ?? 0;
    const pct = Math.round(currentVal * 20);

    const starsHtml = [1, 2, 3, 4, 5].map(starNum => {
      const isFilled = starNum <= currentVal;
      const color = isFilled ? '#0072bc' : '#b9bfc5';
      const fill = isFilled ? color : 'none';
      return `<svg id="star_${key}_${starNum}" onclick="saveRating('${key}', ${starNum})" viewBox="0 0 24 24" width="24" height="24" stroke="${color}" stroke-width="2" fill="${fill}" style="cursor:pointer; transition:all 0.15s; margin-right:4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" style="pointer-events:none;"/></svg>`;
    }).join('');

    return `
      <div style="padding:16px;background:var(--s2);border:1px solid var(--brd);border-radius:8px;margin-bottom:10px;display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;">
          <div style="flex:1;min-width:200px;">
            <span style="font-size:13px;color:var(--txt);font-weight:500;">${i+1}. ${p}</span>
            <div style="color:var(--t3);font-size:10px;font-family:var(--mono);margin-top:4px;">Weight: ${weightPerParam}%</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="display:flex;">${starsHtml}</div>
            <span id="lbl_${key}" class="pill pill-${currentVal>=4?'g':currentVal>=3?'b':currentVal>=2?'a':'r'}" style="min-width:100px;justify-content:center;">${currentVal} Stars (${pct}%)</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  setM(`
    <div class="shd">
      <div style="display:flex;align-items:center;gap:12px;">
        <button class="pgb" onclick="rScorecard()" style="padding:4px 10px;display:flex;align-items:center;gap:4px;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back to Matrix
        </button>
        <h2 class="stitle">${cat.name}</h2>
      </div>
      <span class="ch ch-p">${cat.w}% Total Weight</span>
    </div>

    <div class="pn" style="margin-bottom:16px;">
      <div class="phd"><h3 class="pt">Buyer &amp; Approver — ${cat.name}</h3><span style="font-size:11px;color:var(--t3);font-family:var(--mono);">manual · per category · ${scopeLabel()}</span></div>
      <div class="pb" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;">
        <div>
          <div class="kl">Buyer</div>
          <input class="sinp" style="width:100%;margin-top:4px;" placeholder="Buyer name…" value="${hesc(catMeta.buyer||'')}" oninput="setCategoryMetaField('${catId}','buyer',this.value)"/>
        </div>
        <div>
          <div class="kl">Approver</div>
          <input class="sinp" style="width:100%;margin-top:4px;" placeholder="Approver name…" value="${hesc(catMeta.approver||'')}" oninput="setCategoryMetaField('${catId}','approver',this.value)"/>
        </div>
        <div>
          <div class="kl">Approval Status</div>
          <select class="sinp" style="width:100%;margin-top:4px;" onchange="setCategoryMetaField('${catId}','status',this.value)">
            <option value="" ${!catMeta.status?'selected':''}>— Pending —</option>
            <option value="Approved" ${/^approved$/i.test(catMeta.status||'')?'selected':''}>Approved</option>
            <option value="Changed and Approved" ${/^(changed and approved|not approved and changed)$/i.test(catMeta.status||'')?'selected':''}>Changed and Approved</option>
            <option value="NA" ${isNAStatus(catMeta.status||'')?'selected':''}>NA — Not Applicable this quarter</option>
          </select>
        </div>
      </div>
    </div>

    <div class="pn">
      <div class="phd">
        <h3 class="pt">Rate Parameters</h3>
        <span style="font-size:11px;color:var(--t3);font-family:var(--mono);">1★=20% | 3★=60% | 5★=100%</span>
      </div>
      <div class="pb" style="max-height:60vh;overflow-y:auto;">
        ${parameterRows}
      </div>
    </div>

    <div class="pn" style="margin-top:16px;">
      <div class="phd">
        <h3 class="pt">Overall Remarks — ${cat.name}</h3>
        ${fromExcel
          ? `<span style="font-size:10.5px;font-family:var(--mono);color:var(--t3);background:var(--s4);border:1px solid var(--brd2);padding:2px 8px;border-radius:2px;">📥 From Excel — edit to override</span>`
          : hasManualRemark
            ? `<span style="font-size:10.5px;font-family:var(--mono);color:var(--t3);background:var(--s4);border:1px solid var(--brd2);padding:2px 8px;border-radius:2px;">✏️ Manually entered</span>`
            : ''}
      </div>
      <div class="pb">
        <textarea id="cat-remark-${catId}"
          placeholder="Add an overall remark for this category…"
          oninput="setCategoryRemark('${catId}', this.value)"
          style="width:100%;min-height:80px;padding:10px 12px;border-radius:8px;border:1px solid var(--brd2);background:var(--s3);color:var(--txt);font-family:var(--fn);font-size:13px;resize:vertical;outline:none;line-height:1.6;"
        >${hesc(displayRemark)}</textarea>
        ${fromExcel ? `<div style="margin-top:5px;font-size:11px;color:var(--t3);font-family:var(--mono);">Imported from the Excel REMARKS column. Start typing above to save your own remark — it will take priority from then on.</div>` : ''}
      </div>
    </div>
  `);
}



window.saveRatingsJSON = function() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const exportData = {
    exportedAt: new Date().toISOString(),
    appVersion: 'Acme Vendor Scorecard v1',
    vendorRatings: vendorRatings,
    itemRatings: {}
  };

  const items = all();
  for (const [ratingKey, ratings] of Object.entries(itemRatings)) {
    const matchedItem = items.find(it => stableKey(it) === ratingKey);

    exportData.itemRatings[ratingKey] = {
      metadata: matchedItem ? {
        jobCode: matchedItem.jobCode || '',
        vendorCode: matchedItem.vendor || '',
        vendorName: matchedItem.vendorName || '',
        poNumber: matchedItem.poNum || '',
        item: matchedItem.item || '',
        sheet: matchedItem.sheet || ''
      } : {},
      ratings: ratings,
      overallScore: (function() {
        let total = 0, wTotal = 0;
        LNT_MATRIX.forEach(cat => {
          let t = 0, ct = 0;
          cat.params.forEach((_, i) => {
            const v = ratings[`${cat.id}_${i}`];
            if (v != null && v !== '') { t += Number(v); ct++; }
          });
          if (ct) {
            total += cat.w * (t / ct / 5);
            wTotal += cat.w;
          }
        });
        if (!wTotal) return 0;
        return parseFloat((total * (100 / wTotal)).toFixed(2));
      })()
    };
  }

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vendor-ratings-${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  toast('Ratings saved as JSON ✓', 'ok');
}

const REPORT_CATS = [
  { id: 'scm',       label: 'SCM | Order Handling & Administration' },
  { id: 'edrc',      label: 'EDRC | Engineering' },
  { id: 'quality',   label: 'Product Quality' },
  { id: 'operation', label: 'Operation | Deliveries' }
];

function calcCategoryScore(catId, ratingsObj) {
  const cat = LNT_MATRIX.find(c => c.id === catId);
  if (!cat) return null;
  let total = 0, count = 0;
  cat.params.forEach((_, i) => {
    const v = ratingsObj[`${catId}_${i}`];
    if (v != null && v !== '') { total += Number(v); count++; }
  });
  return count ? Number(((total / count / 5) * 100).toFixed(1)) : null;
}

function calcWeightedVendorScoreFromCategories(categoryScores) {
  let total = 0, wTotal = 0;
  REPORT_CATS.forEach((reportCat, idx) => {
    const cat = LNT_MATRIX.find(c => c.id === reportCat.id);
    const val = categoryScores[idx];
    if (cat && val != null) {
      total += Number(val) * (cat.w / 100);
      wTotal += cat.w;
    }
  });
  if (!wTotal) return 0;
  return Number((total / (wTotal / 100)).toFixed(1));
}

/* ── Parsed-blob cache for the per-item rating stores ────────────────────
   getQuarterRatingsForItem / getQuarterMetaForItem are called twice per item
   inside the completeness and scorecard loops. Each call was doing a
   synchronous appStorage.getItem() plus a full JSON.parse() of the WHOLE
   ratings blob — ~500 reads and ~500 parses to render one 250-item view,
   which was the single largest cost in a view switch (~286ms).

   The blob only changes when something writes it, so parse once and keep the
   object. Invalidation is wired into appStorage.setItem/removeItem/clear
   below, which means it cannot go stale no matter which code path writes —
   including the copy-quarter and import paths.                          */
const _lsCache = new Map();
function _lsParsed(key){
  if (_lsCache.has(key)) return _lsCache.get(key);
  let obj = {};
  try {
    const raw = appStorage.getItem(key);
    obj = raw ? (JSON.parse(raw) || {}) : {};
  } catch(e) { obj = {}; }
  _lsCache.set(key, obj);
  return obj;
}
function invalidateLsCache(key){
  if (key === undefined) _lsCache.clear();
  else _lsCache.delete(key);
}

function itemCompleteness(sk, q) {
  const halves = q ? [q] : scopePeriods();
  const po = (String(sk).match(/^po:([^|]+)\|/) || [])[1] || '';
  let filled = 0, total = 0;
  const cat = {};
  // ratedUnits / units count EVALUATIONS (this line × each half in scope) rather than
  // parameters, so the per-team columns can read "SCM rated 1/2 POs".
  // _naCount tracks how many halves in scope have STATUS = "NA" for this category.
  // Option A: if ALL halves for a category are NA, exclude its params from the total/filled
  // counts entirely and auto-credit it so it doesn't block the overall approval gate.
  LNT_MATRIX.forEach(c => cat[c.id] = { filled:0, total:0, status:'', credited:false, ratedUnits:0, doneUnits:0, units:0, _ok:0, _n:0, _naCount:0 });
  halves.forEach(h => {
    const irMap = _lsParsed(`lnt_itemRatings_${h}`);
    const cmMap = _lsParsed(`lnt_categoryMeta_${h}`);
    const prMap = _lsParsed(`lnt_evalProgress_${h}`);
    const rtgs = (po && _byPoIndexCached(irMap)[po]) || irMap[sk] || {};
    const meta = (po && _byPoIndexCached(cmMap)[po]) || cmMap[sk] || {};
    const prog = (po && _byPoIndexCached(prMap)[po]) || prMap[sk] || null;
    LNT_MATRIX.forEach(c => {
      const k = cat[c.id];
      const status = String((meta[c.id] || {}).status || '').trim();
      const isNA = isNAStatus(status);
      // Whether the approver has actually typed something into the STATUS cell is the
      // ONLY signal that counts as "done" here — by explicit rule, a PO stays Pending
      // until every one of the four teams has filled in STATUS, full stop. An approver
      // having entered score numbers without ever setting STATUS (apprFilled, tracked by
      // the importer) is real review activity worth surfacing elsewhere as "closer to
      // done", but it is NOT the same thing as STATUS being recorded, and must not make a
      // vendor look domain-complete / "Evaluated" while its own PO rows still show
      // "Pending" everywhere else on the dashboard.
      const hasStatus = status !== '';
      // The team owes this line an evaluation only if the PO appears on its sheet.
      const onSheet = !!meta[c.id];
      if (onSheet) {
        k.units++;
        const scoredHere = c.params.some((_, i) => {
          const v = rtgs[`${c.id}_${i}`]; return v != null && v !== '';
        });
        if (prog ? !!prog[c.id] : scoredHere) k.ratedUnits++;
        // "Done" (approval-based) counts a PO the moment STATUS carries ANY value —
        // Approved, Changed and Approved (approver's own scores), NA, or a written
        // not-applicable reason. Only a genuinely blank STATUS means this half is
        // still sitting in the approver's queue. This is deliberately separate from
        // ratedUnits above: a PO can be fully scored by the evaluator (ratedUnits)
        // while STATUS is still blank (doneUnits) — that gap IS "awaiting approval".
        if (hasStatus) k.doneUnits++;
      }
      // Option A: NA status → exclude this category's parameters from total/filled
      // so they don't inflate the denominator or look like unrated slots.
      if (onSheet && !isNA) {
        c.params.forEach((_, i) => {
          total++; k.total++;
          const v = rtgs[`${c.id}_${i}`];
          if (v != null && v !== '') { filled++; k.filled++; }
        });
      }
      k._n++;
      if (isNA) k._naCount++;
      if (/^approved$/i.test(status)) k._ok++;
      if (status) k.status = status;
    });
  });
  let approvedCats = 0;
  LNT_MATRIX.forEach(c => {
    const k = cat[c.id];
    // Credited = every in-scope half for this category has STATUS set — the row has
    // been through the approval step, whatever the outcome (Approved / Changed /
    // NA / a written reason). NA no longer needs special-case auto-crediting: it is
    // just one of the values that makes doneUnits === units true.
    k.credited = k.units === 0 || (k.units > 0 && k.doneUnits === k.units);
    if (k.credited) approvedCats++;
  });
  // allCatsNA: true when every single category across every in-scope half is marked NA.
  // Used by rCompleteness() to fully exclude the item from counts (Option A).
  const allCatsNA = LNT_MATRIX.every(c => {
    const k = cat[c.id];
    return k._naCount > 0 && k._naCount === k._n;
  });
  return { filled, total, cat, approvedCats, rated: filled > 0, full: total > 0 && filled === total, allCatsNA };
}

(function patchStorageWrites(){
  if (typeof Storage === 'undefined' || Storage.prototype.__lntPatched) return;
  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
  const clear = Storage.prototype.clear;
  Storage.prototype.setItem = function(k, v){
    try { invalidateLsCache(k); } catch(e) {}
    return setItem.call(this, k, v);
  };
  Storage.prototype.removeItem = function(k){
    try { invalidateLsCache(k); } catch(e) {}
    return removeItem.call(this, k);
  };
  Storage.prototype.clear = function(){
    try { invalidateLsCache(); } catch(e) {}
    return clear.call(this);
  };
  Storage.prototype.__lntPatched = true;
})();
// Another tab writing the same keys must not leave this one stale.
window.addEventListener('storage', e => invalidateLsCache(e.key || undefined));

function getQuarterRatingsForItem(stableItemKey, quarterStr) {
  if (!quarterStr) return {};
  const ir = _lsParsed(`lnt_itemRatings_${quarterStr}`);
  return ir[stableItemKey] || {};
}

