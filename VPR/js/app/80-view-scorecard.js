/* ============================================================
 * 80-view-scorecard.js
 * Vendor Scorecard: filters, matched items, rating entry
 * ------------------------------------------------------------
 * Part of the L&T Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */
function rScorecard() {
  initRatings();
  const a = all();
  const activeItem = activeRatingKey ? a.find(i => stableKey(i) === activeRatingKey) : null;
  const ratings = getRatingSet();
  RAW_ITEMS = [...new Set(a.map(i => i.item).filter(v => v && v.length > 0))].sort();
  RAW_VENDORS = [...new Set(a.map(i => i.vendor).filter(v => v && v.length > 2))].sort();
  RAW_POS = [...new Set(a.map(i => i.poNum).filter(v => v && v.length > 0))].sort();
  const uItems = [...new Set(a.map(i => i.item).filter(v => v && v.length > 0))].sort();
  const uJobCodes = [...new Set(a.map(i => i.jobCode).filter(v => v && v.length > 0))].sort();
  const uJobDescs = [...new Set(a.map(i => i.jobDesc).filter(v => v && v.length > 0))].sort();
  // Item options for the ITEM filter — items entered for the active reporting period.
  // Fall back to every recorded item name if none resolve for this period (e.g. before
  // the user has filled the ITEM column in for the current H1/H2).
  let uScItems = [...new Set(a.flatMap(i => itemsForScopePO(i.poNum)).filter(v => v && v.length > 0))].sort();
  if (uScItems.length === 0) uScItems = [...new Set(Object.values(PO_ITEM_MAP).filter(v => v && v.length > 0))].sort();
  const uVen = RAW_VENDORS;
  const uVendorNames = [...new Set(a.map(i => i.vendorName).filter(v => v && v.length > 0))].sort();
  const uPOs = RAW_POS;

  const scoreItems = a.filter(i => {
    const itemCode = (i.jobCode || '').toLowerCase();
    const itemDesc = (i.jobDesc || '').toLowerCase();
    const vendorCode = (i.vendor || '').toLowerCase();
    const vendorName = (i.vendorName || '').toLowerCase();
    const po = (i.poNum || '').toLowerCase();
    const itemName = itemsForScopePO(i.poNum).join(' | ').toLowerCase();
    return (!activeJobCodeForRating || itemCode.includes(activeJobCodeForRating.toLowerCase()))
      && (!activeJobDescForRating || itemDesc.includes(activeJobDescForRating.toLowerCase()))
      && (!activeVendorForRating || vendorCode.includes(activeVendorForRating.toLowerCase()))
      && (!activeVendorNameForRating || vendorName.includes(activeVendorNameForRating.toLowerCase()))
      && (!activePOForRating || po.includes(activePOForRating.toLowerCase()))
      && (!activeItemForRating || itemName.includes(activeItemForRating.toLowerCase()));
  });

  function calcScore(rtgs) {
    let s = 0, wTotal = 0;
    LNT_MATRIX.forEach(cat => {
      let total = 0, count = 0;
      cat.params.forEach((_, i) => {
        const v = rtgs[`${cat.id}_${i}`];
        if (v != null && v !== '') { total += Number(v); count++; }
      });
      if (count) {
        s += cat.w * (total / count / 5);   // unrated params excluded (match Excel)
        wTotal += cat.w;
      }
    });
    if (!wTotal) return 0;
    return parseFloat((s * (100 / wTotal)).toFixed(1));
  }

  let totalScore = calcScore(ratings);

  // Per-quarter score comparison
  const quarterScores = ['H1','H2'].map(q => {
    let qRatings = {};
    try {
      if (activeRatingKey) {
        if (q === activeQuarter) {
          qRatings = itemRatings[activeRatingKey] || {};
        } else {
          const stored = appStorage.getItem(`lnt_itemRatings_${q}`);
          const ir = stored ? JSON.parse(stored) : {};
          qRatings = ir[activeRatingKey] || {};
        }
      } else {
        if (q === activeQuarter) {
          qRatings = vendorRatings;
        } else {
          const stored = appStorage.getItem(`lnt_vendorRatings_${q}`);
          qRatings = stored ? JSON.parse(stored) : {};
        }
      }
    } catch(e) { qRatings = {}; }
    if (!hasSavedRatingValues(qRatings)) return null;
    return { q, score: calcScore(qRatings) };
  }).filter(Boolean);

  /* The half-year selector lives in ONE place: the H1 / H2 / Both control in the
     top bar. Each view used to carry its own copy, which drifted out of sync with
     the header (and this page's copy was missing "Both" entirely, so Completeness
     could never show the combined view). Kept as an empty string so the render
     templates below are untouched. */
  const quarterSelector = '';



  const catCards = LNT_MATRIX.map(c => {
    let cTotal = 0, cCount = 0;
    c.params.forEach((_, i) => {
      const v = ratings[`${c.id}_${i}`];
      if (v != null && v !== '') { cTotal += Number(v); cCount++; }
    });
    const cPct = cCount ? Number(((cTotal / cCount / 5) * 100).toFixed(1)) : 0;
    const cm = getCategoryMeta(c.id);
    const stat = (cm.status || '').trim();
    const isApproved = /^approved$/i.test(stat);
    const isNA = isNAStatus(stat);
    // "Changed and Approved" (the dropdown's old wording: "Not Approved and Changed")
    // carries the same meaning — the approver's own scores publish — so it keeps the
    // same amber pill as before the rename.
    const isNeg = /^not/i.test(stat) || /^changed and approved$/i.test(stat);
    const badgeCls = isNA ? 'pill-m' : isNeg ? 'pill-a' : isApproved ? 'pill-g' : 'pill-b';
    const statusBadge = stat
      ? `<div style="margin-top:8px;"><span class="pill ${badgeCls}" style="font-size:10.5px;">● ${hesc(stat)}</span></div>`
      : '';
    const baLine = (cm.buyer || cm.approver)
      ? `<div style="margin-top:8px;font-size:11px;color:var(--t3);font-family:var(--mono);word-break:normal;overflow-wrap:break-word;text-wrap:pretty;" title="Buyer: ${hesc(cm.buyer||'—')} · Approver: ${hesc(cm.approver||'—')}">👤 ${hesc(cm.buyer||'—')} → ✔ ${hesc(cm.approver||'—')}</div>`
      : '';
    // Remarks column from the Excel sheet - this team's note on this PO's rating.
    const remarksLine = (cm.remarks || '').trim()
      ? `<div style="margin-top:8px;font-size:11px;color:var(--t2);line-height:1.5;word-break:normal;overflow-wrap:break-word;text-wrap:pretty;" title="Remarks (from Excel)">📝 ${hesc(cm.remarks)}</div>`
      : '';

    return `
      <div class="kpi click" onclick="rCategoryDetail('${c.id}')" style="transition: transform 0.2s; border-color:var(--brd2);">
        <div class="kl" style="color:var(--acc2)">${c.params.length} Parameters</div>
        <div class="kv" style="font-size:17.5px; margin-top:4px; letter-spacing:0;">${c.name}</div>
        <div style="display:flex; justify-content:space-between; margin-top:12px; font-size:11px; color:var(--t3); font-family:var(--mono);">
          <span>Weight: ${c.w}%</span>
          <span>Score: ${cPct.toFixed(1)}%</span>
        </div>
        <div class="kb" style="margin-top:4px;"><div class="kbf" style="width:${cPct}%; background:var(--acc);"></div></div>
        ${statusBadge}
        ${baLine}
        ${remarksLine}
      </div>
    `;
  }).join('');



  const ratingPanel = activeItem ? `
    <div class="pn" style="margin-bottom:20px;">
      <div class="phd">
        <h3 class="pt">Selected Rating Item</h3>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
          ${quarterSelector}
          <button class="pgb" onclick="clearActiveRatingItem()">Back to selection</button>
        </div>
      </div>
      <div class="pb" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
        <div><div class="kl">Job Code</div><div style="font-family:var(--mono);color:var(--txt);margin-top:4px;font-size:14.5px;">${hesc(activeItem.jobCode || '—')}</div></div>
        <div><div class="kl">Vendor Code</div><div style="font-family:var(--mono);color:var(--txt);margin-top:4px;font-size:14.5px;">${hesc(activeItem.vendor || 'TBD')}</div></div>
        <div><div class="kl">Vendor Name</div><div style="color:var(--txt);margin-top:4px;font-size:14.5px;">${hesc(activeItem.vendorName || '—')}</div></div>
        <div><div class="kl">PO Number</div><div style="font-family:var(--mono);color:var(--txt);margin-top:4px;font-size:14.5px;">${hesc(activeItem.poNum || '—')}</div></div>
        <div style="grid-column:1/-1;"><div class="kl">Item</div><div style="color:var(--txt);margin-top:4px;font-size:14.5px;">${hesc(activeItem.item || '—')}</div></div>
      </div>
    </div>
    <div class="g2" style="grid-template-columns: 1fr 320px;">
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; align-content:start;">
        ${catCards}
      </div>
      <div class="pn" style="display:flex; flex-direction:column;">
        <div class="phd"><h3 class="pt">Overall Vendor Index</h3></div>
        <div class="pb" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:0;">

          <div style="font-size:11px;font-weight:600;color:var(--t3);letter-spacing:.8px;text-transform:uppercase;margin-bottom:4px;">${scopeLabel()}</div>
          <div style="font-size:52px; font-weight:700; color:${totalScore>=80?'var(--grn)':totalScore>=50?'var(--amb)':'var(--red)'}; line-height:1; letter-spacing:-1.5px;">
            ${totalScore.toFixed(1)}%
          </div>
          <div style="font-size:11px; color:var(--t3); margin-top:6px; font-weight:600; text-transform:uppercase; letter-spacing:.5px;">
            ${totalScore>=80?'Preferred Partner':totalScore>=50?'Tier 2 / Moderate':'High Risk Review'}
          </div>
          <div style="width:100%; height:5px; background:var(--s4); border-radius:3px; margin-top:14px; overflow:hidden;">
            <div style="height:100%; width:${Math.min(totalScore,100)}%; background:${totalScore>=80?'var(--grn)':totalScore>=50?'var(--amb)':'var(--red)'}; transition:width .8s;"></div>
          </div>

          ${quarterScores.length > 1 ? `
          <div style="width:100%;margin-top:18px;padding-top:16px;border-top:1px solid var(--brd);">
            <div style="font-size:10.5px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px;">Both Halves</div>
            ${(() => { const avg = parseFloat((quarterScores.reduce((s,x)=>s+x.score,0)/quarterScores.length).toFixed(1)); return `<div style="font-size:22px;font-weight:700;color:${avg>=80?'var(--grn)':avg>=50?'var(--amb)':'var(--red)'};letter-spacing:-0.5px;margin-bottom:10px;">${avg.toFixed(1)}% avg</div>`; })()}
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${quarterScores.map(({q, score}) => `
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="font-size:10px;font-family:var(--mono);font-weight:600;color:${q===activeQuarter?'var(--acc)':'var(--t3)'};width:32px;text-align:left;flex-shrink:0;">${q}</span>
                  <div style="flex:1;height:4px;background:var(--s4);border-radius:2px;overflow:hidden;">
                    <div style="height:100%;width:${Math.min(score,100)}%;background:${score>=80?'var(--grn)':score>=50?'var(--amb)':'var(--red)'};border-radius:2px;"></div>
                  </div>
                  <span style="font-size:10.5px;font-family:var(--mono);font-weight:600;color:${score>=80?'var(--grn)':score>=50?'var(--amb)':'var(--red)'};width:44px;text-align:right;flex-shrink:0;">${score.toFixed(1)}%</span>
                </div>
              `).join('')}
            </div>
          </div>` : ''}

        </div>
      </div>
    </div>
  ` : '';

  setM(`
    <div class="shd" style="display:flex; justify-content:space-between; width:100%; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <h2 class="stitle">Vendor Performance Scorecard</h2>
        ${activeItem?`<span class="ch ch-a">Rating for item</span>`:''}
      </div>
      ${!activeItem ? `
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn-exp" onclick="openPrintPicker()">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print / PDF
        </button>
        <button class="btn-exp" onclick="openReportModal()" style="background:var(--btn-solid-bg);color:var(--btn-solid-fg);border-color:var(--btn-solid-bg);">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Download Report
        </button>
      </div>` : ''}
    </div>

    ${activeItem ? ratingPanel : `
    <div class="pn" style="margin-bottom: 20px;">
      <div class="phd">
        <h3 class="pt">Evaluating Vendor</h3>
        <div style="flex:1; max-width:640px; margin-left:12px;">
          <div class="fbar" style="justify-content:flex-start; gap:10px;">
            <input class="sinp" list="sc-item-list" id="sc-item" placeholder="Item..."
                   value="${hesc(activeItemForRating)}"
                   oninput="activeItemForRating=this.value; updateScorecardFiltersD()"
                   style="min-width:150px; max-width:200px; padding:8px 12px;"/>
            <input class="sinp" list="sc-ven-list" id="sc-ven" placeholder="Vendor Code..."
                   value="${hesc(activeVendorForRating)}"
                   oninput="activeVendorForRating=this.value; updateScorecardFiltersD()"
                   style="min-width:170px; max-width:220px; padding:8px 12px;"/>
            <input class="sinp" list="sc-ven-name-list" id="sc-ven-name" placeholder="Vendor Name..."
                   value="${hesc(activeVendorNameForRating)}"
                   oninput="activeVendorNameForRating=this.value; updateScorecardFiltersD()"
                   style="min-width:190px; max-width:240px; padding:8px 12px;"/>
            <input class="sinp" list="sc-job-code-list" id="sc-job-code" placeholder="Job Code..."
                   value="${hesc(activeJobCodeForRating)}"
                   oninput="activeJobCodeForRating=this.value; updateScorecardFiltersD()"
                   style="min-width:150px; max-width:200px; padding:8px 12px;"/>
            <input class="sinp" list="sc-job-desc-list" id="sc-job-desc" placeholder="Job Desc..."
                   value="${hesc(activeJobDescForRating)}"
                   oninput="activeJobDescForRating=this.value; updateScorecardFiltersD()"
                   style="min-width:170px; max-width:220px; padding:8px 12px;"/>
            <input class="sinp" list="sc-po-list" id="sc-po" placeholder="PO Number..."
                   value="${hesc(activePOForRating)}"
                   oninput="activePOForRating=this.value; updateScorecardFiltersD()"
                   style="min-width:150px; max-width:190px; padding:8px 12px;"/>
            <button class="pgb" onclick="clrScorecardFilters()" style="white-space:nowrap;">✕ Clear</button>
            <span class="pgi" id="score-match-count">${scoreItems.length} item${scoreItems.length===1?'':'s'} matched</span>
          </div>
          ${activeItem?`<div style="display:flex;align-items:center;gap:10px;margin-top:10px;"><span style="font-size:11px;color:var(--t3);">Selected: ${hesc(activeItem.item)} · ${hesc(activeItem.vendor||'TBD')} · ${hesc(activeItem.sheet)}</span><button class="pgb" onclick="clearActiveRatingItem()">Clear selection</button></div>`:''}

          <datalist id="sc-ven-list">
            ${uVen.map(v => `<option value="${hesc(v)}">`).join('')}
          </datalist>
          <datalist id="sc-ven-name-list">
            ${uVendorNames.map(v => `<option value="${hesc(v)}">`).join('')}
          </datalist>
          <datalist id="sc-job-code-list">
            ${uJobCodes.map(v => `<option value="${hesc(v)}">`).join('')}
          </datalist>
          <datalist id="sc-job-desc-list">
            ${uJobDescs.map(v => `<option value="${hesc(v)}">`).join('')}
          </datalist>
          <datalist id="sc-item-list">
            ${uScItems.map(v => `<option value="${hesc(v)}">`).join('')}
          </datalist>
          <datalist id="sc-po-list">
            ${uPOs.map(v => `<option value="${hesc(v)}">`).join('')}
          </datalist>
        </div>
      </div>
    </div>

      <div class="pn" style="margin-bottom:20px;">
      <div class="phd"><h3 class="pt">Matched Items</h3></div>
      <div class="tw"><table class="dt dt-wrap"><thead><tr><th style="white-space:nowrap;">Item</th><th>Job Description</th><th style="white-space:nowrap;">Job Code</th><th style="white-space:nowrap;">Vendor Code</th><th>Vendor Name</th><th style="white-space:nowrap;">PO Number</th><th style="white-space:nowrap;">Action</th></tr></thead><tbody id="score-match-body"></tbody></table></div>
      <div class="phd" id="score-match-pager" style="border-top:1px solid var(--brd);"></div>
    </div>


    `}
  `);
  updateScorecardFilters();
}


