/* ============================================================
 * 20-world-map.js
 * Natural Earth land path + region map renderer
 * ------------------------------------------------------------
 * Part of the Acme Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */
function worldMapSVG(regionCount, full){
  const W = 960, H = 500;
  const domTotal = (regionCount.north||0)+(regionCount.west||0)+(regionCount.east||0)+(regionCount.south||0);

  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#dbeafe" rx="10"/>
    <path d="${WORLD_LAND_PATH}" fill="#dde8d1" stroke="#b3c3a1" stroke-width="0.7" stroke-linejoin="round"/>`;

  // Badge anchors below are the real projected pixel coordinates for each region's
  // representative lon/lat (equirectangular, same projection used to build the paths).
  const r = full ? 20 : 15, rs = full ? 17 : 12;
  s += _worldBadge(280,230, r, '#c99a2e', regionCount.americas||0, 'Americas', full);
  s += _worldBadge(520,136, r, '#6b5b95', regionCount.europe||0, 'Europe', full);
  s += _worldBadge(533,262, r, '#9b2226', regionCount.africa||0, 'Africa', full);
  s += _worldBadge(603,201, rs,'#c0503a', regionCount.middleEast||0, 'Middle East', full);
  s += _worldBadge(768,182, r, '#4a6fa5', regionCount.eastAsia||0, 'China &amp; E. Asia', full);
  s += _worldBadge(779,254, rs,'#2e9b5b', regionCount.seAsia||0, 'SE Asia', full);

  if(full){
    // Full scale: India broken back out into its N/W/E/S mini-badges around the India anchor.
    s += `<circle cx="691" cy="191" r="11" fill="#8a5cc4" stroke="#fff" stroke-width="2"/><text x="691" y="195" text-anchor="middle" class="vpd-region-badge" style="font-size:10px">${regionCount.north||0}</text>`;
    s += `<circle cx="671" cy="211" r="11" fill="#1f8a72" stroke="#fff" stroke-width="2"/><text x="671" y="215" text-anchor="middle" class="vpd-region-badge" style="font-size:10px">${regionCount.west||0}</text>`;
    s += `<circle cx="711" cy="211" r="11" fill="#e0863a" stroke="#fff" stroke-width="2"/><text x="711" y="215" text-anchor="middle" class="vpd-region-badge" style="font-size:10px">${regionCount.east||0}</text>`;
    s += `<circle cx="691" cy="231" r="11" fill="#2f6fd0" stroke="#fff" stroke-width="2"/><text x="691" y="235" text-anchor="middle" class="vpd-region-badge" style="font-size:10px">${regionCount.south||0}</text>`;
    s += `<text x="691" y="253" text-anchor="middle" class="vpd-region-label" style="font-size:10px">India &middot; N/W/E/S</text>`;
    s += `<text x="395" y="243" text-anchor="middle" class="vpd-map-sea" style="font-size:13px">Atlantic Ocean</text>`;
    s += `<text x="66" y="230" text-anchor="middle" class="vpd-map-sea" style="font-size:13px">Pacific Ocean</text>`;
    s += `<text x="${W-15}" y="217" text-anchor="end" class="vpd-map-sea" style="font-size:13px">Pacific Ocean</text>`;
    s += `<text x="667" y="337" text-anchor="middle" class="vpd-map-sea" style="font-size:13px">Indian Ocean</text>`;
  } else {
    s += _worldBadge(691,215, rs, '#2f6fd0', domTotal, 'India', full);
  }
  s += `</svg>`;
  return s;
}
// Legend row (color dot + label + count) shown under both map sizes.
function worldMapLegendHtml(regionCount, full){
  const domTotal = (regionCount.north||0)+(regionCount.west||0)+(regionCount.east||0)+(regionCount.south||0);
  const rows = full
    ? [['North','#8a5cc4',regionCount.north||0],['West','#1f8a72',regionCount.west||0],
       ['East','#e0863a',regionCount.east||0],['South','#2f6fd0',regionCount.south||0],
       ['Middle East','#c0503a',regionCount.middleEast||0],['China &amp; E. Asia','#4a6fa5',regionCount.eastAsia||0],
       ['SE Asia','#2e9b5b',regionCount.seAsia||0],['Europe','#6b5b95',regionCount.europe||0],
       ['Americas','#c99a2e',regionCount.americas||0],['Africa','#9b2226',regionCount.africa||0]]
    : [['India','#2f6fd0',domTotal],['Middle East','#c0503a',regionCount.middleEast||0],
       ['China &amp; E. Asia','#4a6fa5',regionCount.eastAsia||0],['SE Asia','#2e9b5b',regionCount.seAsia||0],
       ['Europe','#6b5b95',regionCount.europe||0],['Americas','#c99a2e',regionCount.americas||0],
       ['Africa','#9b2226',regionCount.africa||0]];
  return `<div class="vpd-map-legend">${rows.map(([lb,c,ct])=>`<span><i style="background:${c}"></i>${lb} ${ct}</span>`).join('')}</div>`;
}

const GR={color:'rgba(124,132,140,.28)',lineWidth:1};
const TK={color:'#1b1f25',font:{size:13,family:'IBM Plex Mono',weight:'500'}};
/* suite integration: keep Chart.js tick/legend colours in step with the active light/dark theme */
let LEGEND_COL='#14171a';
function syncChartTheme(){
  try{
    const cs=getComputedStyle(document.documentElement);
    TK.color=(cs.getPropertyValue('--t2').trim())||'#3c424a';
    LEGEND_COL=(cs.getPropertyValue('--navy').trim())||'#14171a';
  }catch(e){}
}
let selectedOverviewTier = null;
function setOverviewTier(key){ selectedOverviewTier = key; rOverview(); }
let selectedAnalysisTeam = null; // null = All Teams; else 'scm'|'edrc'|'quality'|'operation'
let selectedAnalysisVendor = null; // null = All Vendors; else the vendor CODE
let selectedAnalysisBu = null; // null = All BUs; else the BU name from PO Master col AO
function setAnalysisTeam(catId){ selectedAnalysisTeam = catId || null; rOverview(); }
function setAnalysisVendor(code){ selectedAnalysisVendor = (code && String(code).trim()) ? String(code).trim() : null; rOverview(); }
// Picking a BU narrows the vendor dropdown too, so clear a vendor that is not in the new BU.
function setAnalysisBu(bu){ selectedAnalysisBu = (bu && String(bu).trim()) ? String(bu).trim() : null; selectedAnalysisVendor = null; rOverview(); }
function reRenderCurrent(){
  try{
    if(typeof DB==='undefined'||!DB||!Object.keys(DB).length) return; // nothing loaded — upload screen themes itself
    const on=document.querySelector('.nav.on'); if(!on) return;
    if(on.dataset&&on.dataset.sheet){ rSheet(on.dataset.sheet); return; }
    const v=(on.id||'').replace('nav-',''); if(v) go(v,true);
  }catch(e){}
}
// Draws a big number + small caption in the center of a doughnut chart.
// Enabled per-chart via options.plugins.donutCenterText = {display,big,small}.
const donutCenterText = {
  id: 'donutCenterText',
  afterDraw(chart){
    const opts = chart.options.plugins && chart.options.plugins.donutCenterText;
    if(!opts || !opts.display) return;
    const {ctx, chartArea} = chart;
    if(!chartArea) return;
    const cx = chartArea.left + chartArea.width/2;
    const cy = chartArea.top + chartArea.height/2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.color || LEGEND_COL;
    ctx.font = `700 ${opts.bigSize||26}px Barlow Condensed`;
    ctx.fillText(String(opts.big), cx, cy - (opts.small?10:0));
    if(opts.small){
      ctx.font = `600 ${opts.smallSize||11}px Barlow Condensed`;
      ctx.fillStyle = opts.smallColor || '#8a939c';
      ctx.fillText(opts.small, cx, cy + 12);
    }
    ctx.restore();
  }
};
// Draws a "NN%" label inside each slice of a doughnut/pie chart.
// Enabled per-chart via options.plugins.donutPercentLabels = {display,color,minPercent}.
const donutPercentLabels = {
  id: 'donutPercentLabels',
  afterDatasetsDraw(chart){
    const opts = chart.options.plugins && chart.options.plugins.donutPercentLabels;
    if(!opts || !opts.display) return;
    const meta = chart.getDatasetMeta(0);
    if(!meta || !meta.data || !meta.data.length) return;
    const ds = chart.data.datasets[0].data || [];
    const total = ds.reduce((a,b)=>a+(Number(b)||0),0);
    if(!total) return;
    const {ctx} = chart;
    ctx.save();
    ctx.font = `${opts.weight||700} ${opts.fontSize||12}px Barlow Condensed`;
    ctx.fillStyle = opts.color || '#fff';
    ctx.textBaseline = 'middle';
    meta.data.forEach((arc,i)=>{
      const val = Number(ds[i])||0;
      if(!val) return;
      const pct = val/total*100;
      if(pct < (opts.minPercent??5)) return;
      if(opts.outside){
        // Place the label just beyond the slice's outer edge (like the reference image).
        const pr = arc.getProps(['startAngle','endAngle','outerRadius','x','y'], true);
        const mid = (pr.startAngle + pr.endAngle) / 2;
        const r = pr.outerRadius + (opts.outsideOffset||14);
        const x = pr.x + Math.cos(mid)*r;
        const y = pr.y + Math.sin(mid)*r;
        ctx.textAlign = Math.cos(mid) >= 0 ? 'left' : 'right';
        ctx.fillText(Math.round(pct)+'%', x + (Math.cos(mid)>=0?1:-1), y);
      } else {
        const pos = arc.getCenterPoint();
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(pct)+'%', pos.x, pos.y);
      }
    });
    ctx.restore();
  }
};
function mkCh(id,cfg){
  requestAnimationFrame(()=>{
    const el=document.getElementById(id);if(!el)return;
    const ex=Chart.getChart(id);if(ex)ex.destroy();
    const c=new Chart(el.getContext('2d'),{...cfg,
      options:{responsive:true,maintainAspectRatio:false,
        // Staggered entrance: each bar/point animates in just after the previous one,
        // so a chart draws itself left-to-right rather than popping in whole.
        animation:(function(){
          var reduce=false; try{ reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
          if(reduce) return {duration:0};
          if(cfg.type==='doughnut'||cfg.type==='pie') return {duration:900,easing:'easeOutQuart',animateRotate:true,animateScale:true};
          return {duration:700,easing:'easeOutQuart',delay:function(ctx){
            return (ctx.type==='data'&&ctx.mode==='default')?ctx.dataIndex*38:0; }};
        })(),
        plugins:{legend:{labels:{color:LEGEND_COL,font:{size:12,family:'Barlow Condensed',weight:'600'},padding:16,boxWidth:10}},
          tooltip:{backgroundColor:'#14171a',titleColor:'#fff',bodyColor:'rgba(255,255,255,.85)',borderColor:'rgba(255,255,255,.1)',borderWidth:1,padding:10,cornerRadius:2,titleFont:{family:'Barlow Condensed'},bodyFont:{family:'IBM Plex Mono'}}},
        ...(cfg.options||{}),
        plugins:{legend:{labels:{color:LEGEND_COL,font:{size:12,family:'Barlow Condensed',weight:'600'},padding:16,boxWidth:10}},
          tooltip:{backgroundColor:'#14171a',titleColor:'#fff',bodyColor:'rgba(255,255,255,.85)',borderColor:'rgba(255,255,255,.1)',borderWidth:1,padding:10,cornerRadius:2,titleFont:{family:'Barlow Condensed'},bodyFont:{family:'IBM Plex Mono'}},...(cfg.options?.plugins||{})}}});
    _ch.push(c);
  });
}
syncChartTheme();
try{ new MutationObserver(function(){ syncChartTheme(); reRenderCurrent(); }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']}); }catch(e){}


// UNIVERSAL SMART PARSER

const FIELD_PATTERNS = {
  ic:         [/^ic$/i, /^independent\s*company$/i, /^company$/i, /^company\s*code$/i, /^entity$/i],
  bu:         [/^bu$/i, /^business\s*unit$/i, /^business\s*group$/i, /^division$/i, /^segment$/i],
  currency:   [/currency/i, /^curr$/i, /^ccy$/i, /^cur$/i, /^crcy$/i], // Broadened to catch "PO Currency" or "Document Currency"
  jobCode:    [/^job\s*code$/i, /^job\s*no$/i, /^project\s*code$/i, /wbs\s*element/i],
  vendorCode: [/vendor\s*code/i, /vendor\s*id/i, /vendor\s*num/i, /supplier\s*code/i, /supplier\s*id/i, /vendor\s*no/i],
  vendorName: [/vendor\s*name/i, /vendor\s*desc/i, /supplier\s*name/i, /vendor\s*description/i, /vendor\s*detail/i],
  email:      [/vendor\s*e-?mail/i, /supplier\s*e-?mail/i, /e-?mail\s*id/i, /mail\s*id/i, /contact\s*e-?mail/i, /vendor\s*mail/i, /e-?mail/i, /^mail$/i],
  vendor:     [/vendor\s*desc/i, /vendor/i, /supplier/i, /contractor/i, /agency/i, /manufacturer/i, /party/i],
  item:       [/job\s*desc/i, /warehouse\s*desc/i, /short\s*text/i, /material\s*desc/i, /major\s*items/i, /item\s*desc/i, /description(?!.*received)/i, /item\s*name/i, /^item$/i, /^name$/i],
  owner:      [/^buyer$/i, /accountab/i, /owner/i, /responsible/i, /assigned/i, /person/i, /engineer/i, /pm/i],
  poIssued:   [/po\s*status/i, /purchase\s*order\s*status/i, /status\s*of\s*po/i, /order\s*status/i, /^po$/i],
  poNumber:   [/po\s*number/i, /po\s*num/i, /po\s*no/i, /purchase\s*order\s*num/i, /order\s*num/i, /po\s*ref/i, /po\s*#/i],
  poValue:    [/po\s*value/i, /po\s*val/i, /order\s*val/i, /po\s*amount/i, /amount/i, /value/i, /cost/i, /budget\s*value/i],
  poDate:     [/po\s*date/i, /order\s*date/i, /purchase\s*date/i, /document\s*date/i],
  expDelivery:[/delivery\s*end\s*date/i, /delivery\s*date/i, /expected\s*delivery/i, /eta/i, /completion\s*date/i, /schedule.*date/i],
  deliveryStart:[/delivery\s*start\s*date/i, /start\s*date/i, /commencement\s*date/i, /kick.*off/i, /po\s*start/i],
  remarks:    [/buyer\s*remarks/i, /remark/i, /comment/i, /note/i, /observation/i],
  mfcStatus:  [/mfc/i, /manufacturing/i, /production\s*status/i],
  mfcDate:    [/mfc\s*date/i, /expected\s*mfc/i],
  leadTime:   [/lead\s*time/i, /delivery\s*time/i, /tat/i],
  bgReq:      [/bg\s*req/i, /bank\s*guarantee/i, /guarantee/i, /^bg$/i, /bg/i],
  payTerms:   [/paymentterms/i, /payment\s*term/i, /pay\s*term/i, /terms\s*of\s*payment/i],
  lc:         [/letter\s*of\s*credit/i, /^lc$/i, /^l\/c$/i],
  qty:        [/quantit/i, /^qty$/i, /^nos$/i, /^units$/i],
  status:     [/^status$/i, /current\s*status/i, /progress/i, /stage/i],
  risk:       [/^risk$/i, /risk\s*level/i, /risk\s*rating/i, /issue\s*level/i],
  cat:        [/^cat$/i, /category/i, /^type$/i, /classification/i],
  matReceived:[/material\s*received/i, /mat.*received/i, /delivered/i, /received\s*qty/i],
  matPending: [/material\s*yet/i, /pending\s*qty/i, /yet\s*to\s*receive/i, /balance/i],
  orderConf:  [/order\s*confirm/i, /oc\s*status/i, /confirmation/i],
};
const REQUIRED_FIELDS = ['item'];

function parseItemParts(text) {
  const raw = String(text||'').trim();
  if (!raw) return {jobCode:'', jobDesc:''};
  const m = raw.match(/^([A-Za-z0-9\-\/_.]+)[:\-\s]+(.+)$/);
  if (m) {
    return { jobCode: m[1].trim(), jobDesc: m[2].trim() };
  }
  const parts = raw.split(/\s+/);
  const jobCode = parts[0] || '';
  let jobDesc = raw.slice(jobCode.length).trim();
  if (!jobDesc) jobDesc = raw;
  return {jobCode, jobDesc};
}

// FIX 2 — reject prose / instruction tabs.
// smartParse is deliberately permissive so it can read messy real-world
// sheets, but that means a "How to use" tab gets treated as data: it latches
// onto the title cell as a header and turns every sentence into a vendor row.
// A genuine data sheet maps at least 2 distinct fields AND has at least 2
// populated columns somewhere. A prose tab is a single column of sentences.
function isDataSheet(raw, parsed) {
  if (!parsed) return false;
  if (Object.keys(parsed.fields).length < 2) return false;
  let maxCells = 0;
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] || [];
    let n = 0;
    for (const c of row) if (String(c ?? '').trim() !== '') n++;
    if (n > maxCells) maxCells = n;
  }
  return maxCells >= 2;
}

// PERF — clip each sheet's declared range to the last row that actually
// contains data before handing it to sheet_to_json.
// Excel files often declare a range far larger than the populated area
// (formatting applied to whole columns leaves thousands of blank-but-styled
// rows). In this workbook SCM/EDRC/Quality/Operations each declare 3001 rows
// while holding ~255 — so ~90% of every parse was spent building empty arrays.
// Trimming is loss-free: it only ever removes trailing rows where every cell
// is empty. Measured ~13x faster sheet_to_json with byte-identical output.
function trimSheetRange(ws){
  try{
    if(!ws || !ws['!ref']) return ws;
    const r = XLSX.utils.decode_range(ws['!ref']);
    let last = r.s.r;
    for(let R=r.s.r; R<=r.e.r; R++){
      for(let C=r.s.c; C<=r.e.c; C++){
        const c = ws[XLSX.utils.encode_cell({r:R,c:C})];
        if(c && c.v !== undefined && String(c.v).trim() !== ''){ last = R; break; }
      }
    }
    if(last < r.e.r){ r.e.r = last; ws['!ref'] = XLSX.utils.encode_range(r); }
  }catch(e){ /* leave the sheet untouched on any surprise */ }
  return ws;
}

function smartParse(raw, sheetName, fileName) {
  let bestHi = -1, bestScore = 0;
  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const row = raw[i];
    if (!row) continue;
    let textCount = 0, patternCount = 0;
    const matchedFields = new Set();
    for (const cell of row) {
      const s = String(cell || '').trim();
      if (s.length >= 2 && s.length <= 80) textCount += 1;
      const lower = s.toLowerCase();
      for (const [field, pats] of Object.entries(FIELD_PATTERNS)) {
        if (pats.some(p => p.test(lower))) { matchedFields.add(field); patternCount += 1; break; }
      }
    }
    const fieldCount = matchedFields.size;
    const score = fieldCount * 6 + patternCount * 2 + textCount * 0.5 + (row.length > 4 ? 1 : 0);
    if (score > bestScore) { bestScore = score; bestHi = i; }
  }
  if (bestHi < 0 || bestScore < 8) {
    const row0 = raw[0];
    if (row0 && row0.some(cell => String(cell || '').trim().length > 0)) {
      const matchedFields0 = new Set();
      for (const cell of row0) {
        const lower = String(cell || '').trim().toLowerCase();
        for (const [field, pats] of Object.entries(FIELD_PATTERNS)) {
          if (pats.some(p => p.test(lower))) { matchedFields0.add(field); break; }
        }
      }
      if (matchedFields0.size >= 2 || (row0.length > 4 && row0.some(cell => /item|material|vendor|po|description/i.test(String(cell || ''))))) {
        bestHi = 0;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  const headers = raw[bestHi].map(h => String(h || '').trim());

  const fields = {};
  const usedCols = new Set();
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    for (let ci = 0; ci < headers.length; ci++) {
      if (usedCols.has(ci)) continue;
      const h = String(headers[ci] || '').trim();
      if (!h) continue;
      if (patterns.some(p => p.test(h))) {
        fields[field] = ci;
        usedCols.add(ci);
        break;
      }
      const normalized = h.toLowerCase().replace(/[\.\s]+/g,' ').trim();
      if (patterns.some(p => p.test(normalized))) {
        fields[field] = ci;
        usedCols.add(ci);
        break;
      }
    }
  }

  // FIX 1 — `item` is the row's descriptive identity, and rows whose item cell
  // is blank get dropped below. Some sheets carry BOTH a descriptive column
  // ("JOB DESCRIPTION") and a sparse annotation column ("ITEM", entered once
  // per PO+period in SCM and fanned out to other teams via PO_ITEM_MAP). Both
  // match FIELD_PATTERNS.item, and plain column order picks whichever comes
  // first — on SCM that is the sparse one, silently discarding ~95% of rows.
  // Prefer the column that is actually populated; ties keep pattern order.
  {
    const itemCands = [];
    for (let ci = 0; ci < headers.length; ci++) {
      const h = String(headers[ci] || '').trim();
      if (!h) continue;
      if (usedCols.has(ci) && fields.item !== ci) continue;
      const normalized = h.toLowerCase().replace(/[\.\s]+/g, ' ').trim();
      if (FIELD_PATTERNS.item.some(p => p.test(h) || p.test(normalized))) itemCands.push(ci);
    }
    if (itemCands.length > 1) {
      const fillOf = ci => {
        let filled = 0, total = 0;
        for (let r = bestHi + 1; r < raw.length; r++) {
          const row = raw[r];
          if (!row || row.every(cell => String(cell || '').trim() === '')) continue;
          total++;
          if (String(row[ci] ?? '').trim().length >= 2) filled++;
        }
        return total ? filled / total : 0;
      };
      let best = itemCands[0], bestFill = fillOf(itemCands[0]);
      for (let k = 1; k < itemCands.length; k++) {
        const f = fillOf(itemCands[k]);
        if (f > bestFill + 1e-9) { best = itemCands[k]; bestFill = f; }
      }
      if (fields.item !== undefined) usedCols.delete(fields.item);
      fields.item = best;
      usedCols.add(best);
    }
  }

  if (fields.item === undefined) {
    for (let ci = 0; ci < headers.length; ci++) {
      const h = String(headers[ci] || '').toLowerCase();
      if (h && !(/s\.?\s*no|serial|sl|sr/i.test(h)) && h.length > 2) {
        fields.item = ci;
        break;
      }
    }
  }

  const missing = REQUIRED_FIELDS.filter(f => fields[f] === undefined);
  if (missing.length) return null;

  const rows = [];
  
  // Added "currency" to the carry logic array
  const carry = {vendor:'', vendorEmail:'', owner:'', poIssued:'', poNumber:'', poValue:'', poDate:'', currency:'', mfcStatus:'', mfcDate:'', leadTime:'', bgReq:'', payTerms:'', lc:'', risk:'', status:'', remarks:'', cat:'', matRec:'', matPend:'', orderConf:false, expDel:'', delStart:''};
  
  let rowIndex = 0;
  for (let i = bestHi + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.every(cell => String(cell || '').trim() === '')) continue;
    const g = ci => ci !== undefined && ci >= 0 ? String(row[ci] ?? '').trim() : '';
    const itemVal = g(fields.item);
    if (itemVal.length < 2) continue;
    const itemIsNumeric = !/[A-Za-z]/.test(itemVal) && !isNaN(itemVal);
    if (itemIsNumeric) {
      const hasSupportingData = ['vendor','owner','poNumber','poValue','mfcStatus','bgReq','payTerms','lc','cat','status']
        .some(f => { const v = g(fields[f]); return v && v.length > 0; }) || carry.vendor || carry.poNumber || carry.poIssued || carry.status;
      if (!hasSupportingData) continue;
    }

    const explicitJobCodeVal = g(fields.jobCode);
    const vendorFieldVal = g(fields.vendor) || carry.vendor;
    const vendorCodeVal = g(fields.vendorCode) || '';
    const vendorNameVal = g(fields.vendorName) || '';
    // Only inherit a carried email on continuation rows (no vendor cell of their own),
    // so one vendor's address never leaks onto the next vendor.
    const rowHasOwnVendor = !!(g(fields.vendor) || vendorCodeVal || vendorNameVal);
    const vendorEmailVal = g(fields.email) || (rowHasOwnVendor ? '' : (carry.vendorEmail || ''));
    const ownerVal = g(fields.owner) || carry.owner;
    const poNumVal = g(fields.poNumber) || carry.poNumber;
    const poValVal = g(fields.poValue) || carry.poValue;
    const poDateVal = g(fields.poDate) || carry.poDate;
    
    // Grabbing the currency, falling back to carried value
    const currencyVal = g(fields.currency) || carry.currency;
    
    const mfcStatusVal = g(fields.mfcStatus) || carry.mfcStatus;
    const mfcDateVal = g(fields.mfcDate) || carry.mfcDate;
    const leadTimeVal = g(fields.leadTime) || carry.leadTime;
    const bgReqVal = g(fields.bgReq) || carry.bgReq;
    const payTermsVal = g(fields.payTerms) || carry.payTerms;
    const lcVal = g(fields.lc) || carry.lc;
    const riskVal = g(fields.risk) || carry.risk;
    const statusVal = g(fields.status) || carry.status;
    const remarksVal = g(fields.remarks) || carry.remarks;
    const catVal = g(fields.cat) || carry.cat;
    const matRecVal = g(fields.matReceived) || carry.matRec;
    const matPendVal = g(fields.matPending) || carry.matPend;
    const ordConfVal = row[fields.orderConf] !== undefined && row[fields.orderConf] !== null && String(row[fields.orderConf]).trim().length > 0 ? isChk(row[fields.orderConf]) : carry.orderConf;
    const expDelVal = g(fields.expDelivery) || carry.expDel;
    const delStartVal = g(fields.deliveryStart) || carry.delStart;

    const vendorVal = vendorFieldVal || vendorCodeVal || vendorNameVal;
    
    // Updating the carry state so the next blank row inherits it
    if (vendorVal) carry.vendor = vendorVal;
    // Reset the carried email whenever a new vendor row starts, so continuation
    // rows inherit this vendor's email (or none) — never the previous vendor's.
    if (rowHasOwnVendor) carry.vendorEmail = g(fields.email) || '';
    else if (vendorEmailVal) carry.vendorEmail = vendorEmailVal;
    if (ownerVal) carry.owner = ownerVal;
    if (poNumVal) carry.poNumber = poNumVal;
    if (poValVal) carry.poValue = poValVal;
    if (poDateVal) carry.poDate = poDateVal;
    if (currencyVal) carry.currency = currencyVal; // Saves currency for the next row
    if (mfcStatusVal) carry.mfcStatus = mfcStatusVal;
    if (mfcDateVal) carry.mfcDate = mfcDateVal;
    if (leadTimeVal) carry.leadTime = leadTimeVal;
    if (bgReqVal) carry.bgReq = bgReqVal;
    if (payTermsVal) carry.payTerms = payTermsVal;
    if (lcVal) carry.lc = lcVal;
    if (riskVal) carry.risk = riskVal;
    if (statusVal) carry.status = statusVal;
    if (remarksVal) carry.remarks = remarksVal;
    if (catVal) carry.cat = catVal;
    if (matRecVal) carry.matRec = matRecVal;
    if (matPendVal) carry.matPend = matPendVal;
    if (ordConfVal !== undefined) carry.orderConf = ordConfVal;
    if (expDelVal) carry.expDel = expDelVal;
    if (delStartVal) carry.delStart = delStartVal;

    let poIssued = g(fields.poIssued) || carry.poIssued;
    let statusTxt = statusVal;
    if (!poIssued && statusTxt) {
      const sl = statusTxt.toLowerCase();
      if (sl.includes('po issued') || sl.includes('po released')) poIssued = 'PO Issued';
      else if (sl.includes('loa issued') && !sl.includes('will be issued')) poIssued = 'LOA Issued';
      else if (sl.includes('order conf')) poIssued = 'Order Confirmed';
      else if (sl.includes('hpc')) poIssued = 'HPC Stage';
      else if (sl.includes('bafo')) poIssued = 'BAFO Stage';
      else if (sl.includes('rfq')) poIssued = 'RFQ Stage';
      else if (sl.includes('no requirement') || sl === 'none') poIssued = 'N/A';
      else poIssued = 'Pending';
    }
    if (!poIssued) {
      const rowText = row.map(cell => String(cell || '').toLowerCase()).join(' ');
      if (rowText.includes('po issued') || rowText.includes('po released')) poIssued = 'PO Issued';
      else if (rowText.includes('loa issued') && !rowText.includes('will be issued')) poIssued = 'LOA Issued';
      else if (rowText.includes('order conf')) poIssued = 'Order Confirmed';
      else if (rowText.includes('hpc')) poIssued = 'HPC Stage';
      else if (rowText.includes('bafo')) poIssued = 'BAFO Stage';
      else if (rowText.includes('rfq')) poIssued = 'RFQ Stage';
      else if (rowText.includes('no requirement') || rowText.includes('none')) poIssued = 'N/A';
      else if (statusTxt) poIssued = 'Pending';
    }

    const parsedItem = parseItemParts(itemVal);
    const jobCode = explicitJobCodeVal || parsedItem.jobCode;
    const jobDesc = explicitJobCodeVal ? itemVal : parsedItem.jobDesc;
    
    const record = {
      item:        itemVal,
      ic:          g(fields.ic) || '',
      bu:          g(fields.bu) || '',
      jobCode:     jobCode,
      jobDesc:     jobDesc,
      vendor:      vendorCodeVal || vendorVal,
      vendorName:  vendorNameVal || (vendorCodeVal && vendorFieldVal ? vendorFieldVal : ''),
      vendorEmail: vendorEmailVal,
      acc:         ownerVal,
      poIssued:    poIssued,
      poNum:       poNumVal,
      poVal:       poValVal,
      poDate:      fmtDate(poDateVal),
      currency:    currencyVal, // Passed the populated currency variable here
      mfcStatus:   mfcStatusVal,
      mfcDate:     fmtDate(mfcDateVal),
      leadTime:    leadTimeVal,
      bgReq:       bgReqVal,
      payTerms:    payTermsVal,
      lc:          lcVal,
      qty:         g(fields.qty),
      status:      statusTxt,
      remarks:     remarksVal || statusTxt,
      risk:        riskVal,
      cat:         catVal,
      matRec:      matRecVal,
      matPend:     matPendVal,
      orderConf:   ordConfVal,
      expDel:      expDelVal,
      delStart:    delStartVal,
      sheet: '',
      rowId:       ++rowIndex,
    };
    rows.push(record);
  }
  if (rows.length === 0) return null;

  const displayName = sheetName === 'Sheet1' || sheetName === 'Sheet'
    ? fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ')
    : sheetName.trim();
  rows.forEach(r => { r.sheet = displayName; r.sheetId = `${fileName}::${sheetName}`; });
  const id = `${fileName}::${sheetName}`;
  return { id, name: displayName, headers, fields, rows, source: fileName, sheetName };
}

function isChk(v) {
  if (!v && v !== 0) return false;
  const s = String(v).toLowerCase().trim();
  return s==='ü'||s==='✓'||v===true||s.includes('given')||s.includes('yes')||s==='done'||s==='po issued'||s.includes('released')||s.includes('issued');
}
function fmtDate(v) {
  if (!v || v === '') return '';
  if (typeof v === 'number') {
    const d = new Date((v - 25569) * 86400000);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  return String(v).trim();
}
function formatMoney(val) {
  if (!val) return '—';
  const str = String(val).trim();
  const num = Number(str.replace(/,/g, ''));
  if (!isNaN(num) && str !== '') {
    return '₹' + num.toLocaleString('en-IN');
  }
  return str.includes('₹') ? str : '₹' + str;
}

// FILE LOADING

const dz=document.getElementById('dz'),fi=document.getElementById('fi');
const upscreenEl=document.getElementById('upscreen'); // kept reference so the upload screen (with its drop/file listeners) survives view re-renders
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag')});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');loadFiles([...e.dataTransfer.files])});
fi.addEventListener('change',e=>{if(e.target.files.length)loadFiles([...e.target.files])});

// Scan a workbook for a "Vendor Master" contact sheet (one row per vendor with an
// email column) and load code/name → email & cc into the global lookups. Returns the
// set of sheet names consumed so they're skipped by the normal PO parser.
function tryImportVendorMaster(wb){
  const skip=new Set(); let count=0; let locCount=0;
  const reCode =[/vendor\s*code/i,/vendor\s*id/i,/supplier\s*code/i,/vendor\s*no/i,/^code$/i];
  const reName =[/vendor\s*name/i,/supplier\s*name/i,/vendor\s*desc/i,/^name$/i];
  const reEmail=[/vendor\s*e-?mail/i,/supplier\s*e-?mail/i,/e-?mail\s*id/i,/mail\s*id/i,/contact\s*e-?mail/i,/^e-?mail$/i,/^mail$/i,/e-?mail/i];
  const reCC   =[/^cc$/i,/cc\s*e-?mail/i,/e-?mail\s*cc/i,/^copy$/i];
  const reLoc  =[/location/i,/^city/i,/\bcity\b/i,/^state/i,/\bstate\b/i,/^region/i,/\bregion\b/i,/place/i];
  const reMasterName=/vendor\s*master|vendor\s*list|vendor\s*contact|vendor.*e-?mail|contact\s*list/i;
  const reBlockPO=[/po\s*number/i,/po\s*no\b/i,/job\s*desc/i,/short\s*text/i,/\bmfc\b/i];
  const col=(hdrs,arr)=>hdrs.findIndex(c=>arr.some(rx=>rx.test(c)));

  // --- Vendor Master v2 columns -------------------------------------------------
  // Factory Location is the short city/state/country that drives the region map;
  // Address is the full postal text and is deliberately NOT used for mapping.
  const reFactory=[/factory\s*location/i,/works\s*location/i,/plant\s*location/i,/manufactur\w*\s*location/i];
  // "Email Address" must not be mistaken for the postal address column.
  const reAddress=[/^address/i,/postal\s*address/i,/\baddress\b/i,/registered\s*office/i];
  // What the vendor supplies, for the Vendor Details page only. Deliberately separate from
  // the ITEM column on the SCM/EDRC/Quality/Operations rating sheets — same word, different
  // purpose, so it gets its own regex rather than reusing any item-lookup helper.
  const reMaterialDesc=[/material\s*desc/i,/material\s*description/i,/product\s*desc/i,/supply\s*desc/i,/commodity/i];
  const reFirstLvl =/first\s*level|1st\s*level|\bl1\b|primary\s*contact/i;
  const reSeniorLvl=/senior\s*level|second\s*level|2nd\s*level|\bl2\b|escalation|management\s*contact/i;
  const rePhone =[/number/i,/phone/i,/mobile/i,/contact\s*no\b/i,/\btel\b/i];
  const rePerson=[/name/i,/person/i,/contact(?!\s*(no|number))/i];
  // Find the column for one level (first / senior) and one field (email / phone / name).
  const lvlCol=(hdrs,lvlRx,field)=>hdrs.findIndex(c=>{
    if(!lvlRx.test(c)) return false;
    const isEmail=reEmail.some(rx=>rx.test(c));
    const isPhone=!isEmail && rePhone.some(rx=>rx.test(c));
    const isPerson=!isEmail && !isPhone && rePerson.some(rx=>rx.test(c));
    return field==='email'?isEmail:field==='phone'?isPhone:isPerson;
  });

  // Instruction / help tabs mention "Vendor Code" and "Email" in prose, which used to
  // look exactly like a header row. Skip them by name, and require real headers to be
  // short labels rather than sentences.
  const reGuideSheet=/how\s*to\s*use|instruction|guide|read\s*me|help|notes?$|legend/i;

  // Whether we've already cleared the detail maps for this workbook's load pass.
  let _detailsCleared = false;
  (wb.SheetNames||[]).forEach(sn=>{
    if(reGuideSheet.test(sn)) return;
    const raw=XLSX.utils.sheet_to_json(trimSheetRange(wb.Sheets[sn]),{header:1,defval:''});
    if(!raw||!raw.length) return;
    let hr=-1, hdrs=null;
    for(let i=0;i<Math.min(12,raw.length);i++){
      const row=(raw[i]||[]).map(c=>String(c||'').trim());
      // A column header is a short label; anything long is prose, not a header.
      const filled=row.filter(c=>c);
      if(!filled.length || filled.some(c=>c.length>60)) continue;
      if(filled.length<2) continue;
      const hasEmail=row.some(c=>reEmail.some(rx=>rx.test(c)));
      const hasVen  =row.some(c=>reCode.some(rx=>rx.test(c))||reName.some(rx=>rx.test(c)));
      if(hasEmail&&hasVen){ hr=i; hdrs=row; break; }
    }
    if(hr<0) return;
    // Treat as a master only if named like one, or it doesn't look like a PO tracker.
    const looksMaster = reMasterName.test(sn) || !hdrs.some(c=>reBlockPO.some(rx=>rx.test(c)));
    if(!looksMaster) return;
    // First confirmed vendor-master sheet in this workbook: wipe stale detail maps so
    // corrupt data from any previous appStorage session can never bleed through.
    if(!_detailsCleared){
      VENDOR_DETAILS={}; VENDOR_MASTER_ROSTER={}; VENDOR_LOCATION={};
      _detailsCleared=true;
    }
    const ci=col(hdrs,reCode), ni=col(hdrs,reName), ei=col(hdrs,reEmail), cci=col(hdrs,reCC), li=col(hdrs,reLoc);
    // Resolve the two contact levels. Fall back to the legacy single Email / CC
    // columns so an old-format Vendor Master still loads unchanged.
    const e1i=lvlCol(hdrs,reFirstLvl,'email'),  p1i=lvlCol(hdrs,reFirstLvl,'phone'),  n1i=lvlCol(hdrs,reFirstLvl,'person');
    const e2i=lvlCol(hdrs,reSeniorLvl,'email'), p2i=lvlCol(hdrs,reSeniorLvl,'phone'), n2i=lvlCol(hdrs,reSeniorLvl,'person');
    const fi_=col(hdrs,reFactory);
    // Legacy "Contact Person" (no level word) becomes the first-level name.
    const legacyPerson=hdrs.findIndex(c=>/contact\s*person/i.test(c));
    // Address, but never an "Email Address" header.
    const ai=hdrs.findIndex(c=>reAddress.some(rx=>rx.test(c)) && !reEmail.some(rx=>rx.test(c)));
    const mdi=col(hdrs,reMaterialDesc);
    const primaryEmailCol = e1i>=0?e1i:(ei>=0?ei:e2i);
    const ccEmailCol      = e2i>=0?e2i:cci;
    if(primaryEmailCol<0 || (ci<0&&ni<0)) return;
    for(let i=hr+1;i<raw.length;i++){
      const row=raw[i]||[];
      const cellAt=(idx)=>idx>=0?String(row[idx]==null?'':row[idx]).trim():'';
      const code =cellAt(ci);
      const name =cellAt(ni);
      const email=cellAt(primaryEmailCol);
      const cc   =cellAt(ccEmailCol);
      // Factory Location wins over any generic Location column for map placement.
      const factory=cellAt(fi_);
      const loc  =factory || cellAt(li);
      const address=cellAt(ai);
      const materialDesc=cellAt(mdi);
      const c1Name=cellAt(n1i>=0?n1i:legacyPerson), c1Phone=cellAt(p1i);
      const c2Name=cellAt(n2i), c2Phone=cellAt(p2i);
      const c1Email=e1i>=0?cellAt(e1i):email;
      const c2Email=e2i>=0?cellAt(e2i):'';
      // Full contact record for the Vendor Details page — kept even when the row has
      // no email at all, so a vendor with only a phone number still shows up.
      if(code||name){
        const rec={code,name,factory:loc,address,materialDesc,c1Name,c1Email,c1Phone,c2Name,c2Email,c2Phone};
        if(code){ VENDOR_DETAILS[normVenKey(code)]=rec; VENDOR_DETAILS[normCodeKey(code)]=rec; }
        if(name){ VENDOR_DETAILS[normVenKey(name)]=rec; }
      }
      // Location is captured independently of email — a vendor may have a location but no contact email.
      if(loc){
        if(code){ VENDOR_LOCATION[normVenKey(code)]=loc; VENDOR_LOCATION[normCodeKey(code)]=loc; }
        if(name){ VENDOR_LOCATION[normVenKey(name)]=loc; }
        locCount++;
      }
      // Roster entry (code/name/location) independent of email, so the Vendor Location map has a
      // full vendor list to show even before any PO tracker is loaded.
      if(code||name){
        const rk = code ? normCodeKey(code) : normVenKey(name);
        VENDOR_MASTER_ROSTER[rk] = {code, name, location:loc};
      }
      if(!email||!email.includes('@')) continue;
      if(code){
        VENDOR_EMAILS[normVenKey(code)]=email; VENDOR_EMAILS[normCodeKey(code)]=email;
        if(cc){ VENDOR_CC[normVenKey(code)]=cc; VENDOR_CC[normCodeKey(code)]=cc; }
      }
      if(name){ VENDOR_EMAILS[normVenKey(name)]=email; if(cc) VENDOR_CC[normVenKey(name)]=cc; }
      if(code||name) count++;
    }
    skip.add(sn);
  });
  if(count||locCount||Object.keys(VENDOR_MASTER_ROSTER).length) persistVendorMaster();
  return {skipSheets:skip, count, locCount};
}

