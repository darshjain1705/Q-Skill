/* ============================================================
 * 30-excel-import.js
 * File loading, PO Master parse, rating-workbook importer
 * ------------------------------------------------------------
 * Part of the Acme Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */
function loadFiles(files){
  DB = {};
  SHEETS = [];
  hydrateVendorMaster();   // keep previously-loaded Vendor Master contacts across reloads
  _filt = [];
  _pg = 1;
  // Fresh upload: forget any earlier manual H1/H2 pick so auto-detection
  // (based on the newly-uploaded workbook's delivery dates) can run again.
  window._quarterManuallySet = false;
  let done=0;
  let loadedAny=false;
  const failures=[];
  files.forEach(f=>{
    const r=new FileReader();
    r.onload=ev=>{
      // Show loading toast immediately so UI doesn't appear frozen during parse
      toast('Reading ' + f.name + ' — please wait…', 'ok');
      // Defer the heavy parse via setTimeout so the toast actually paints first
      setTimeout(() => {
      try{
        const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'});
        // Try the ratings-import path first. If this workbook is a Vendor_Ratings export from the
        // companion Excel template, extract ratings into itemRatings/appStorage and skip normal parse for
        // the Ratings sheet (other sheets still go through smartParse).
        const ratingsImportResult = tryImportRatingsWorkbook(wb, f.name);
        const vendorMasterResult = tryImportVendorMaster(wb);
        if (vendorMasterResult && (vendorMasterResult.count > 0 || vendorMasterResult.locCount > 0)) {
          loadedAny = true;
          const _vmParts = [];
          if (vendorMasterResult.count > 0) _vmParts.push(`${vendorMasterResult.count} contact(s)`);
          if (vendorMasterResult.locCount > 0) _vmParts.push(`${vendorMasterResult.locCount} location(s)`);
          toast(`Vendor Master loaded — ${_vmParts.join(', ')}`, 'ok');
        }
        wb.SheetNames.forEach(sn=>{
          if (ratingsImportResult && ratingsImportResult.skipSheets.has(sn)) return;
          if (vendorMasterResult && vendorMasterResult.skipSheets.has(sn)) return;
          const raw=XLSX.utils.sheet_to_json(trimSheetRange(wb.Sheets[sn]),{header:1,defval:''});
          const parsed=smartParse(raw,sn,f.name);
          if(parsed && !isDataSheet(raw,parsed)){
            // Non-tabular (instructions / notes tab) — skip so it can't
            // inflate vendor and rating counts with prose lines.
            failures.push(`${f.name}:${sn} (not tabular — skipped)`);
            return;
          }
          if(parsed){
            let id = parsed.id;
            let suffix = 1;
            while (DB[id]) id = `${parsed.id}::${suffix++}`;
            parsed.id = id;
            parsed.rows.forEach(r=>r.sheetId = id);
            DB[id] = parsed;
            loadedAny = true;
          } else failures.push(`${f.name}:${sn}`);
        });
        if (ratingsImportResult && ratingsImportResult.importedRatings > 0) {
          loadedAny = true;
        }
      }catch(e){toast('Error: '+f.name,'err');console.error(e)}
      if(++done===files.length){
        if(!loadedAny){
          toast('No data found. Check file headers or use Parse Debug.','err');
          console.warn('Parse failures:', failures);
        }
        afterLoad();
      }
      }, 50);
    };
    r.onerror=()=>{toast('Unable to read '+f.name,'err'); if(++done===files.length) afterLoad();};
    r.readAsArrayBuffer(f);
  });
}


// Vendor Ratings workbook import (per-category sheets, half-yearly)
// Reads a workbook produced by the companion Excel template (Vendor_Rating.xlsx)
// and loads its ratings into appStorage so the dashboard's existing UI shows them.
//
// The companion workbook has FOUR per-category input sheets (one row per PO × H1/H2),
// plus a PO Master (day_1 layout) used to compute stableKey:
//   • SCM        — code columns A1..A15 → scm_0..scm_14
//   • EDRC       — code columns B1..B5  → edrc_0..edrc_4
//   • Quality    — code columns C1..C11 → quality_0..quality_10
//   • Operation  — code columns D1..D10 → operation_0..operation_9
// Each sheet also carries PO Number, Vendor / Description, Period (H1/H2), Job Code, Job Description.


