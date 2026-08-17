/* ============================================================
 * 70-rating-matrix-and-scope.js
 * LNT_MATRIX parameters, half-year state, copy/clear tools
 * ------------------------------------------------------------
 * Part of the L&T Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */
const LNT_MATRIX = [
  {
    id: 'scm', name: 'SCM | Order Handling & Administration', w: 30,
    params: [
      "Timeliness and Completeness of Offer Submission",
      "Responsiveness During Tendering and Bid Support",
      "Commitment to Agreed Delivery Schedule",
      "Responsiveness to Commercial and Technical Clarifications",
      "Competitiveness in Pricing and Negotiations",
      "Compliance with Purchase Order Terms and Conditions",
      "Financial Stability and Business Sustainability",
      "Consistency in Business Engagement and Repeat Orders",
      "Commitment Towards Long-Term Business Partnership",
      "Resilience in Managing Supply Chain Disruptions and Capacity Commitment During Peak Demand",
      "Adherence to Ethical Business Practices",
      "Technical Support During Pre-Order Stage",
      "Participation in Reverse Auctions",
      "Statutory Compliance Support",
      "Adoption of Digital Tools and Platforms"
    ]
  },
  {
    id: 'edrc', name: 'EDRC | Engineering', w: 25,
    params: [
      "Quality and Completeness of Technical Documentation",
      "Timeliness of Technical Submissions and Approvals",
      "Responsiveness to Engineering Clarifications",
      "Flexibility in Meeting Project-Specific Requirements,Technology Upgradation and Innovation",
      "Availability and Validity of Type Test Certifications"
    ]
  },
  {
    id: 'quality', name: 'Product Quality', w: 25,
    params: [
      "Quality and Timeliness of Technical Documentation",
      "Readiness for FAT and Inspection Activities",
      "Availability of Resources for FAT Execution",
      "Effectiveness of Sub-Vendor Quality Management and Quality Management System (QMS) Maturity",
      "Material Identification and Traceability Practices",
      "Compliance with Specifications, Drawings, Standards and ESG Governance Requirements",
      "Timely Closure of Deviations, Corrective Actions and Technical Problem Resolution",
      "Efficiency in Inspection Planning and Execution",
      "Readiness of Materials for Sampling and Testing",
      "Quality of Packing, Material Preservation, Equipment Reliability and Performance",
      "Responsiveness in Site Mobilisation, Support and Compliance with Warranty Obligations"
    ]
  },
  {
    id: 'operation', name: 'Operation | Deliveries', w: 20,
    params: [
      "Transparency in Manufacturing Progress Reporting and Service Support Coordination",
      "Compliance with Committed Delivery Schedules and Operational Reliability in Installed Projects",
      "Effectiveness of Inspection, Dispatch Coordination and HSE Compliance",
      "Completeness of Material Supply, Deliverables and Availability of Critical Spares",
      "Responsiveness in Resolving Delivery-Related Issues and Major Equipment Breakdowns",
      "Commitment and Flexibility During Project Execution, Emergency and Crisis Management",
      "Timely Submission of Final Documentation, MRB and Maintenance Support Records",
      "Financial Capability During Order Execution",
      "Compliance with Digital Invoicing Requirements",
      "Timely Submission of Manufacturing Clearance Documents"
    ]
  }
];

// Standard per-category responsibility roles (Evaluator = Buyer, Approver),
// used as defaults on the Vendor Dashboard when no manual name is stored.
const CATEGORY_ROLES = {
  scm:       { ev:'Buyer',        ap:'Buyers IS' },
  edrc:      { ev:'PEM',          ap:'BU Design Head' },
  quality:   { ev:'BU Quality',   ap:'Quality Head' },
  operation: { ev:'BU /Site CMS', ap:'PD/PM' }
};

let activeVendorForRating = "";
let activeVendorNameForRating = "";
let activeJobCodeForRating = "";
let activeJobDescForRating = "";
let activePOForRating = "";
let activeItemForRating = "";
let scorecardMatchPage = 1;
let scorecardMatchFilterKey = "";
let vendorRatings = {};

function currentQuarterDefault() {
  const q = currentIndianFYQuarter(); // e.g. "2025-H1"
  return q.split('-')[1]; // return just "H1"
}
let activeQuarter = (function() {
  try {
    const saved = appStorage.getItem('lnt_activeQuarter');
    // Accept plain H1–H2; strip year if an old value like "2025-H1" was saved
    if (saved) {
      const plain = saved.match(/H[12]$/)?.[0];
      if (plain) return plain;
    }
    return currentQuarterDefault();
  } catch(e) { return currentQuarterDefault(); }
})();

