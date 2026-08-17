/* ============================================================
 * 90-reports-and-modals.js
 * Evaluation scope (H1/H2/Both), report modal, Excel export
 * ------------------------------------------------------------
 * Part of the Acme Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */
/* ========================================================================
 * EVALUATION SCOPE  — H1 | H2 | Both
 * ------------------------------------------------------------------------
 * activeQuarter stays the single half you EDIT (ratings are always entered
 * into one concrete half). ratingScope decides what the METRICS aggregate:
 *   'single' -> just the active half (unchanged behaviour)
 *   'both'   -> H1 and H2 combined; every parameter is the average of
 *               whichever halves have a value, so scores, matrices, charts
 *               and reports all recompute across both halves at once.
 *
 * In 'both' mode we merge the two stored halves into the in-memory
 * itemRatings / vendorRatings that every metric already reads, so no
 * downstream metric code needs to change. Editing is disabled in this mode
 * and persistRatings() refuses to write, protecting the real per-half data.
 * ==================================================================== */


// Label used in headers/badges for whatever is currently in view.
function scopeLabel() { return activeQuarter; }

// Per-quarter category meta (buyer/approver/status) for one item, keyed by stableKey.
function getQuarterMetaForItem(stableItemKey, quarterStr) {
  if (!quarterStr) return {};
  const cm = _lsParsed(`lnt_categoryMeta_${quarterStr}`);
  return cm[stableItemKey] || {};
}

(function injectReportModal() {
  if (document.getElementById('report-modal')) return;
  const m = document.createElement('div');
  m.id = 'report-modal';
  m.style.cssText = 'display:none;position:fixed;inset:0;z-index:1002;background:rgba(16,24,40,.45);backdrop-filter:blur(3px);align-items:center;justify-content:center;overflow-y:auto;padding:30px 0;';
  m.innerHTML = `<div id="report-modal-inner" style="background:#f6f7f8;border:1px solid #a3aab1;border-radius:2px;width:92%;max-width:560px;box-shadow:0 14px 30px -12px rgba(15,18,22,.42);"></div>`;
  document.body.appendChild(m);
})();


// REPORT MODAL & MULTI-SELECT CHECKBOX UI


// Global listener to close dropdowns when clicking outside
if (!window._msListenerAdded) {
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.ms-container')) {
      document.querySelectorAll('[id^="ms-drop-"]').forEach(el => el.style.display = 'none');
    }
  });
  window._msListenerAdded = true;
}

window.toggleMS = function(id) {
  const drop = document.getElementById(`ms-drop-${id}`);
  const isShowing = drop.style.display === 'block';
  document.querySelectorAll('[id^="ms-drop-"]').forEach(el => el.style.display = 'none');
  if (!isShowing) drop.style.display = 'block';
};

window.updateMS = function(id) {
  const chks = document.querySelectorAll(`.ms-chk-${id}:checked`);
  const lbl = document.getElementById(`ms-lbl-${id}`);
  if (chks.length === 0) {
    lbl.textContent = 'All';
    lbl.title = '';
    lbl.style.color = 'var(--t4)';
  } else if (chks.length === 1) {
    lbl.textContent = chks[0].value;
    lbl.title = chks[0].value;
    lbl.style.color = 'var(--txt)';
  } else {
    lbl.textContent = `${chks.length} selected`;
    lbl.style.color = 'var(--txt)';
  }
};

window.filterMS = function(id, q) {
  q = q.toLowerCase();
  const labels = document.querySelectorAll(`#ms-opts-${id} label`);
  labels.forEach(lbl => {
    const txt = lbl.textContent.toLowerCase();
    lbl.style.display = txt.includes(q) ? 'flex' : 'none';
  });
};

window.clearMS = function(id) {
  document.querySelectorAll(`.ms-chk-${id}`).forEach(cb => cb.checked = false);
  updateMS(id);
};