// Vendor Ratings workbook import
// Reads a workbook produced by the companion Excel template (Vendor_Ratings_*.xlsx)
// and loads its ratings into appStorage so the dashboard's existing UI shows them.
//
// CRITICAL: We must compute stableKey EXACTLY the same way the dashboard does.
// The dashboard runs smartParse() on the PO Master sheet, which uses FIELD_PATTERNS
// with first-match-wins + usedCols deduplication. So a column resolved as "vendor"
// may not be VENDOR DESC — for day_1 layout it actually ends up as VENDOR MSME TAG
// because vendorName claims VENDOR DESC first. We replay that exact algorithm here
// to get the same column resolution.

function tryImportRatingsWorkbook(wb, fileName) {
  const sheetNames = wb.SheetNames || [];

  // Category catalogue. Each category always maps to the same internal catId, but the
  // workbook may name the sheet differently across versions — the current workbook renamed
  // "Operation" → "Operations". List every accepted sheet name and resolve to whichever is present.
  const CAT_LIST = [
    { catId: 'scm',       prefix: 'A', count: 15, names: ['SCM'] },
    { catId: 'edrc',      prefix: 'B', count: 5,  names: ['EDRC'] },
    { catId: 'quality',   prefix: 'C', count: 11, names: ['Quality'] },
    { catId: 'operation', prefix: 'D', count: 10, names: ['Operations', 'Operation'] },
  ];
  // Resolve each category to the actual sheet name present in this workbook.
  // CAT_DEF: actual sheet name → { catId, prefix, count }
  const CAT_DEF = {};
  for (const c of CAT_LIST) {
    const sn = c.names.find(n => sheetNames.includes(n));
    if (sn) CAT_DEF[sn] = { catId: c.catId, prefix: c.prefix, count: c.count };
  }

  // Detect the companion workbook: PO Master + all four per-category sheets (any accepted name).
  const isCompanion = sheetNames.includes('PO Master') &&
                      CAT_LIST.every(c => c.names.some(n => sheetNames.includes(n)));
  if (!isCompanion) return null;

  // Skip helper sheets AND the four category sheets from smartParse (only PO Master is PO data).
  const skipSheets = new Set(['Instructions', 'Parameters', 'Dashboard', ...Object.keys(CAT_DEF)]);
  const result = {
    skipSheets: skipSheets,
    importedRatings: 0,
    quarters: [],
  };

  // Period parser: accepts "H1"/"H2" (tolerant of trailing spaces / case).
  function quarterToHTMLFormat(qStr) {
    const s = String(qStr || '').trim();
    const plain = s.match(/^H([12])$/i);
    if (plain) return `H${plain[1]}`;
    return null;
  }

  // Read PO Master using FIXED column positions (new format)
  // New PO Master layout (1-indexed Excel cols, 0-indexed JS arrays):
  //   A(0)=JOB CODE, B(1)=Job Description, E(4)=VENDOR CODE,
  //   F(5)=VENDOR DESC, G(6)=PO NUMBER, AW(48)=Active, AX(49)=ActiveIndex
  //
  // We also fall back to header-scanning for resilience, but always trust
  // the known fixed indices when headers match exactly.
  const poToFields = {};
  const allActivePOs = new Set(); // POs currently in PO Master (for deletion logic)
  const masterPOs = [];

  if (sheetNames.includes('PO Master')) {
    const pmSheet = wb.Sheets['PO Master'];
    const pmRaw = XLSX.utils.sheet_to_json(trimSheetRange(pmSheet), {header:1, defval:''});
    if (pmRaw.length) {
      const pmHeaders = (pmRaw[0] || []).map(c => String(c || '').trim());

      // Locate columns by header name (robust to column order changes)
      function findCol(patterns) {
        for (let ci = 0; ci < pmHeaders.length; ci++) {
          const h = pmHeaders[ci];
          if (!h) continue;
          if (patterns.some(p => p.test(h))) return ci;
        }
        return -1;
      }

      const fPO         = findCol([/^po\s*number$/i, /^po\s*no$/i, /^po\s*num$/i]);
      const fVendorDesc = findCol([/^vendor\s*desc$/i, /^vendor\s*description$/i, /^vendor\s*name$/i]);
      const fVendorCode = findCol([/^vendor\s*code$/i, /^vendor\s*id$/i, /^vendor\s*no$/i]);
      const fJobDesc    = findCol([/^job\s*desc/i, /^job\s*description$/i]);
      const fJobCode    = findCol([/^job\s*code$/i, /^job\s*no$/i]);
      const fActive     = findCol([/^active$/i]);

      if (fPO >= 0) {
        for (let r = 1; r < pmRaw.length; r++) {
          const row = pmRaw[r] || [];
          const po = String(row[fPO] || '').trim();
          if (!po) continue;

          // Skip POs marked as inactive (Active col = "No") BEFORE recording position, so
          // masterPOs mirrors the active-PO order the category sheets follow. Recording
          // inactive POs here would shift the positional fallback below for every later row.
          if (fActive >= 0) {
            const activeVal = String(row[fActive] || '').trim().toLowerCase();
            if (activeVal === 'no') continue;
          }

          masterPOs.push(po);
          allActivePOs.add(po);
          poToFields[po] = {
            vendor:     fVendorCode >= 0 ? String(row[fVendorCode] || '').trim() : '',
            vendorName: fVendorDesc >= 0 ? String(row[fVendorDesc] || '').trim() : '',
            vendorCode: fVendorCode >= 0 ? String(row[fVendorCode] || '').trim() : '',
            item:       fJobDesc    >= 0 ? String(row[fJobDesc]    || '').trim() : '',
            jobCode:    fJobCode    >= 0 ? String(row[fJobCode]    || '').trim() : '',
          };
        }
      }
    }
  }

  // Read the four category sheets, combining stars per (Half-Year × PO)
  // combined[period][po]     = { scm_0:4, edrc_2:3, quality_5:5, ... } merged across all 4 sheets.
  // combinedMeta[period][po] = { scm:{buyer,approver}, edrc:{...}, ... } (manual Buyer/Approver).
  const combined = {};
  const combinedMeta = {};
  // Evaluator progress, accumulated in the row loop below and kept separate from the
  // scores themselves — see the note at the evalFilled computation for why.
  const progressByQuarter = {};
  PO_ITEM_MAP = {};   // rebuilt from the ITEM column on every load
  const buyerTeamTally = {};   // normKey -> { display, teams:{ catId:count } } for auto team-tagging
  let totalCells = 0;
  let totalMeta = 0;

  for (const sheetName of Object.keys(CAT_DEF)) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const sraw = XLSX.utils.sheet_to_json(trimSheetRange(sheet), { header: 1, defval: '' });
    if (!sraw.length) continue;
    const { catId, prefix, count } = CAT_DEF[sheetName];
    // Support headers like "A1" or "Buyer A1" or "Approver A1"
    const code1Re = new RegExp('^(?:buyer\\s*|approver\\s*|evaluator\\s*)?' + prefix + '1$', 'i');

    // header row: contains "PO Number" AND this category's first code (e.g. "A1")
    let hrow = -1;
    for (let i = 0; i < Math.min(sraw.length, 12); i++) {
      const norm = (sraw[i] || []).map(c => String(c || '').trim());
      if (norm.some(c => /^po\s*number$/i.test(c)) && norm.some(c => code1Re.test(c))) { hrow = i; break; }
    }
    if (hrow < 0) continue;

    const hdrs = (sraw[hrow] || []).map(c => String(c || '').trim());
    const idxPO     = hdrs.findIndex(h => /^po\s*number$/i.test(h));
    const idxPeriod = hdrs.findIndex(h => /^period$/i.test(h) || /^half/i.test(h) || /^quarter$/i.test(h));
    if (idxPO < 0) continue;
    // The sheets label this column "Evaluator"; older workbooks called it "Buyer".
    const idxBuyer    = hdrs.findIndex(h => /^(buyer|evaluator)s?$/i.test(h));
    const idxApprover = hdrs.findIndex(h => /^approv/i.test(h));
    const idxStatus   = hdrs.findIndex(h => /^status$/i.test(h));
    // The user-entered ITEM column (a.k.a. "item name"). Present on SCM today and on any
    // other category sheet where the user adds it. Harvested into PO_ITEM_MAP per PO+period.
    const idxItem     = hdrs.findIndex(h => /^item(\s*name)?$/i.test(h) || /^major\s*items?$/i.test(h));
    // Free-text REMARKS column, appended at the end of each category sheet. This is the
    // evaluator/approver's own note on THIS team's rating of THIS PO - distinct from the
    // unrelated "Buyer Remarks" column some PO Master/PO Report imports carry (that one
    // lands on item.remarks via FIELD_PATTERNS in 20-world-map.js and is procurement
    // commentary, not a rating remark). Stored per PO+period+category alongside
    // buyer/approver/status below, never merged with that other field.
    const idxRemarks  = hdrs.findIndex(h => /^remarks?$/i.test(h) || /^comments?$/i.test(h));

    // Locate each parameter's rating column(s). The workbook carries TWO rating sets per
    // parameter — the Evaluator's and the Approver's — separated by an "Approver Score /5"
    // column, each headed with the bare code (e.g. "A1"). Older workbooks exported a single
    // pre-resolved bare-code column instead. So per code we collect every exact "<code>"
    // header: two matches → { eval, appr }; one match → an already-resolved final value.
    const idxApprScore = hdrs.findIndex(h => /^approver\s*score/i.test(h));
    const pcols = [];
    for (let i = 1; i <= count; i++) {
      const re = new RegExp('^(?:buyer\\s*|approver\\s*|evaluator\\s*)?' + prefix + i + '$', 'i');
      const matches = [];
      for (let ci = 0; ci < hdrs.length; ci++) { if (re.test(hdrs[ci])) matches.push(ci); }
      if (!matches.length) continue;
      let evalCol, apprCol;
      if (matches.length === 1) {
        evalCol = matches[0]; apprCol = -1;               // single pre-resolved column
      } else if (idxApprScore >= 0) {
        evalCol = matches.find(ci => ci < idxApprScore);
        apprCol = matches.find(ci => ci > idxApprScore);
        if (evalCol == null) evalCol = matches[0];
        if (apprCol == null) apprCol = matches[matches.length - 1];
      } else {
        evalCol = matches[0]; apprCol = matches[1];       // fallback: first=eval, second=appr
      }
      pcols.push({ evalCol, apprCol, idx: i - 1 });
    }
    if (!pcols.length) continue;

    // Which rating set is FINAL for a row, mirroring the workbook's own FINAL SCORE formula
    //   =IF(STATUS="","", IF(STATUS="Approved", EvaluatorScore, ApproverScore)):
    // ...but that formula's "blank STATUS → no score" rule is specifically about the
    // workbook's FINAL/approved score column, not about whether the row has been rated
    // at all. Applying it here too (skipping blank-STATUS rows outright) meant an
    // evaluator who filled in every parameter, with the approver simply not having acted
    // yet, imported as zero data for that PO/category — indistinguishable from a line
    // nobody had touched. That's what made Rating Completeness show 0 "Fully rated,
    // awaiting approval" lines when the workbook clearly had evaluator scores sitting
    // there pending sign-off (see combined[]/itemRatings below, and contrast with the
    // separate `evalFilled`/progressByQuarter tracking a few lines down, which already
    // had to work around the exact same gap for Team Workload's "rated" counts).
    //     NA                → not applicable this period → no score ('skip')
    //     blank STATUS      → not yet approved, but still whatever the evaluator entered → ('eval')
    //     STATUS "Approved" → the Evaluator's columns ('eval')
    //     otherwise         → the Approver's columns ('appr')   (e.g. "Changed and Approved")
    // Older single-column workbooks carry an already-resolved value and ignore STATUS here.
    const pickFor = (st) => {
      if (isNAStatus(st)) return 'skip';
      if (!st) return 'eval';
      return /^approved$/i.test(st) ? 'eval' : 'appr';
    };

    for (let r = hrow + 1; r < sraw.length; r++) {
      const row = sraw[r] || [];
      let po = String(row[idxPO] || '').trim();
      const periodRaw = idxPeriod >= 0 ? String(row[idxPeriod] || '').trim() : '';
      const period = periodRaw || activeQuarter;
      
      if (!po && masterPOs.length > 0) {
        const dataOffset = r - (hrow + 1);
        const masterIdx = Math.floor(dataOffset / 2);
        if (masterPOs[masterIdx]) {
          po = masterPOs[masterIdx];
        }
      }
      
      if (!po) continue;
      const pKey = quarterToHTMLFormat(period);
      if (!pKey) continue;
      // Record the user-entered item name for this PO + period. Later category sheets don't
      // clobber an item already set for the same PO+period by an earlier sheet (SCM wins first),
      // but they do fill in entries for periods SCM left blank.
      if (idxItem >= 0) {
        const itemVal = String(row[idxItem] || '').trim();
        if (itemVal) {
          const ik = itemKeyOf(pKey, po);
          if (!PO_ITEM_MAP[ik]) PO_ITEM_MAP[ik] = itemVal;
        }
      }
      // approval Status for this category (also drives Evaluator/Approver selection below)
      const status= idxStatus >= 0 ? String(row[idxStatus] || '').trim() : '';
      const pick = pickFor(status);
      for (const { evalCol, apprCol, idx } of pcols) {
        let v;
        if (apprCol < 0) {
          v = evalCol >= 0 ? row[evalCol] : '';         // single pre-resolved column (status-independent)
        } else {
          if (pick === 'skip') continue;                // NA → not applicable, no score expected
          const col = pick === 'appr' ? apprCol : evalCol;
          v = col >= 0 ? row[col] : '';                 // Approved → Evaluator's set; else → Approver's set
        }
        if (v === null || v === undefined || v === '') continue;
        const n = parseInt(v, 10);
        if (n >= 1 && n <= 5) {
          if (!combined[pKey]) combined[pKey] = {};
          if (!combined[pKey][po]) combined[pKey][po] = {};
          combined[pKey][po][`${catId}_${idx}`] = n;
          totalCells++;
        }
      }
      // Did the EVALUATOR actually fill their half of the sheet? Now that pickFor() also
      // records a blank-STATUS row's evaluator columns (see above), this mostly agrees
      // with `combined` for two-column sheets — kept as its own explicit flag because it's
      // read independently by Team Workload (progressByQuarter) and because single-column
      // sheets (apprCol<0) never populate it via the loop above at all.
      let evalFilled = false;
      for (const { evalCol } of pcols) {
        if (evalCol < 0) continue;
        const nv = parseInt(row[evalCol], 10);
        if (nv >= 1 && nv <= 5) { evalFilled = true; break; }
      }
      if (evalFilled) {
        if (!progressByQuarter[pKey]) progressByQuarter[pKey] = {};
        const psk = `po:${po}|ven:|item:`;
        if (!progressByQuarter[pKey][psk]) progressByQuarter[pKey][psk] = {};
        progressByQuarter[pKey][psk][catId] = true;
      }
      // Mirror of evalFilled for the APPROVER's own columns. By explicit rule, a category
      // only counts as "done" once STATUS itself is actually typed in (see
      // itemCompleteness() in 85-view-completeness.js) — apprFilled does NOT feed that
      // gate. It's kept purely as a display signal: rows where the approver has entered
      // score numbers but never set STATUS can be labelled "Pending Approval" rather than
      // the more ambiguous "Pending" a fully-untouched row also shows.
      let apprFilled = false;
      for (const { apprCol } of pcols) {
        if (apprCol == null || apprCol < 0) continue;
        const nv = parseInt(row[apprCol], 10);
        if (nv >= 1 && nv <= 5) { apprFilled = true; break; }
      }

      // manual Buyer / Approver names for this category, and this team's rating remark
      const buyer    = idxBuyer    >= 0 ? String(row[idxBuyer]    || '').trim() : '';
      const approver = idxApprover >= 0 ? String(row[idxApprover] || '').trim() : '';
      const remarks  = idxRemarks  >= 0 ? String(row[idxRemarks]  || '').trim() : '';
      if (buyer) {
        const bk = normBuyerKey(buyer);
        if (!buyerTeamTally[bk]) buyerTeamTally[bk] = { display: buyer, teams: {} };
        buyerTeamTally[bk].teams[catId] = (buyerTeamTally[bk].teams[catId] || 0) + 1;
      }
      // Record the row even when Buyer, Approver and Status are ALL blank. The row's
      // existence on a category sheet is itself the fact that matters — that evaluation
      // is owed. Skipping these made Team Workload report 244 SCM and 238 EDRC
      // evaluations against the workbook's flat 250 per team.
      if (!combinedMeta[pKey]) combinedMeta[pKey] = {};
      if (!combinedMeta[pKey][po]) combinedMeta[pKey][po] = {};
      combinedMeta[pKey][po][catId] = { buyer, approver, status, remarks, apprFilled };
      if (buyer || approver || status || remarks || apprFilled) totalMeta++;   // count only rows that carry data
    }
  }

  // Auto-tag buyers to teams from the per-category Buyer columns (Excel drives team membership)
  const autoTagged = applyBuyerTeamAutoTags(buyerTeamTally);

  // Expand to stableKey-variant maps per half-year (ratings + buyer/approver)
  // stableKey(i) in the dashboard uses i.vendor (resolved via FIELD_PATTERNS) + i.item (job desc).
  // We store several variants per PO to guarantee a match regardless of column resolution.
  const ratingsByQuarter = {};
  const metaByQuarter = {};
  let matchedPOs = 0;
  let unmatchedPOs = 0;
  const allPeriods = new Set([...Object.keys(combined), ...Object.keys(combinedMeta)]);
  for (const pKey of allPeriods) {
    ratingsByQuarter[pKey] = {};
    metaByQuarter[pKey] = {};
    const posInPeriod = new Set([
      ...Object.keys(combined[pKey] || {}),
      ...Object.keys(combinedMeta[pKey] || {})
    ]);
    for (const po of posInPeriod) {
      const rowRatings = (combined[pKey] || {})[po];
      const rowMeta = (combinedMeta[pKey] || {})[po];
      const meta = poToFields[po];
      const skVariants = new Set();
      if (meta) {
        matchedPOs++;
        skVariants.add(`po:${po}|ven:${meta.vendorCode}|item:${meta.item}`);
        if (meta.vendorName) skVariants.add(`po:${po}|ven:${meta.vendorName}|item:${meta.item}`);
        if (meta.vendor && meta.vendor !== meta.vendorCode) skVariants.add(`po:${po}|ven:${meta.vendor}|item:${meta.item}`);
      } else {
        unmatchedPOs++;
      }
      skVariants.add(`po:${po}|ven:|item:`);
      skVariants.forEach(sk => {
        if (rowRatings) ratingsByQuarter[pKey][sk] = Object.assign({}, ratingsByQuarter[pKey][sk] || {}, rowRatings);
        if (rowMeta)    metaByQuarter[pKey][sk]    = Object.assign({}, metaByQuarter[pKey][sk]    || {}, rowMeta);
      });
    }
  }

  if (totalCells === 0 && totalMeta === 0) {
    toast('Companion workbook loaded — POs imported but no ratings or buyer/approver filled in yet.', 'ok');
    return result;
  }

  // Sync appStorage: replace touched half-years, purge deleted POs
  const periodsTouched = new Set();

  // collect every half-year ever saved (ratings or buyer/approver)
  const allSavedQKeys = new Set();
  try {
    for (let li = 0; li < appStorage.length; li++) {
      const lk = appStorage.key(li);
      const m2 = lk && lk.match(/^lnt_(?:itemRatings|categoryMeta|evalProgress)_(H[12])$/);
      if (m2) allSavedQKeys.add(m2[1]);
    }
  } catch(e) {}

  // Half-years that received star ratings: fully replace itemRatings
  for (const qKey of Object.keys(ratingsByQuarter)) {
    if (!combined[qKey]) continue;
    periodsTouched.add(qKey);
    const lsKey = `lnt_itemRatings_${qKey}`;
    try { appStorage.setItem(lsKey, JSON.stringify(ratingsByQuarter[qKey])); }
    catch (e) { console.warn('appStorage write failed for', lsKey, e); }
  }
  // Half-years that received buyer/approver: fully replace categoryMeta
  for (const qKey of Object.keys(metaByQuarter)) {
    if (!combinedMeta[qKey]) continue;
    periodsTouched.add(qKey);
    const lsKey = `lnt_categoryMeta_${qKey}`;
    try { appStorage.setItem(lsKey, JSON.stringify(metaByQuarter[qKey])); }
    catch (e) { console.warn('appStorage write failed for', lsKey, e); }
  }

  // Half-years that received evaluator progress
  for (const qKey of Object.keys(progressByQuarter)) {
    periodsTouched.add(qKey);
    const lsKey = `lnt_evalProgress_${qKey}`;
    try { appStorage.setItem(lsKey, JSON.stringify(progressByQuarter[qKey])); }
    catch (e) { console.warn('appStorage write failed for', lsKey, e); }
  }

  // For ALL saved half-years: remove entries for POs no longer in PO Master
  if (allActivePOs.size > 0) {
    const purge = (lsKey) => {
      try {
        const stored = appStorage.getItem(lsKey);
        if (!stored) return;
        const existing = JSON.parse(stored);
        let changed = false;
        for (const sk of Object.keys(existing)) {
          // stableKey format: "po:PO_NUMBER|ven:...|item:..."
          const poMatch = sk.match(/^po:([^|]+)\|/);
          if (poMatch && !allActivePOs.has(poMatch[1])) { delete existing[sk]; changed = true; }
        }
        if (changed) appStorage.setItem(lsKey, JSON.stringify(existing));
      } catch(e) {}
    };
    for (const qKey of allSavedQKeys) {
      purge(`lnt_itemRatings_${qKey}`);
      purge(`lnt_categoryMeta_${qKey}`);
      purge(`lnt_evalProgress_${qKey}`);
    }
  }

  // Sync in-memory state for the currently-active half-year
  try {
    const stored = appStorage.getItem(`lnt_itemRatings_${activeQuarter}`);
    if (stored) itemRatings = JSON.parse(stored);
  } catch (e) {}
  try {
    const storedM = appStorage.getItem(`lnt_categoryMeta_${activeQuarter}`);
    if (storedM) categoryMeta = JSON.parse(storedM);
  } catch (e) {}

  const quartersTouched = [...periodsTouched].sort();
  const qSummary = quartersTouched.join(', ');
  let msg = `Imported ${totalCells} rating cell${totalCells===1?'':'s'}`;
  if (totalMeta > 0) msg += ` + ${totalMeta} buyer/approver`;
  msg += ` (${matchedPOs} matched PO${matchedPOs===1?'':'s'}`;
  if (unmatchedPOs > 0) msg += `, ${unmatchedPOs} unmatched`;
  msg += `) across ${quartersTouched.length} half-year(s): ${qSummary}`;
  if (autoTagged > 0) msg += ` · auto-tagged ${autoTagged} buyer${autoTagged===1?'':'s'} to teams`;
  toast(msg, 'ok');
  console.log('[Rating Import]', { totalCells, totalMeta, matchedPOs, unmatchedPOs, quarters: quartersTouched });

  result.importedRatings = totalCells + totalMeta;
  result.quarters = quartersTouched;
  return result;
}