function setActiveQuarter(q, view, manual) {
  activeQuarter = q;
  // Only a real user click on the H1/H2 top-bar buttons should stop
  // auto-detection from later overriding the choice — not the internal
  // "jump to whichever half has this PO's ratings" navigation below.
  if (manual) window._quarterManuallySet = true;
  // A tier picked for the previous half-year may not exist (or may be empty) for the
  // newly-selected half, which showed up as a stuck "Silver (0)" selection. Clear it so
  // tier-dependent panels re-pick the best-populated tier for the half just selected.
  selectedOverviewTier = null;
  try {
    appStorage.setItem('lnt_activeQuarter', q);
  } catch(e) {}
  // Reload the in-memory ratings for the newly-active half.
  if (typeof loadPersistedRatings === 'function') loadPersistedRatings();
  if (typeof updateTopbarScope === 'function') updateTopbarScope();
  if (view) {
    go(view, true);
  } else {
    // No explicit view: re-render whatever page/state is currently open. This is a
    // scope switch, not real navigation, so it must preserve in-page focus the same way
    // the `view` branch above does (keepActive=true) — e.g. staying on the exact vendor
    // rating entry open in Vendor Scorecard, instead of handleHash()'s normal navigation
    // behaviour which (for #scorecard specifically) resets activeRatingKey and bounces
    // back to the general filter list, looking like an unwanted redirect.
    handleHash(true);
  }
}

function updateTopbarScope() {
  const q = activeQuarter || 'H1';
  const b1 = document.getElementById('tbq-h1');
  const b2 = document.getElementById('tbq-h2');
  if(!b1) return;
  [b1, b2].forEach(b => {
    if(b) {
      b.style.background = 'var(--white)';
      b.style.color = 'var(--t2)';
      b.style.fontWeight = '500';
    }
  });
  const activeBtn = (q === 'H1') ? b1 : b2;
  if(activeBtn) {
    activeBtn.style.background = 'var(--acc)';
    activeBtn.style.color = '#fff';
    activeBtn.style.fontWeight = '700';
  }
}

function quarterStorageKey(base) {
  return `${base}_${activeQuarter}`;
}

function getAllSavedQuarters() {
  const quarters = new Set();
  const pattern = /^lnt_(?:itemRatings|vendorRatings|paramRemarks|categoryRemarks|categoryMeta|evalProgress)_(H[12])$/;
  try {
    for (let i = 0; i < appStorage.length; i++) {
      const k = appStorage.key(i);
      const m = k && k.match(pattern);
      if (m) quarters.add(m[1]);
    }
  } catch(e) {}
  return [...quarters].sort().reverse();
}

function previousQuarter(q) {
  const m = q.match(/^H([12])$/);
  if (!m) return null;
  const qnum = parseInt(m[1]);
  return qnum === 1 ? null : `H${qnum - 1}`;
}

function copyRatingsFromQuarter(sourceQ) {
  if (sourceQ === activeQuarter) { toast('Already on this half-year', 'err'); return; }
  try {
    const srcVR = JSON.parse(appStorage.getItem(`lnt_vendorRatings_${sourceQ}`)  || '{}');
    const srcIR = JSON.parse(appStorage.getItem(`lnt_itemRatings_${sourceQ}`)    || '{}');
    const srcPR = JSON.parse(appStorage.getItem(`lnt_paramRemarks_${sourceQ}`)   || '{}');
    const srcCR = JSON.parse(appStorage.getItem(`lnt_categoryRemarks_${sourceQ}`)|| '{}');
    const srcCM = JSON.parse(appStorage.getItem(`lnt_categoryMeta_${sourceQ}`)   || '{}');

    const copiedVR = JSON.parse(JSON.stringify(srcVR));
    const copiedIR = JSON.parse(JSON.stringify(srcIR));
    const copiedPR = JSON.parse(JSON.stringify(srcPR));
    const copiedCR = JSON.parse(JSON.stringify(srcCR));
    const copiedCM = JSON.parse(JSON.stringify(srcCM));

    appStorage.setItem(`lnt_vendorRatings_${activeQuarter}`,   JSON.stringify(copiedVR));
    appStorage.setItem(`lnt_itemRatings_${activeQuarter}`,     JSON.stringify(copiedIR));
    appStorage.setItem(`lnt_paramRemarks_${activeQuarter}`,    JSON.stringify(copiedPR));
    appStorage.setItem(`lnt_categoryRemarks_${activeQuarter}`, JSON.stringify(copiedCR));
    appStorage.setItem(`lnt_categoryMeta_${activeQuarter}`,    JSON.stringify(copiedCM));

    saveRatingRecord(`lnt_vendorRatings_${activeQuarter}`, copiedVR);
    saveRatingRecord(`lnt_itemRatings_${activeQuarter}`,   copiedIR);
    saveRatingRecord(`lnt_paramRemarks_${activeQuarter}`,  copiedPR);
    saveRatingRecord(`lnt_categoryRemarks_${activeQuarter}`,copiedCR);
    saveRatingRecord(`lnt_categoryMeta_${activeQuarter}`,  copiedCM);

    loadPersistedRatings();
    LNT_MATRIX.forEach(cat => {
      cat.params.forEach((_, i) => {
        const key = `${cat.id}_${i}`;
        if (vendorRatings[key] === undefined) vendorRatings[key] = 3;
      });
    });

    toast(`Copied from ${sourceQ} into ${activeQuarter} ✓`, 'ok');
    rScorecard();
  } catch(e) { console.error(e); toast('Copy failed: ' + e.message, 'err'); }
}