// VIEW: RATING COMPLETENESS (vendor-wise) + PRINT REPORT


// Per-item rating progress for a half-year, read from the persisted per-quarter store.
// Mirrors how generateReport reads ratings, so the numbers stay consistent.
// PO-keyed views of the per-half stores, memoised against the parsed object so they
// rebuild only when appStorage actually changes. See _byPoIndex for why stableKey
// lookups miss.
const _poIdxCache = new WeakMap();
function _byPoIndexCached(map){
  if (!map) return {};
  let v = _poIdxCache.get(map);
  if (!v) { v = _byPoIndex(map); _poIdxCache.set(map, v); }
  return v;
}

// itemCompleteness() lives in 85-view-completeness.js (loaded after this file, so its
// declaration is what every caller — including this file's own rScorecard() — actually
// gets at runtime). It used to be duplicated here too, but that copy referenced `status`
// and `isNA` without ever declaring them in this scope, silently reading `window.status`
// (always "") and throwing ReferenceError on `isNA` respectively — a genuine bug that
// only did no visible harm because the later declaration in 85-view-completeness.js
// always won. Keeping one definition removes that trap.

// Per-item category + final score — mirrors the Vendor Focus page's own calculation
// (60-vendor-and-project-pages.js) so the two never disagree: a category only counts
// toward `final` once it's score-eligible (STATUS recorded — Approved / Changed / NA —
// not still Pending). Pending categories still appear in `cats` with their real score so
// callers can show "what the evaluator entered" alongside the status, they just don't
// feed the weighted `final` number until approved.
function itemScoreBreakdown(sk, q) {
  const rtgs = getQuarterRatingsForItem(sk, q);
  const meta = getQuarterMetaForItem(sk, q);
  const anyRating = LNT_MATRIX.some(c => c.params.some((_, i) => {
    const v = rtgs[`${c.id}_${i}`]; return v != null && v !== '';
  }));
  if (!anyRating) return null;
  const cats = LNT_MATRIX.map(c => {
    const m = meta[c.id] || {};
    return {
      id: c.id, name: c.name, w: c.w,
      score: calcCategoryScore(c.id, rtgs),
      eligible: categoryScoreEligible(meta, c.id),
      status: (m.status || '').trim(),
      buyer: (m.buyer || '').trim(),
      approver: (m.approver || '').trim(),
      remarks: (m.remarks || '').trim()
    };
  });
  const final = calcWeightedVendorScoreFromCategories(cats.map(x => x.eligible ? x.score : null));
  return { cats, final };
}

// Group all tracker rows by vendor (code first, else name).
function groupItemsByVendor(items) {
  const groups = {};
  items.forEach(i => {
    const code = (i.vendor || '').trim();
    const name = (i.vendorName || '').trim();
    const key = (code || name || 'TBD').toLowerCase();
    if (!groups[key]) groups[key] = { code, name, items: [] };
    if (!groups[key].code && code) groups[key].code = code;
    if (!groups[key].name && name) groups[key].name = name;
    groups[key].items.push(i);
  });
  return groups;
}

const COMP_STATUS = {
  progress:   ['pill-a', 'In Progress'],
  pending:    ['pill-b', 'Awaiting Approval'],
  notstarted: ['pill-m', 'Not Started'],
  complete:   ['pill-g', 'Complete']
};