function afterLoad(){
  invalidateAll();
  SHEETS=Object.keys(DB);
  // Fold vendor codes that share the same PO Master vendor name (e.g. Siemens'
  // several regional codes) into one company-level vendor identity — must run
  // before the email backfill and buildNav() so every downstream page sees it.
  if(typeof applyVendorCompanyGrouping==='function') applyVendorCompanyGrouping(all());
  // Backfill vendor emails from the Vendor Master onto every PO row that lacks one.
  if(Object.keys(VENDOR_EMAILS).length){
    all().forEach(i=>{ if(!i.vendorEmail){ const e=vendorEmailFor(i.vendor,i.vendorName); if(e) i.vendorEmail=e; } });
  }
  if(!SHEETS.length){
    if(Object.keys(VENDOR_EMAILS).length){
      toast('Vendor Master saved ✓ — now load your PO tracker file (emails will apply automatically)','ok');
    } else {
      toast('No data found','err');
    }
    return;
  }
  const total=all().length;
  buildNav();
  if (typeof updateTopbarScope === 'function') updateTopbarScope();
  if(upscreenEl) upscreenEl.style.display='none';
  autoDetectQuarter();
  if (typeof loadPersistedRatings === 'function') loadPersistedRatings();
  if(window.location.hash) handleHash(); else go('overview');
  toast(SHEETS.length+' sheet(s) · '+total+' items loaded');
}