window.openReportModal = function() {
  const items = all();

  const uniq = (field) => [...new Set(items.map(i => i[field]).filter(v => v && String(v).trim().length > 0))].sort();
  const uBU   = uniq('bu');
  const uJob  = uniq('jobCode');
  const uJobD = uniq('jobDesc'); 
  const uPO   = uniq('poNum');
  const uVen  = uniq('vendor');
  const uVenN = uniq('vendorName');

  // New Custom Multi-Select UI Widget
  const multiSelectField = (label, id, options) => `
    <div style="position:relative;" class="ms-container" id="ms-wrap-${id}">
      <label style="font-size:11px;font-weight:600;color:#667085;text-transform:uppercase;letter-spacing:.4px;">${label}</label>
      
      <div class="sinp" style="width:100%;margin-top:4px;min-height:33px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--brd2);border-radius:var(--r);padding:6px 10px;" onclick="toggleMS('${id}')">
        <span id="ms-lbl-${id}" style="color:var(--t4);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px;">All</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style="flex-shrink:0;"><path fill="#6b7891" d="M0 0l5 6 5-6z"/></svg>
      </div>
      
      <div id="ms-drop-${id}" onclick="event.stopPropagation()" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1px solid var(--brd2);border-radius:var(--r);max-height:240px;overflow-y:auto;z-index:9999;box-shadow:var(--shadow-md);padding:4px;flex-direction:column;">
        <div style="padding:4px 4px 8px 4px;position:sticky;top:0;background:#fff;z-index:2;border-bottom:1px solid var(--brd);display:flex;gap:6px;">
          <input type="text" placeholder="Search..." style="flex:1;padding:6px 8px;font-size:12px;border:1px solid var(--brd2);border-radius:4px;outline:none;" oninput="filterMS('${id}', this.value)">
          <button type="button" onclick="clearMS('${id}')" style="background:var(--s2);border:1px solid var(--brd2);border-radius:4px;padding:0 8px;font-size:11px;cursor:pointer;color:var(--t3);">Clear</button>
        </div>
        <div id="ms-opts-${id}" style="padding-top:4px;">
          ${options.length === 0 ? `<div style="padding:6px;font-size:11px;color:var(--t4);text-align:center;">No data available</div>` : ''}
          ${options.map(o => `
          <label class="ms-opt" style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;font-size:12px;cursor:pointer;border-radius:4px;color:var(--txt);word-break:normal;overflow-wrap:break-word;text-wrap:pretty;margin-bottom:2px;" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='transparent'">
              <input type="checkbox" value="${hesc(o)}" class="ms-chk-${id}" onchange="updateMS('${id}')" style="margin-top:2px;cursor:pointer;"> 
              ${hesc(o)}
          </label>
          `).join('')}
        </div>
      </div>
    </div>`;

  const readonlyField = (label, inputId, value) => `
    <div>
      <label style="font-size:11px;font-weight:600;color:#667085;text-transform:uppercase;letter-spacing:.4px;">${label}</label>
      <input class="sinp" id="${inputId}" value="${hesc(value)}" readonly style="width:100%;margin-top:4px;background:#f4f6f9;color:#667085;">
    </div>`;

  document.getElementById('report-modal-inner').innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #bcc1c6;background:#edeff1;">
      <div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#14171a;">Download Rating Report</div>
        <div style="font-size:12px;color:#5e656d;margin-top:3px;">Select multiple items by checking the boxes in the dropdowns</div>
      </div>
      <button type="button" class="modal-x-close" onclick="document.getElementById('report-modal').style.display='none'">×</button>
    </div>
    <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px;">
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${readonlyField('IC', 'rpt-ic', 'Renewables')}
        ${multiSelectField('BU', 'rpt-bu', uBU)}
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${multiSelectField('Job Code', 'rpt-jobcode', uJob)}
        ${multiSelectField('Job Desc', 'rpt-jobdesc', uJobD)}
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${multiSelectField('PO Number', 'rpt-ponum', uPO)}
        ${multiSelectField('Vendor Code', 'rpt-vendor', uVen)}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${multiSelectField('Vendor Name', 'rpt-vendorname', uVenN)}
      </div>

    </div>
    <div style="padding:14px 20px;border-top:1px solid #bcc1c6;display:flex;gap:8px;justify-content:flex-end;">
      <button type="button" onclick="document.getElementById('report-modal').style.display='none'" style="padding:8px 16px;border-radius:2px;border:1px solid #a3aab1;background:#fff;color:#3c424a;font-size:13px;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Cancel</button>
      <button type="button" onclick="generateReport()" style="padding:8px 18px;border-radius:2px;border:1px solid #0072bc;background:#0072bc;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.5px;">Download Report</button>
    </div>
  `;

  document.getElementById('report-modal').style.display = 'flex';
};

window.generateReport = function() {
  const items = all();
  if (!items.length) { toast('No data loaded', 'err'); return; }
  if (typeof XLSX === 'undefined' || !XLSX.writeFile) { toast('Excel export unavailable in this build', 'err'); return; }

  const getChecked = (id) => Array.from(document.querySelectorAll(`.ms-chk-${id}:checked`)).map(cb => cb.value.trim().toLowerCase());

  const fBU   = getChecked('rpt-bu');
  const fJob  = getChecked('rpt-jobcode');
  const fJobD = getChecked('rpt-jobdesc');
  const fPO   = getChecked('rpt-ponum');
  const fVen  = getChecked('rpt-vendor');
  const fVenN = getChecked('rpt-vendorname');
  const matchAny = (arr, val) => arr.length === 0 || arr.some(f => (val || '').toLowerCase().trim() === f);

  const filtered = items.filter(i =>
    matchAny(fBU, i.bu) && matchAny(fJob, i.jobCode) && matchAny(fJobD, i.jobDesc) &&
    matchAny(fPO, i.poNum) && matchAny(fVen, i.vendor) && matchAny(fVenN, i.vendorName)
  );

  if (!filtered.length) { toast('No items match the filters', 'err'); return; }

  const QUARTERS = ['H1','H2'];
  const catShort = REPORT_CATS.map(c => c.label.split('|')[0].trim()); // SCM, EDRC, Product Quality, Operation
  const FIELDS = ['Score','Status','Buyer','Approver','Remarks'];
  const nInfo = 10;                 // fixed info columns
  const nCat  = REPORT_CATS.length; // 4
  const nField = FIELDS.length;     // 4
  const perQ  = nCat * nField + 1;  // per category block (4 fields) x nCat + Final Score

  // Row 1: top header — info, one group per quarter, Overall Avg
  const h1 = ['IC','BU','Job Code','Job Description','Vendor Code','Vendor Name',
               'PO Number','PO Date','Order Amount','Currency'];
  QUARTERS.forEach(q => { h1.push(q); for (let i = 1; i < perQ; i++) h1.push(''); });
  h1.push('Overall Avg');

  // Row 2: sub-header — per quarter, "<Cat> Score/Status/Buyer/Approver" then Final Score
  const h2 = Array(nInfo).fill('');
  QUARTERS.forEach(() => {
    REPORT_CATS.forEach((c, ci) => FIELDS.forEach(f => h2.push(`${catShort[ci]} ${f}`)));
    h2.push('Final Score');
  });
  h2.push('');

  // per-item, per-quarter category data: score (gated by status) + status + buyer + approver
  function getQ(sk, q) {
    const rtgs = getQuarterRatingsForItem(sk, q);
    const meta = getQuarterMetaForItem(sk, q);
    if (!Object.keys(rtgs).length && !Object.keys(meta).length) return null;
    const cats = REPORT_CATS.map(c => {
      const m  = meta[c.id] || {};
      const st = (m.status || '').trim();
      // eligible mirrors categoryScoreEligible() / itemScoreBreakdown() (80-view-scorecard.js):
      // a category only feeds the weighted Final Score once its STATUS is actually recorded
      // (Approved or Changed and Approved) — a blank/Pending or NA status must NOT count
      // as a hard 0, or a single un-approved category silently tanks the whole PO's score.
      // The raw `score` is still shown/exported either way, same as the Scorecard/PDF report,
      // so the reader can see what the evaluator entered even before it's approved.
      const eligible = (st.toLowerCase() === 'approved' || st.toLowerCase() === 'changed and approved'
                        || st.toLowerCase() === 'not approved and changed');   // pre-rename wording
      return {
        score:    calcCategoryScore(c.id, rtgs),
        eligible,
        status:   st || '—',
        buyer:    (m.buyer || '').trim() || '—',
        approver: (m.approver || '').trim() || '—',
        remarks:  (m.remarks || '').trim() || '—'
      };
    });
    const final = calcWeightedVendorScoreFromCategories(cats.map(x => x.eligible ? x.score : null));
    return { cats, final };
  }

  const dataRows = filtered.map(item => {
    const sk = stableKey(item);
    const row = [
      'Renewables', item.bu || '', item.jobCode || '', item.jobDesc || item.item || '',
      item.vendor || '', item.vendorName || '', item.poNum || '', item.poDate || '',
      item.poVal || '', item.currency || ''
    ];
    const finals = [];
    QUARTERS.forEach(q => {
      const s = getQ(sk, q);
      if (s) {
        s.cats.forEach(c => row.push(c.score, c.status, c.buyer, c.approver, c.remarks));
        row.push(s.final);
        finals.push(s.final);
      } else {
        for (let i = 0; i < perQ; i++) row.push('');
      }
    });
    // Overall Avg = average of quarters that have data
    row.push(finals.length ? Number((finals.reduce((a,b) => a+b, 0) / finals.length).toFixed(1)) : '');
    return row;
  });

  // Build sheet
  const wsData = [h1, h2, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Number format: only numeric Score/Final cells (text status/buyer/approver are skipped)
  const totalCols = nInfo + QUARTERS.length * perQ + 1;
  for (let r = 2; r < wsData.length; r++) {
    for (let c = nInfo; c < totalCols; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'number') cell.z = '0.0';
    }
  }

  // Merges: info cols span both header rows; each quarter group spans perQ cols; Overall Avg spans both rows
  ws['!merges'] = [];
  for (let c = 0; c < nInfo; c++) ws['!merges'].push({ s: {r:0,c}, e: {r:1,c} });
  QUARTERS.forEach((_, qi) => {
    const start = nInfo + qi * perQ;
    ws['!merges'].push({ s: {r:0,c:start}, e: {r:0,c:start + perQ - 1} });
  });
  ws['!merges'].push({ s: {r:0,c:totalCols-1}, e: {r:1,c:totalCols-1} });

  // Column widths
  const fieldW = { Score:9, Status:22, Buyer:16, Approver:16, Remarks:26 };
  const qWidths = [];
  QUARTERS.forEach(() => {
    REPORT_CATS.forEach(() => FIELDS.forEach(f => qWidths.push({ wch: fieldW[f] })));
    qWidths.push({ wch:11 });   // Final Score
  });
  ws['!cols'] = [
    {wch:12},{wch:22},{wch:14},{wch:40},{wch:18},{wch:32},{wch:20},{wch:12},{wch:14},{wch:8},
    ...qWidths,
    {wch:14}
  ];

  const wb_new = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb_new, ws, 'Vendor Ratings');

  const timestamp = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb_new, `Vendor_Rating_Report_${timestamp}.xlsx`);

  document.getElementById('report-modal').style.display = 'none';
  toast('Report downloaded ✓', 'ok');
};






window.saveRating = function(key, val) {
  const parsed = parseInt(val);
  if(activeRatingKey){
    if(!itemRatings[activeRatingKey]) itemRatings[activeRatingKey] = {};
    itemRatings[activeRatingKey][key] = parsed;
  } else {
    vendorRatings[key] = parsed;
  }
  persistRatings();

  const pct = Math.round(parsed * 20);
  const lbl = document.getElementById(`lbl_${key}`);

  if (lbl) {
    lbl.textContent = `${val} Stars (${pct}%)`;
    lbl.className = `pill pill-${val>=4?'g':val>=3?'b':val>=2?'a':'r'}`;
  }

  for (let i = 1; i <= 5; i++) {
    const star = document.getElementById(`star_${key}_${i}`);
    if (star) {
      if (i <= val) {
        star.setAttribute('fill', '#0072bc');
        star.setAttribute('stroke', '#0072bc');
      } else {
        star.setAttribute('fill', 'none');
        star.setAttribute('stroke', '#b9bfc5');
      }
    }
  }
};


/* mobile nav drawer: hamburger opens the sidebar; backdrop or a nav click closes it */
(function(){
  var t=document.getElementById('navToggle'), bd=document.getElementById('navBackdrop'), sb=document.getElementById('sidebar');
  if(t) t.addEventListener('click', function(){ document.body.classList.toggle('nav-open'); });
  if(bd) bd.addEventListener('click', function(){ document.body.classList.remove('nav-open'); });
  if(sb) sb.addEventListener('click', function(e){ if(e.target.closest('.nav')) document.body.classList.remove('nav-open'); });
})();