window.openCopyQuarterModal = function() {
  const saved = getAllSavedQuarters();
  const prev  = previousQuarter(activeQuarter);
  const modal = document.getElementById('copy-quarter-modal');
  const list  = document.getElementById('copy-quarter-list');
  const subtitle = document.getElementById('copy-quarter-subtitle');
  if (!modal || !list) return;

  if (subtitle) subtitle.textContent = `Target: ${activeQuarter} - existing ratings will be replaced.`;

  const allQuarters = ['H1','H2'].filter(q => q !== activeQuarter);

  list.innerHTML = allQuarters.map(q => {
    const hasData = saved.includes(q);
    const isPrev  = q === prev;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 20px;border-bottom:1px solid #f4f6f9;gap:12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:600;text-transform:uppercase;letter-spacing:.3px;color:${hasData?'#14171a':'#888f97'};">${q}</span>
          ${isPrev ? `<span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;background:#e3e6e9;color:#3c424a;border:1px solid #a3aab1;padding:2px 7px;border-radius:2px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;">PREV</span>` : ''}
          ${hasData ? `<span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;background:#e7eede;color:#3f6d2c;border:1px solid #aec293;padding:2px 7px;border-radius:2px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;">HAS DATA</span>` : `<span style="font-size:11px;color:#888f97;">No ratings saved</span>`}
        </div>
        <button onclick="copyRatingsFromQuarter('${q}');closeCopyQuarterModal()"
          ${!hasData ? 'disabled title="No ratings saved in this half-year"' : ''}
          style="padding:5px 14px;border-radius:2px;border:1px solid ${hasData?'#0072bc':'#cdd2d7'};background:${hasData?'#0072bc':'#edeff1'};color:${hasData?'#fff':'#b0b6bd'};font-family:'Barlow Condensed',sans-serif;font-size:13px;text-transform:uppercase;letter-spacing:.4px;cursor:${hasData?'pointer':'not-allowed'};font-weight:600;white-space:nowrap;flex-shrink:0;">
          Copy into ${activeQuarter}
        </button>
      </div>
    `;
  }).join('');

  modal.style.display = 'flex';
};

window.closeCopyQuarterModal = function() {
  const m = document.getElementById('copy-quarter-modal');
  if (m) m.style.display = 'none';
};

(function injectCopyQuarterModal() {
  if (document.getElementById('copy-quarter-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'copy-quarter-modal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:1001;background:rgba(16,24,40,.45);backdrop-filter:blur(3px);align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#f6f7f8;border:1px solid #a3aab1;border-radius:2px;width:90%;max-width:440px;box-shadow:0 14px 30px -12px rgba(15,18,22,.42);overflow:hidden;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #bcc1c6;gap:12px;background:#edeff1;">
        <div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#14171a;">Copy Ratings from Another Half-Year</div>
          <div id="copy-quarter-subtitle" style="font-size:11.5px;color:#5e656d;margin-top:3px;font-family:'IBM Plex Mono',monospace;"></div>
        </div>
        <button class="modal-x-close" onclick="closeCopyQuarterModal()">×</button>
      </div>
      <div id="copy-quarter-list" style="max-height:340px;overflow-y:auto;"></div>
    </div>
  `;
  document.body.appendChild(modal);
})();

let paramRemarks = {};
let categoryRemarks = {};
let categoryMeta = {};   // categoryMeta[ratingSetKey][catId] = { buyer, approver }
function getRatingSetKey() { return activeRatingKey || '__global__'; }
function getParamRemark(key) { return (paramRemarks[getRatingSetKey()] || {})[key] || ''; }
function getCategoryRemark(catId) { return (categoryRemarks[getRatingSetKey()] || {})[catId] || ''; }
function getCategoryMeta(catId) { return (categoryMeta[getRatingSetKey()] || {})[catId] || {}; }
function setParamRemark(key, text) {
  const sk = getRatingSetKey();
  if (!paramRemarks[sk]) paramRemarks[sk] = {};
  paramRemarks[sk][key] = text;
  persistRatings();
}
function setCategoryRemark(catId, text) {
  const sk = getRatingSetKey();
  if (!categoryRemarks[sk]) categoryRemarks[sk] = {};
  categoryRemarks[sk][catId] = text;
  persistRatings();
}
function setCategoryMetaField(catId, field, value) {
  const sk = getRatingSetKey();
  if (!categoryMeta[sk]) categoryMeta[sk] = {};
  if (!categoryMeta[sk][catId]) categoryMeta[sk][catId] = {};
  categoryMeta[sk][catId][field] = value;
  persistRatings();
}

(function injectRemarkModal() {
  if (document.getElementById('remark-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'remark-modal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.65);align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#f6f7f8;border:1px solid #a3aab1;border-radius:2px;padding:22px 24px 18px;max-width:460px;width:90%;display:flex;flex-direction:column;gap:14px;box-shadow:0 14px 30px -12px rgba(15,18,22,.42);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div>
          <div id="remark-modal-title" style="font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#14171a;line-height:1.1;"></div>
          <div id="remark-modal-sub" style="font-size:11.5px;color:#5e656d;font-family:'IBM Plex Mono',monospace;margin-top:4px;"></div>
        </div>
        <button class="modal-x-close" onclick="closeRemarkModal()">×</button>
      </div>
      <textarea id="remark-modal-input" placeholder="Add your remark here…" style="width:100%;min-height:90px;padding:9px 12px;border-radius:2px;border:1px solid #a3aab1;background:#fff;color:#191c1f;font-family:'Barlow',sans-serif;font-size:13.5px;resize:vertical;outline:none;line-height:1.55;transition:border-color .12s;" onfocus="this.style.borderColor='#0072bc';this.style.boxShadow='0 0 0 3px rgba(191,69,23,.14)'" onblur="this.style.borderColor='#a3aab1';this.style.boxShadow='none'"></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="closeRemarkModal()" style="padding:7px 16px;border-radius:2px;border:1px solid #a3aab1;background:#fff;color:#3c424a;font-size:13px;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Cancel</button>
        <button onclick="saveRemarkFromModal()" style="padding:7px 16px;border-radius:2px;border:1px solid #0072bc;background:#0072bc;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.5px;">Save Remark</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
})();

let _remarkModalCallback = null;
function openRemarkModal(title, sub, existingText, onSave) {
  const modal = document.getElementById('remark-modal');
  document.getElementById('remark-modal-title').textContent = title;
  document.getElementById('remark-modal-sub').textContent = sub;
  document.getElementById('remark-modal-input').value = existingText || '';
  _remarkModalCallback = onSave;
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('remark-modal-input').focus(), 50);
}
window.closeRemarkModal = function() {
  document.getElementById('remark-modal').style.display = 'none';
  _remarkModalCallback = null;
};
window.saveRemarkFromModal = function() {
  const text = document.getElementById('remark-modal-input').value.trim();
  if (_remarkModalCallback) _remarkModalCallback(text);
  closeRemarkModal();
};

const LS_VENDOR_KEY        = 'lnt_vendorRatings';
const LS_ITEM_KEY          = 'lnt_itemRatings';
const LS_PARAM_REMARKS_KEY = 'lnt_paramRemarks';
const LS_CAT_REMARKS_KEY   = 'lnt_categoryRemarks';
const LS_CAT_META_KEY      = 'lnt_categoryMeta';
const RATINGS_DB_NAME      = 'lnt_procurement_dashboard';
const RATINGS_DB_STORE     = 'scorecardRatings';
let ratingsDbPromise = null;

function openRatingsDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is not available'));
  if (ratingsDbPromise) return ratingsDbPromise;

  ratingsDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(RATINGS_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RATINGS_DB_STORE)) {
        db.createObjectStore(RATINGS_DB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return ratingsDbPromise;
}

function dbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRatingRecord(key, value) {
  try { appStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
  try {
    const db = await openRatingsDb();
    const tx = db.transaction(RATINGS_DB_STORE, 'readwrite');
    await dbRequest(tx.objectStore(RATINGS_DB_STORE).put({ key, value, updatedAt: new Date().toISOString() }));
  } catch(e) { console.warn('Could not save rating to database', e); }
}

async function removeRatingRecord(key) {
  try { appStorage.removeItem(key); } catch(e) {}
  try {
    const db = await openRatingsDb();
    const tx = db.transaction(RATINGS_DB_STORE, 'readwrite');
    await dbRequest(tx.objectStore(RATINGS_DB_STORE).delete(key));
  } catch(e) { console.warn('Could not remove rating from database', e); }
}

async function readRatingRecord(key) {
  try {
    const saved = appStorage.getItem(key);
    if (saved) return JSON.parse(saved);
  } catch(e) {}

  try {
    const db = await openRatingsDb();
    const tx = db.transaction(RATINGS_DB_STORE, 'readonly');
    const row = await dbRequest(tx.objectStore(RATINGS_DB_STORE).get(key));
    if (row) {
      try { appStorage.setItem(key, JSON.stringify(row.value)); } catch(e) {}
      return row.value;
    }
  } catch(e) { console.warn('Could not read rating from database', e); }

  return {};
}

async function hydrateRatingsFromDb() {
  try {
    const db = await openRatingsDb();
    const tx = db.transaction(RATINGS_DB_STORE, 'readonly');
    const rows = await dbRequest(tx.objectStore(RATINGS_DB_STORE).getAll());
    rows.forEach(row => {
      try { appStorage.setItem(row.key, JSON.stringify(row.value)); } catch(e) {}
    });
    if (typeof loadPersistedRatings === 'function') loadPersistedRatings();
    if (document.getElementById('nav-scorecard')?.classList.contains('on')) go('scorecard', true);
  } catch(e) { console.warn('Could not load ratings database', e); }
}

function migrateLocalRatingsToDb() {
  const ratingKeyPattern = /^lnt_(?:itemRatings|vendorRatings|paramRemarks|categoryRemarks|categoryMeta|evalProgress)_H[12]$/;
  try {
    for (let i = 0; i < appStorage.length; i++) {
      const key = appStorage.key(i);
      if (!key || !ratingKeyPattern.test(key)) continue;
      saveRatingRecord(key, JSON.parse(appStorage.getItem(key) || '{}'));
    }
  } catch(e) { console.warn('Could not migrate existing ratings to database', e); }
}

function persistRatings() {
  // In combined (H1 + H2) mode the in-memory ratings are a merged view, not a
  // real half — never write it back, or it would clobber the source halves.
  if (typeof isBothScope === 'function' && isBothScope()) {
    if (typeof toast === 'function') toast('Switch to H1 or H2 to edit ratings', 'err');
    return;
  }
  try {
    appStorage.setItem(quarterStorageKey(LS_VENDOR_KEY),        JSON.stringify(vendorRatings));
    appStorage.setItem(quarterStorageKey(LS_ITEM_KEY),          JSON.stringify(itemRatings));
    appStorage.setItem(quarterStorageKey(LS_PARAM_REMARKS_KEY), JSON.stringify(paramRemarks));
    appStorage.setItem(quarterStorageKey(LS_CAT_REMARKS_KEY),   JSON.stringify(categoryRemarks));
    appStorage.setItem(quarterStorageKey(LS_CAT_META_KEY),      JSON.stringify(categoryMeta));
    saveRatingRecord(quarterStorageKey(LS_VENDOR_KEY),        vendorRatings);
    saveRatingRecord(quarterStorageKey(LS_ITEM_KEY),          itemRatings);
    saveRatingRecord(quarterStorageKey(LS_PARAM_REMARKS_KEY), paramRemarks);
    saveRatingRecord(quarterStorageKey(LS_CAT_REMARKS_KEY),   categoryRemarks);
    saveRatingRecord(quarterStorageKey(LS_CAT_META_KEY),      categoryMeta);
  } catch(e) { console.warn('Could not save ratings', e); }
}

function loadPersistedRatings() {
  vendorRatings   = {};
  itemRatings     = {};
  paramRemarks    = {};
  categoryRemarks = {};
  categoryMeta    = {};
  try {
    const vr = appStorage.getItem(quarterStorageKey(LS_VENDOR_KEY));
    const ir = appStorage.getItem(quarterStorageKey(LS_ITEM_KEY));
    const pr = appStorage.getItem(quarterStorageKey(LS_PARAM_REMARKS_KEY));
    const cr = appStorage.getItem(quarterStorageKey(LS_CAT_REMARKS_KEY));
    const cm = appStorage.getItem(quarterStorageKey(LS_CAT_META_KEY));
    if (vr) Object.assign(vendorRatings,   JSON.parse(vr));
    if (ir) Object.assign(itemRatings,     JSON.parse(ir));
    if (pr) Object.assign(paramRemarks,    JSON.parse(pr));
    if (cr) Object.assign(categoryRemarks, JSON.parse(cr));
    if (cm) Object.assign(categoryMeta,    JSON.parse(cm));
  } catch(e) { console.warn('Could not load from appStorage', e); }
}

function clearPersistedRatings() {
  try {
    appStorage.removeItem(quarterStorageKey(LS_VENDOR_KEY));
    appStorage.removeItem(quarterStorageKey(LS_ITEM_KEY));
    appStorage.removeItem(quarterStorageKey(LS_PARAM_REMARKS_KEY));
    appStorage.removeItem(quarterStorageKey(LS_CAT_REMARKS_KEY));
    appStorage.removeItem(quarterStorageKey(LS_CAT_META_KEY));
    removeRatingRecord(quarterStorageKey(LS_VENDOR_KEY));
    removeRatingRecord(quarterStorageKey(LS_ITEM_KEY));
    removeRatingRecord(quarterStorageKey(LS_PARAM_REMARKS_KEY));
    removeRatingRecord(quarterStorageKey(LS_CAT_REMARKS_KEY));
    removeRatingRecord(quarterStorageKey(LS_CAT_META_KEY));
    vendorRatings   = {};
    itemRatings     = {};
    paramRemarks    = {};
    categoryRemarks = {};
    categoryMeta    = {};
    toast(`${activeQuarter} ratings cleared`, 'ok');
    go('scorecard');
  } catch(e) {}
}

function clearAllRatings() {
  try {
    const pattern = /^lnt_(?:itemRatings|vendorRatings|paramRemarks|categoryRemarks|categoryMeta)_H[12]$/;
    const keysToRemove = [];
    for (let i = 0; i < appStorage.length; i++) {
      const k = appStorage.key(i);
      if (k && pattern.test(k)) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => {
      appStorage.removeItem(k);
      removeRatingRecord(k);
    });
    appStorage.removeItem('lnt_activeRatingKey');
    activeRatingKey = '';
    vendorRatings   = {};
    itemRatings     = {};
    paramRemarks    = {};
    categoryRemarks = {};
    categoryMeta    = {};
    toast('All ratings cleared across all half-years', 'ok');
    go('scorecard');
  } catch(e) { toast('Clear failed', 'err'); }
}

migrateLocalRatingsToDb();
hydrateRatingsFromDb();

function parseAnyDate(v) {
  if (!v || v === '') return null;
  if (typeof v === 'number' || (!isNaN(v) && String(v).trim().length > 3)) {
    const n = parseFloat(v);
    if (n > 1000) { const d = new Date((n - 25569) * 86400000); if (!isNaN(d.getTime())) return d; }
  }
  const s = String(v).trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/](\d{4})$/);
  if (m1) { const d = new Date(`${m1[2]} ${m1[1]} ${m1[3]}`); if (!isNaN(d.getTime())) return d; }
  const m2 = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (m2) {
    const yr = m2[3].length === 2 ? '20' + m2[3] : m2[3];
    const d = new Date(`${yr}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function detectSmartQuarter() {
  const rows = all();
  if (!rows.length) return null;
  const quarterCounts = {};
  rows.forEach(row => {
    [row.expDel, row.delStart, row.poDate].filter(Boolean).forEach(src => {
      const d = parseAnyDate(src);
      if (!d) return;
      const { fy, q } = getIndianFYQuarter(d);
      if (fy < 2020 || fy > 2035) return;
      const key = `${fy}-H${q}`;
      const w = (src === row.expDel || src === row.delStart) ? 2 : 1;
      quarterCounts[key] = (quarterCounts[key] || 0) + w;
    });
  });
  if (!Object.keys(quarterCounts).length) return null;
  const top = Object.entries(quarterCounts).sort((a, b) => b[1] - a[1])[0][0];
  return top.split('-')[1]; // plain "H1"/"H2"
}

function autoDetectQuarter() {
  const detected = detectSmartQuarter();
  if (!detected) return;
  if (window._quarterManuallySet) return;
  if (detected !== activeQuarter) {
    activeQuarter = detected;
    try { appStorage.setItem('lnt_activeQuarter', detected); } catch(e) {}
    if (typeof updateTopbarScope === 'function') updateTopbarScope();
    toast(`Half-year auto-set to ${detected} based on delivery dates ✓`, 'ok');
  }
}

function initRatings() {
  loadPersistedRatings();
  LNT_MATRIX.forEach(cat => {
    cat.params.forEach((_, i) => {
      const key = `${cat.id}_${i}`;
      if (vendorRatings[key] === undefined) vendorRatings[key] = 3;
    });
  });
}

function getRatingSet(){
  if(activeRatingKey){
    // Try exact key first
    if(itemRatings[activeRatingKey] && hasSavedRatingValues(itemRatings[activeRatingKey])){
      return itemRatings[activeRatingKey];
    }
    // Fallback: try PO-only key (po:X|ven:|item:) in case field resolution differed
    const poOnlyMatch = activeRatingKey.match(/^po:([^|]+)\|/);
    if(poOnlyMatch){
      const fallback = 'po:' + poOnlyMatch[1] + '|ven:|item:';
      if(itemRatings[fallback] && hasSavedRatingValues(itemRatings[fallback])){
        // Promote: copy to exact key so subsequent saves go to the right place
        itemRatings[activeRatingKey] = Object.assign({}, itemRatings[fallback]);
        return itemRatings[activeRatingKey];
      }
    }
    if(!itemRatings[activeRatingKey]) itemRatings[activeRatingKey]={};
    return itemRatings[activeRatingKey];
  }
  return vendorRatings;
}

function hasSavedRatingValues(rtgs) {
  return !!rtgs && Object.keys(rtgs).some(k => Number.isFinite(Number(rtgs[k])));
}

function gotoRatingItem(key){
  activeRatingKey = key;
  try { appStorage.setItem('lnt_activeRatingKey', key); } catch(e) {}

  // Auto-switch to the quarter that has ratings for this key.
  // Walk all saved quarters and pick the one with actual data.
  var bestQ = null;
  var pattern = /^lnt_itemRatings_(H[12])$/;
  try {
    for (var li = 0; li < appStorage.length; li++) {
      var lk = appStorage.key(li);
      var m = lk && lk.match(pattern);
      if (!m) continue;
      var qCandidate = m[1];
      var stored = appStorage.getItem(lk);
      if (!stored) continue;
      var ir = JSON.parse(stored);
      if (ir[key] && hasSavedRatingValues(ir[key])) {
        bestQ = qCandidate;
        break; // take first match; could also pick latest
      }
    }
  } catch(e) {}

  if (bestQ && bestQ !== activeQuarter) {
    setActiveQuarter(bestQ, 'scorecard');   // switches quarter + reloads itemRatings
  } else {
    go('scorecard', true);
  }
}

function stableKey(i) {
  const po   = (i.poNum    || '').trim();
  const ven  = (i.vendor   || '').trim();
  const item = (i.item     || '').trim();
  if (po || ven || item) {
    return `po:${po}|ven:${ven}|item:${item}`;
  }
  return `${i.sheetId}::${i.rowId}`;
}

function clearActiveRatingItem(){
  activeRatingKey = '';
  try { appStorage.removeItem('lnt_activeRatingKey'); } catch(e) {}
  go('scorecard');
}

// VENDOR TIERS (Platinum / Gold / Silver / Bronze / Not Rated)  — top of scorecard

// A category's rating only counts toward any score the app *displays* once its STATUS
// has actually been recorded (Approved, Changed and Approved, or NA) — never while
// it's blank ("Pending"). itemRatings can carry a real value for a Pending category
// (the evaluator's own entry — kept so Rating Completeness can show it as rated, not
// invisible) but that's provisional data sitting with the approver, not a finished
// number, so it must not silently feed into a % a vendor/PO is judged by. isNAStatus()
// already excludes NA; this is the same idea extended to "nothing typed at all yet".
function categoryScoreEligible(meta, catId){
  if (!meta) return true;   // caller has no per-category metadata to check — behave as before
  const st = String((meta[catId] || {}).status || '').trim();
  return st !== '' && !isNAStatus(st);
}
// vendorTierScore mirrors calcScore (which is nested inside rScorecard): a weighted
// 0-100 over LNT_MATRIX, averaging only the rated params per category, weights
// SCM30 / EDRC25 / Quality25 / Operation20. Pass `meta` (categoryMeta for this item) to
// also exclude Pending categories from the average — see categoryScoreEligible() above.
function vendorTierScore(bag, meta){
  let s=0, wTotal=0;
  LNT_MATRIX.forEach(cat=>{
    if (!categoryScoreEligible(meta, cat.id)) return;
    let total=0,count=0;
    cat.params.forEach((_,i)=>{ const v=bag[`${cat.id}_${i}`]; if(v!=null&&v!==''){ total+=Number(v); count++; } });
    if(count) {
      s += cat.w*(total/count/5);
      wTotal += cat.w;
    }
  });
  if (!wTotal) return 0;
  return parseFloat((s * (100 / wTotal)).toFixed(1));
}
// Vendor Tier eligibility gate: a vendor only qualifies for a score/tier once EVERY
// category — SCM, EDRC, Quality, Operation — is Completed for ALL of its items, meaning
// both the Evaluator (every rating parameter filled) and the Approver (STATUS recorded)
// have finished their part. Reuses itemCompleteness() (85-view-completeness.js) — same
// filled/total (Evaluator) and credited (Approver, STATUS set) counters the Completeness
// page already reports per category — rather than re-deriving evaluator/approver state.
function vendorDomainCompletion(items){
  const domains={}; LNT_MATRIX.forEach(c=>domains[c.id]=true);
  items.forEach(i=>{
    const comp=itemCompleteness(stableKey(i));
    if(comp.allCatsNA) return; // not applicable to this item — doesn't block any domain
    LNT_MATRIX.forEach(c=>{
      const k=comp.cat[c.id];
      const evaluatorDone = k.total===0 || k.filled===k.total;
      const approverDone  = k.credited;
      if(!(evaluatorDone && approverDone)) domains[c.id]=false;
    });
  });
  return { domains, allComplete: LNT_MATRIX.every(c=>domains[c.id]) };
}
// Group all() rows by vendor code; a rating is stored per line-item (stableKey), so a
// vendor's score is the average of its rated items' scores for the active half-year.
function computeVendorTiers(){
  const a=all(), vm={};
  a.forEach(i=>{
    const v=(i.vendor||'').trim();
    if(v.length<2) return;
    if(!vm[v]) vm[v]={code:v, name:i.vendorName||'', items:[]};
    if(!vm[v].name && i.vendorName) vm[v].name=i.vendorName;
    vm[v].items.push(i);
  });
  const tiers={platinum:[],gold:[],silver:[],bronze:[],incomplete:[],notRated:[]};
  Object.values(vm).forEach(v=>{
    const scores=[];
    v.items.forEach(i=>{ const bag=itemRatings[stableKey(i)]; if(hasSavedRatingValues(bag)) scores.push(vendorTierScore(bag)); });
    if(!scores.length){ tiers.notRated.push({code:v.code,name:v.name,score:null,itemCount:v.items.length}); return; }
    // Only Calculate Overall Score + assign a Platinum/Gold/Silver/Bronze tier once all
    // four domains are Completed (Evaluator + Approver). Otherwise the vendor is parked
    // in "Domains Incomplete" — rated in part, but not yet eligible for a tier.
    const domainCompletion=vendorDomainCompletion(v.items);
    if(!domainCompletion.allComplete){
      const missing=LNT_MATRIX.filter(c=>!domainCompletion.domains[c.id]).map(c=>c.name);
      tiers.incomplete.push({code:v.code,name:v.name,itemCount:v.items.length,missing});
      return;
    }
    const score=parseFloat((scores.reduce((x,y)=>x+y,0)/scores.length).toFixed(1));
    const rec={code:v.code,name:v.name,score,ratedCount:scores.length,itemCount:v.items.length};
    if(score>=90) tiers.platinum.push(rec);
    else if(score>=75) tiers.gold.push(rec);
    else if(score>=60) tiers.silver.push(rec);
    // Bronze is the catch-all "lowest tier, still rated" bucket — anything scored,
    // however poorly, belongs here, never in notRated. notRated means zero ratings
    // (handled by the early return above); a vendor that was fully evaluated and
    // simply scored under 50 is a risk case, not a pending one, and must not be
    // hidden inside "Action Required / no evaluation yet".
    else tiers.bronze.push(rec);
  });
  ['platinum','gold','silver','bronze'].forEach(k=>tiers[k].sort((x,y)=>y.score-x.score));
  tiers.incomplete.sort((x,y)=>(x.name||x.code).localeCompare(y.name||y.code));
  tiers.notRated.sort((x,y)=>x.code.localeCompare(y.code));
  return tiers;
}
// Click a vendor in the tier panel → open that vendor's item detail (stays in Vendor Focus).
function scoreTierPickVendor(code){
  openVendorPage(code);
}
function vendorTierPanelHTML(){
  const t=computeVendorTiers();
  const defs=[
    {key:'platinum', medal:'💎', label:'Platinum',            sub:'90 – 100%',   c:'#5b4fcf', bg:'rgba(91,79,207,.10)',  brd:'rgba(91,79,207,.40)'},
    {key:'gold',     medal:'🥇', label:'Gold',               sub:'75 – 89.9%',  c:'#b58a1b', bg:'rgba(181,138,27,.10)', brd:'rgba(181,138,27,.40)'},
    {key:'silver',   medal:'🥈', label:'Silver',             sub:'60 – 74.9%',  c:'#5f6b75', bg:'rgba(95,107,117,.10)', brd:'rgba(95,107,117,.40)'},
    {key:'bronze',   medal:'🥉', label:'Bronze',             sub:'Below 60%',   c:'#a0592c', bg:'rgba(160,89,44,.10)',  brd:'rgba(160,89,44,.40)'},
    {key:'incomplete', medal:'⏳', label:'Domains Incomplete', sub:'SCM+EDRC+Quality+Ops', c:'#8a5200', bg:'rgba(217,140,31,.10)', brd:'rgba(217,140,31,.40)'},
    {key:'notRated', medal:'—',  label:'Not Rated Till Now', sub:'no rating yet', c:'#33383d', bg:'var(--s2)',          brd:'var(--brd)'},
  ];
  const rated=t.platinum.length+t.gold.length+t.silver.length+t.bronze.length;
  const cols=defs.map(d=>{
    const list=t[d.key];
    const body=list.length ? list.map(v=>{
      const tip = d.key==='incomplete'
        ? `${hesc(v.name||v.code)} — pending: ${hesc((v.missing||[]).join(', '))}`
        : `View ${hesc(v.name||v.code)} items`;
      return `
      <div onclick="scoreTierPickVendor('${esc(v.code)}')" title="${tip}" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 7px;border:1px solid var(--brd);background:var(--s1);border-radius:var(--r);">
        <div style="min-width:0;">
          <div style="font-size:11.5px;font-weight:600;color:var(--navy);word-break:normal;overflow-wrap:break-word;text-wrap:pretty;line-height:1.25;">${hesc(v.name||v.code)}</div>
          ${v.name?`<div style="font-family:var(--mono);font-size:9.5px;color:var(--t2);word-break:normal;overflow-wrap:normal;margin-top:1px;">${wbrCode(vendorCodeDisplay(v.code))}</div>`:''}
        </div>
        ${v.score!=null?`<span style="font-family:var(--hd);font-weight:700;font-size:12.5px;color:${d.c};white-space:nowrap;">${v.score.toFixed(1)}%</span>`:`<span style="font-size:9px;color:var(--t2);font-family:var(--mono);white-space:nowrap;">${v.itemCount} item${v.itemCount===1?'':'s'}</span>`}
      </div>`;
    }).join('') : `<div style="font-size:11px;color:var(--t2);text-align:center;padding:10px 6px;font-style:italic;">None</div>`;
    return `
      <div style="border:1px solid ${d.brd};border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column;background:var(--s1);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;background:${d.bg};border-bottom:1px solid ${d.brd};">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;">
            <span style="font-size:13px;line-height:1;flex-shrink:0;">${d.medal}</span>
            <div style="min-width:0;">
              <div style="font-family:var(--hd);font-weight:700;text-transform:uppercase;letter-spacing:.4px;font-size:13px;color:${d.c};line-height:1.05;">${d.label}</div>
              <div style="font-size:9.5px;color:var(--t2);font-family:var(--mono);margin-top:1px;">${d.sub}</div>
            </div>
          </div>
          <span style="font-family:var(--hd);font-weight:700;font-size:15px;color:${d.c};flex-shrink:0;">${list.length}</span>
        </div>
        <div style="padding:6px;display:flex;flex-direction:column;gap:4px;max-height:420px;overflow-y:auto;">${body}</div>
      </div>`;
  }).join('');
  return `
    <div class="pn" style="margin-bottom:20px;">
      <div class="phd"><h3 class="pt">Vendor Tiers</h3><div class="chps"><span class="ch ch-a">${scopeLabel()}</span><span class="ch ch-b">${rated} rated</span><span class="ch">${t.incomplete.length} domains incomplete</span><span class="ch">${t.notRated.length} not rated</span></div></div>
      <div class="pb"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:8px;align-items:start;">${cols}</div></div>
    </div>`;
}