function goHome(){
  invalidateAll(); DB={}; SHEETS=[]; _filt=[]; _pg=1; activeRatingKey=''; VENDOR_EMAILS={}; VENDOR_CC={}; VENDOR_LOCATION={};
  try{ appStorage.removeItem('lnt_vendorEmails'); appStorage.removeItem('lnt_vendorCc'); appStorage.removeItem('lnt_vendorLocation'); }catch(e){}
  const pnav=document.getElementById('pnav');
  if(pnav) pnav.innerHTML='';
  document.querySelectorAll('.nav').forEach(e=>e.classList.remove('on'));
  const ov=document.getElementById('nav-overview'); if(ov) ov.classList.add('on');
  const main=document.getElementById('main');
  main.innerHTML='';
  if(upscreenEl){ upscreenEl.style.display='flex'; main.appendChild(upscreenEl); }
}

function showParseDebug(){
  const content = SHEETS.map(name=>{
    const item = DB[name];
    const fields = item.fields || {};
    const headers = item.headers || [];
    const mapped = Object.entries(fields).map(([k,v])=>`<div><strong>${k}</strong>: col ${v+1} — ${hesc(headers[v]||'')}</div>`).join('');
    return `<section style="margin-bottom:22px"><h4>${hesc(name)}</h4><div style="font-size:12px;color:var(--t2);margin-bottom:10px">Header row: ${hesc(headers.join(' | '))}</div>${mapped}</section>`;
  }).join('');
  const el = document.getElementById('dbg-content');
  if(el) el.innerHTML = `<h3>Parse Debug</h3>${content}`;
  document.getElementById('debug-modal').style.display = 'flex';
}
function hideDebug(){document.getElementById('debug-modal').style.display = 'none'}


// EXPORT

const EXP_KEYS=['item','vendor','acc','poIssued','poNum','poVal','poDate','mfcStatus','bgReq','payTerms','lc','leadTime','remarks','qty'];
function sheetAOA(name){ return [EXP_KEYS, ...((DB[name]?.rows||[]).map(i=>EXP_KEYS.map(k=>i[k]??''))) ]; }
function allAOA(){ const keys=['sheet',...EXP_KEYS]; return [keys, ...all().map(i=>keys.map(k=>i[k]??''))]; }
function expSheet(name){ dlCSV(toCSV(sheetAOA(name)), name.replace(/\s+/g,'_')+'_export.csv'); toast('Exported CSV: '+name,'ok'); }
function expSheetXlsx(name){ dlXLSX(sheetAOA(name), name, name.replace(/\s+/g,'_')+'_export.xlsx'); }
function expAll(){ dlCSV(toCSV(allAOA()),'procurement_all.csv'); toast('Full CSV export done','ok'); }
function expAllXlsx(){ dlXLSX(allAOA(),'Procurement','procurement_all.xlsx'); }
/* CSV cell — neutralise Excel formula-injection (=,+,-,@,tab,CR) and quote/escape per RFC 4180 */
function csvCell(v){ let s=(v==null)?'':String(v); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; if(/[",\n\r]/.test(s)) s='"'+s.replace(/"/g,'""')+'"'; return s; }
function toCSV(aoa){ return aoa.map(r=>r.map(csvCell).join(',')).join('\r\n'); }
function dlCSV(t,f){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+t],{type:'text/csv;charset=utf-8;'})); a.download=f; document.body.appendChild(a); a.click(); document.body.removeChild(a); }
/* Excel export via SheetJS — values are written as text cells, so a leading "=" never runs as a formula */
function dlXLSX(aoa, sheetName, fname){
  try{
    if(typeof XLSX==='undefined' || !XLSX.writeFile){ toast('Excel export unavailable in this build','err'); return; }
    const ws=XLSX.utils.aoa_to_sheet(aoa), wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, String(sheetName||'Sheet1').replace(/[\\/?*\[\]:]/g,' ').slice(0,31));
    XLSX.writeFile(wb, fname);
    toast('Exported Excel: '+fname,'ok');
  }catch(e){ toast('Excel export failed','err'); }
}


// VIEW: OVERVIEW

// Portfolio Overview is vendor-rating centric: tier mix, category performance and
// a vendor scoreboard for the active half-year — no PO / sheet-completion metrics.
const CAT_COLORS = {scm:'#3f6d2c', edrc:'#2a5f6b', quality:'#9a6a07', operation:'#5f6b75'};
