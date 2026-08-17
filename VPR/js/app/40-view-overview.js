/* ============================================================
 * 40-view-overview.js
 * Portfolio overview: KPI cards, tiers, charts, risk alerts
 * ------------------------------------------------------------
 * Part of the L&T Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */
function rOverview(){
  initRatings();
  const a=all();
  const tiers=computeVendorTiers();
  const ratedV=[...tiers.platinum,...tiers.gold,...tiers.silver,...tiers.bronze]; // vendors with a score (all 4 domains Completed)
  const totalV=ratedV.length+tiers.incomplete.length+tiers.notRated.length;
  const pct=n=>totalV?Math.round(n/totalV*100):0;

  // Rated PO line-items in the active half-year (a rating is stored per PO × H1/H2).
  const ratedItems=a.filter(i=>hasSavedRatingValues(itemRatings[stableKey(i)]));

  // ---- Analysis scope: an optional BU, then an optional single vendor ----
  // Everything in the "Analysis" band below (category / project / item charts, region map,
  // strengths & weaknesses) reads from aItems instead of ratedItems, so picking a BU and/or
  // vendor re-computes those panels for that slice alone. The portfolio cards ABOVE the
  // Analysis heading intentionally keep using ratedItems and stay portfolio-wide.
  // BU comes from the PO Master "BU" column, carried onto every row by the sheet parser.
  const analysisBuList = (()=>{
    const seen=new Set();
    ratedItems.forEach(i=>{ const b=(i.bu||'').trim(); if(b) seen.add(b); });
    return [...seen].sort((x,y)=>x.localeCompare(y));
  })();
  // A stale selection (BU no longer present after a period switch) silently falls back to All.
  if(selectedAnalysisBu && !analysisBuList.includes(selectedAnalysisBu)) selectedAnalysisBu=null;
  // BU narrows the pool the vendor dropdown and every analysis panel are built from.
  const buItems = selectedAnalysisBu
    ? ratedItems.filter(i=>(i.bu||'').trim()===selectedAnalysisBu)
    : ratedItems;
  // Unrated rows still matter for the vendor location map, so keep a BU-scoped copy of `a` too.
  const buAll = selectedAnalysisBu
    ? a.filter(i=>(i.bu||'').trim()===selectedAnalysisBu)
    : a;
  const analysisVendorList = (()=>{
    const seen={};
    buItems.forEach(i=>{
      const code=(i.vendor||'').trim(); if(code.length<2) return;
      if(!seen[code]) seen[code]={code,name:i.vendorName||''};
      if(!seen[code].name && i.vendorName) seen[code].name=i.vendorName;
    });
    return Object.values(seen).sort((x,y)=>(x.name||x.code).localeCompare(y.name||y.code));
  })();
  // A stale selection (vendor no longer rated after a period switch) silently falls back to All.
  if(selectedAnalysisVendor && !analysisVendorList.some(v=>v.code===selectedAnalysisVendor)) selectedAnalysisVendor=null;
  const analysisVendorMeta = selectedAnalysisVendor ? analysisVendorList.find(v=>v.code===selectedAnalysisVendor) : null;
  const analysisVendorLabel = analysisVendorMeta ? (analysisVendorMeta.name||analysisVendorMeta.code) : null;
  const aItems = selectedAnalysisVendor
    ? buItems.filter(i=>(i.vendor||'').trim()===selectedAnalysisVendor)
    : buItems;

  // Average score per rating category across every rated item (weights shown as context).
  // Only categories that are score-eligible (STATUS recorded — Approved / Changed / NA —
  // not still Pending) count here; an evaluator-only number sitting with the approver is
  // real for Rating Completeness purposes but not a finished figure this chart should
  // average in as if it were.
  const catAgg={}; LNT_MATRIX.forEach(c=>catAgg[c.id]={sum:0,n:0});
  ratedItems.forEach(i=>{
    const ik=stableKey(i);
    const bag=itemRatings[ik];
    const meta=categoryMeta[ik]||{};
    LNT_MATRIX.forEach(c=>{
      if(!categoryScoreEligible(meta,c.id)) return;
      const has=c.params.some((_,pi)=>{const v=bag[`${c.id}_${pi}`];return v!=null&&v!=='';});
      if(has){ catAgg[c.id].sum+=calcCategoryScore(c.id,bag); catAgg[c.id].n++; }
    });
  });
  const catScores=LNT_MATRIX.map(c=>({id:c.id,label:TEAM_LABEL[c.id],w:c.w,
    score:catAgg[c.id].n?+(catAgg[c.id].sum/catAgg[c.id].n).toFixed(1):0}));

  // Top vendors by score (progress-bar list, click → Vendor Focus).
  const ranked=[...ratedV].sort((x,y)=>y.score-x.score);
  const top=ranked.slice(0,10);
  const topBars=top.length?top.map(v=>{
    const t=tierForScore(v.score);
    return `<div class="prr" onclick="openVendorPage('${esc(v.code)}')" style="cursor:pointer"><div class="prlb" title="${hesc(v.name||v.code)}">${hesc(v.name||v.code)}</div><div class="prt"><div class="prf" style="width:${v.score}%;background:${t.c}"></div></div><div class="prp" style="color:${t.c}">${v.score.toFixed(1)}%</div></div>`;
  }).join(''):'<div class="empty">No vendors rated yet — open Vendor Scorecard to start rating.</div>';

  // Full vendor scoreboard: rated (high→low) first, then not-rated.
  const tbadge=(t)=>`<span style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.5px;padding:2px 7px;border-radius:2px;background:${t.c}1a;color:${t.c};border:1px solid ${t.c}55">${t.label}</span>`;
  const trows=ranked.concat(tiers.notRated).map(v=>{
    const isR=v.score!=null;
    const t=isR?tierForScore(v.score):null;
    return `<tr onclick="openVendorPage('${esc(v.code)}')" style="cursor:pointer">
      <td><strong>${hesc(v.name||v.code)}</strong>${v.name?`<div style="font-family:var(--mono);font-size:10px;color:var(--t3)">${vendorCodeDisplay(v.code)}</div>`:''}</td>
      <td>${isR?`<span style="font-family:var(--hd);font-weight:600;color:${t.c}">${v.score.toFixed(1)}%</span>`:'<span style="color:var(--t4)">—</span>'}</td>
      <td>${isR?tbadge(t):'<span style="font-size:10px;font-family:var(--mono);color:var(--t4)">NOT RATED</span>'}</td>
      <td><span class="ch ch-b">${v.ratedCount||0}/${v.itemCount}</span></td></tr>`;
  }).join('')||`<tr><td colspan="4" style="text-align:center;color:var(--t4);padding:22px">No vendors loaded.</td></tr>`;

  // ===== Out-of-the-box analytics (only when at least one PO is rated) =====
  // Per-vendor × per-category score matrix (average of the vendor's rated POs per category).
  const _vm={};
  ratedItems.forEach(i=>{
    const code=(i.vendor||'').trim(); if(code.length<2) return;
    const ik=stableKey(i);
    const bag=itemRatings[ik];
    const meta=categoryMeta[ik]||{};
    if(!_vm[code]) _vm[code]={code,name:i.vendorName||'',cat:{},overall:[]};
    if(!_vm[code].name&&i.vendorName) _vm[code].name=i.vendorName;
    LNT_MATRIX.forEach(c=>{
      if(!categoryScoreEligible(meta,c.id)) return;
      const has=c.params.some((_,pi)=>{const v=bag[`${c.id}_${pi}`];return v!=null&&v!=='';});
      if(has){ (_vm[code].cat[c.id]=_vm[code].cat[c.id]||[]).push(calcCategoryScore(c.id,bag)); }
    });
    _vm[code].overall.push(vendorTierScore(bag,meta));
  });
  const vendorMatrix=Object.values(_vm).map(v=>{
    const cat={}; LNT_MATRIX.forEach(c=>{const arr=v.cat[c.id]; cat[c.id]=arr&&arr.length?Math.round(arr.reduce((x,y)=>x+y,0)/arr.length):null;});
    const overall=v.overall.length?+(v.overall.reduce((x,y)=>x+y,0)/v.overall.length).toFixed(1):null;
    return {code:v.code,name:v.name,cat,overall};
  }).sort((x,y)=>(y.overall||0)-(x.overall||0));
  const heatCol=s=>s==null?{bg:'var(--s2,#eef0f2)',fg:'var(--t4,#aab2ba)'}
    :s>=90?{bg:'#1e7d34',fg:'#fff'}:s>=80?{bg:'#4f9d3a',fg:'#fff'}
    :s>=70?{bg:'#8a7d17',fg:'#fff'}:s>=50?{bg:'#c07a1e',fg:'#fff'}:{bg:'#a82f1c',fg:'#fff'};

  // Portfolio-wide parameter averages → strongest & weakest parameters (avg star, 1–5).
  const paramAgg=[];
  LNT_MATRIX.forEach(c=>c.params.forEach((label,pi)=>{
    let sum=0,n=0;
    aItems.forEach(i=>{
      const ik=stableKey(i);
      if(!categoryScoreEligible(categoryMeta[ik]||{},c.id)) return;
      const bag=itemRatings[ik];const v=bag&&bag[`${c.id}_${pi}`];if(v!=null&&v!==''){sum+=Number(v);n++;}
    });
    if(n) paramAgg.push({catId:c.id,cat:TEAM_LABEL[c.id],label,avg:sum/n,n});
  }));
  const strongest=bestPerTeam(paramAgg,true);
  const weakest=bestPerTeam(paramAgg,false);
  const swBar=(p,good)=>{const w=(p.avg/5*100),col=good?'#3f6d2c':'#a82f1c';
    return `<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;margin-bottom:3px;"><span style="color:var(--t2);line-height:1.3;">${hesc(p.label)}</span><span style="font-family:var(--mono);font-weight:600;color:${col};white-space:nowrap;">${p.avg.toFixed(1)} ★</span></div><div style="height:6px;background:var(--s4);border:1px solid var(--brd);overflow:hidden;"><div style="height:100%;width:${w}%;background:${col};"></div></div><div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">${hesc(p.cat)} · ${p.n} rating(s)</div></div>`;};

  // Analysis section data: "All Teams" compares the 4 category averages; picking a single
  // team (SCM/EDRC/Quality/Operations) drills into that team's own parameters instead.
  function analysisChartData(catId){
    if(!catId){
      // Category averages recomputed over the analysis scope, so a picked vendor shows
      // that vendor's own category profile rather than the portfolio's.
      const agg={}; LNT_MATRIX.forEach(c=>agg[c.id]={sum:0,n:0});
      aItems.forEach(i=>{
        const ik=stableKey(i);
        const bag=itemRatings[ik];
        const meta=categoryMeta[ik]||{};
        LNT_MATRIX.forEach(c=>{
          if(!categoryScoreEligible(meta,c.id)) return;
          const has=c.params.some((_,pi)=>{const v=bag[`${c.id}_${pi}`];return v!=null&&v!=='';});
          if(has){ agg[c.id].sum+=calcCategoryScore(c.id,bag); agg[c.id].n++; }
        });
      });
      const rows=LNT_MATRIX.map(c=>({id:c.id,label:TEAM_LABEL[c.id],
        score:agg[c.id].n?+(agg[c.id].sum/agg[c.id].n).toFixed(1):0}));
      return {
        labels: rows.map(c=>c.label),
        values: rows.map(c=>+(c.score/20).toFixed(2)),
        colors: rows.map(c=>CAT_COLORS[c.id]),
      };
    }
    const selCat = LNT_MATRIX.find(c=>c.id===catId);
    if(!selCat) return {labels:[],values:[],colors:[]};
    const stats = selCat.params.map((label,pi)=>{
      let sum=0,n=0;
      aItems.forEach(i=>{const bag=itemRatings[stableKey(i)];const v=bag&&bag[`${catId}_${pi}`];if(v!=null&&v!==''){sum+=Number(v);n++;}});
      return {label, avg: n?+(sum/n).toFixed(2):0};
    });
    return {
      labels: stats.map(s=>tr(s.label,20)),
      fullLabels: stats.map(s=>s.label),
      values: stats.map(s=>s.avg),
      colors: stats.map(()=>CAT_COLORS[catId]),
    };
  }
  const analysisData = analysisChartData(selectedAnalysisTeam);
  const analysisTeamLabel = selectedAnalysisTeam ? TEAM_LABEL[selectedAnalysisTeam] : null;

  // Score distribution across bands.
  const bins=[[0,50,'<50'],[50,60,'50–59'],[60,70,'60–69'],[70,80,'70–79'],[80,90,'80–89'],[90,101,'90+']];
  const binCounts=bins.map(([lo,hi])=>ratedV.filter(v=>v.score>=lo&&v.score<hi).length);


  const heatRows=vendorMatrix.slice(0,15).map(v=>{
    const cells=LNT_MATRIX.map(c=>{const s=v.cat[c.id];const hc=heatCol(s);
      return `<td style="text-align:center;padding:5px 6px;"><span style="display:inline-block;min-width:34px;padding:3px 6px;border-radius:2px;font-family:var(--mono);font-weight:600;font-size:11px;background:${hc.bg};color:${hc.fg};">${s!=null?s:'—'}</span></td>`;}).join('');
    const ot=v.overall!=null?tierForScore(v.overall):null;
    return `<tr onclick="openVendorPage('${esc(v.code)}')" style="cursor:pointer"><td><strong>${hesc(v.name||v.code)}</strong></td>${cells}<td style="text-align:center;"><span style="font-family:var(--hd);font-weight:700;color:${ot?ot.c:'var(--t4)'};">${v.overall!=null?v.overall.toFixed(1)+'%':'—'}</span></td></tr>`;
  }).join('');
  const heatHead=LNT_MATRIX.map(c=>`<th style="text-align:center;">${TEAM_LABEL[c.id]}<br><span style="font-weight:400;font-size:9px;color:var(--t3);">${c.w}%</span></th>`).join('');
  const catTiers = LNT_MATRIX.map(c => ({ id: c.id, label: TEAM_LABEL[c.id], platinum:0, gold:0, silver:0, bronze:0 }));
  vendorMatrix.forEach(v => {
    LNT_MATRIX.forEach((c, idx) => {
      const s = v.cat[c.id];
      if (s != null) {
        if(s >= 90) catTiers[idx].platinum++;
        else if(s >= 75) catTiers[idx].gold++;
        else if(s >= 60) catTiers[idx].silver++;
        else if(s >= 50) catTiers[idx].bronze++;
      }
    });
  });

  // Sits directly under the Analysis band and follows the same BU / vendor scope, so a
  // picked vendor shows that vendor's own strongest and weakest parameters. paramAgg above
  // is already built from aItems, so no extra filtering is needed here.
  const swScopePrefix = analysisVendorLabel ? `${hesc(analysisVendorLabel)} — ` : '';
  const advancedPanels = aItems.length ? `
    <div class="g2" style="margin-top:16px;">
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--grn)">💪 ${swScopePrefix}Top Strengths</h3><span class="ch ch-b">avg ★ / 5</span></div><div class="pb">${strongest.map(p=>swBar(p,true)).join('')||'<div class="empty">No data</div>'}</div></div>
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--red)">⚠ ${swScopePrefix}Weakest Parameters</h3><span class="ch ch-b">avg ★ / 5</span></div><div class="pb">${weakest.map(p=>swBar(p,false)).join('')||'<div class="empty">No data</div>'}</div></div>
    </div>

  ` : '';

  // ---- values for the redesigned image-style overview ----
  const TIER_META = [
    {key:'gold',   medal:'🥇', label:'Platinum', c:'#1e7d34', legendMedal:'💎', legendLabel:'Platinum'},
  ];
  // Legend rows mirror the target image's tier list (Platinum/Gold/Silver/Bronze/Critical).
  // We map our real tiers onto it: Gold→top band, Silver, Bronze, High-Risk→Critical, Not-Rated shown separately.
  const legendDefs = [
    {key:'platinum',   medal:'💎', name:'Platinum',           c:'#5b4fcf'},
    {key:'gold',       medal:'🥇', name:'Gold',               c:'#a16207'},
    {key:'silver',     medal:'🥈', name:'Silver',             c:'#1a73e8'},
    {key:'bronze',     medal:'🥉', name:'Bronze',             c:'#e8710a'},
    {key:'incomplete', medal:'⏳', name:'Domains Incomplete', c:'#8a5200'},
    {key:'notRated',   medal:'▫',  name:'Not Rated',          c:'#188038'},
  ];
  const tierCounts = {platinum:tiers.platinum.length,gold:tiers.gold.length,silver:tiers.silver.length,bronze:tiers.bronze.length,incomplete:tiers.incomplete.length,notRated:tiers.notRated.length};
  const donutTotal = totalV || 1;

  // Completion / evaluation KPIs derived from real data.
  const evaluatedCount = ratedV.length;
  const totalItems = ratedItems.length;
  // Distinct item types (from the user-entered ITEM column) that have ratings in the
  // current scope — one half, or both halves combined when "Both" is selected.
  const distinctRatedItems = new Set(
    ratedItems.flatMap(i => itemsForScopePO(i.poNum)).filter(v => v && v.length > 0)
  ).size;

  // Highest-populated rated tier to feature in the "Vendors in Selected Tier" panel,
  // unless the user has explicitly picked one via the tier dropdown.
  const featuredKey = (selectedOverviewTier && tiers[selectedOverviewTier])
    ? selectedOverviewTier
    : (['platinum','gold','silver','bronze'].find(k=>tiers[k].length) || 'platinum');
  const featuredDef = legendDefs.find(d=>d.key===featuredKey) || legendDefs[0];
  const featuredList = tiers[featuredKey] || [];
  const featRows = featuredList.slice(0,6).map(v=>{
    const t=tierForScore(v.score);
    return `<tr onclick="openVendorPage('${esc(v.code)}')">
      <td class="vn">${hesc(v.name||v.code)}</td>
      <td style="color:var(--txt);font-size:13px;font-weight:600;font-family:var(--mono);line-height:1.5;">${vendorCodeDisplay(v.code)}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--t2);">${v.ratedCount||0}/${v.itemCount}</td>
      <td class="sc" style="color:${t.c};">${v.score.toFixed(2)}</td></tr>`;
  }).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--t4);padding:18px;">No vendors rated in this tier yet.</td></tr>`;

  // Category-wise rating: top performing vendor per category + the category average (scaled to /5).
  // Each row's "top vendor" is the highest-scoring vendor for that team — clicking through
  // (below) opens the FULL ranked list for that team, not just the single leader shown here.
  const catTopVendor = {};
  LNT_MATRIX.forEach(c=>{
    let best=null;
    vendorMatrix.forEach(v=>{ const s=v.cat[c.id]; if(s!=null && (!best||s>best.s)) best={name:v.name||v.code,code:v.code,s}; });
    catTopVendor[c.id]=best;
  });
  const catRowsHtml = catScores.map(c=>{
    const s5 = +(c.score/20).toFixed(2);           // 0–100 → 0–5
    const t = c.score!=null ? tierForScore(c.score) : null;
    const col = t? t.c : '#8b9199';
    const top = catTopVendor[c.id];
    return `<div class="vpd-catrow" style="cursor:pointer" onclick="openCardDetail('ov_cat_vendors', false, '${esc(c.label)}')" title="View every vendor rated in ${hesc(c.label)}, ranked">
      <div class="vpd-cat-name">${hesc(c.label)}</div>
      <div class="vpd-cat-top">${top?`<span class="medal">🏅</span><span class="who" title="${hesc(top.name)}">${hesc(top.name)}</span>`:'<span class="who" style="color:var(--t4)">—</span>'}</div>
      <div class="vpd-cat-score" style="background:${col}1a;color:${col};">${c.score?s5.toFixed(2):'—'}</div>
    </div>`;
  }).join('');

  // Full per-team vendor ranking behind the "Overall Category-wise Rating" panel — the panel
  // itself only has room to show each team's single top vendor; this is where "which vendor is
  // #2, #3, ... in EDRC" actually lives. filterCol lets the user switch teams from one page
  // instead of clicking back and forth, and each row's team is pre-selected there when opened
  // from a specific team's row above (see presetFilter in openCardDetail, 10-state-and-helpers.js).
  const _catVendorRows = [];
  LNT_MATRIX.forEach(c=>{
    const ranked = vendorMatrix.filter(v=>v.cat[c.id]!=null).sort((x,y)=>y.cat[c.id]-x.cat[c.id]);
    ranked.forEach((v,idx)=>{
      const s = v.cat[c.id];
      const s5 = +(s/20).toFixed(2);
      const vt = tierForScore(s);
      _catVendorRows.push({ code:v.code, navTitle:`Open ${v.name||v.code}`, cells:[
        `<span style="font-family:var(--mono);color:var(--t3)">${String(idx+1).padStart(2,'0')}</span>`,
        hesc(TEAM_LABEL[c.id]||c.name),
        `<strong>${hesc(v.name||v.code)}</strong>`,
        `<span style="font-family:var(--mono);color:var(--t2)">${vendorCodeDisplay(v.code)}</span>`,
        `<span style="font-family:var(--mono);font-weight:600;color:${vt.c}">${s5.toFixed(2)}</span>`,
        `<span style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.5px;padding:2px 7px;border-radius:2px;background:${vt.c}1a;color:${vt.c};border:1px solid ${vt.c}55">${vt.label}</span>` ] });
    });
  });
  setCardData('ov_cat_vendors', { back:'overview', title:'Category-wise Vendor Ranking', headline:'out of 5',
    sub:`Every vendor ranked within each team (SCM / EDRC / Quality / Operations) for ${scopeLabel()}. Use the Category filter to focus on one team.`,
    kpis:[
      {label:'Teams', value:LNT_MATRIX.length, foot:'rating categories'},
      {label:'Vendors ranked', value:vendorMatrix.filter(v=>LNT_MATRIX.some(c=>v.cat[c.id]!=null)).length, foot:'with at least one category score'},
    ],
    tableTitle:'Vendors by category',
    filterCol:'Category',
    columns:[{label:'#'},{label:'Category'},{label:'Vendor'},{label:'Code'},{label:'Score / 5',align:'right'},{label:'Tier'}],
    rows:_catVendorRows });

  // Project-wise performance: group rated items by their source sheet (project), avg score %.
  // Also tracked per-category so the panel can be scoped to a single team (SCM/EDRC/Quality/Operations).
  // Project-wise aggregation (grouped by project / sheet, as before) — feeds the
  // "Project-wise Performance" bars. Kept SEPARATE from the item aggregation below.
  const projAgg={};
  const projCatAgg={};
  // Item-wise aggregation (grouped by the user-entered ITEM name, per active half-year) —
  // feeds the "Item-wise Performance" chart. Records with a blank ITEM cell are skipped.
  const itemAgg={};
  const itemCatAgg={};
  aItems.forEach(i=>{
    const ik=stableKey(i);
    const bag=itemRatings[ik];
    const meta=categoryMeta[ik]||{};
    const tierSc=vendorTierScore(bag,meta);
    const catHas=c=>categoryScoreEligible(meta,c.id) && c.params.some((_,pi)=>{const v=bag[`${c.id}_${pi}`];return v!=null&&v!=='';});
    // --- project grouping ---
    // Group by the PROJECT (job description / job code), NOT the ITEM column. Using i.item
    // here is wrong: on workbooks where the item name lives in the description field, the
    // panel would show item names (Cables/Panel) instead of projects.
    const proj=i.jobDesc||i.jobCode||i.sheet||'';
    if(!projAgg[proj]) projAgg[proj]={sum:0,n:0,vendors:new Set(),pos:new Set(),scores:[]};
    projAgg[proj].sum+=tierSc; projAgg[proj].n++;
    projAgg[proj].scores.push(tierSc);
    if((i.vendor||'').trim()) projAgg[proj].vendors.add((i.vendor||'').trim());
    if(i.poNum) projAgg[proj].pos.add(i.poNum);
    if(!projCatAgg[proj]) projCatAgg[proj]={};
    LNT_MATRIX.forEach(c=>{ if(catHas(c)){
      if(!projCatAgg[proj][c.id]) projCatAgg[proj][c.id]={sum:0,n:0};
      projCatAgg[proj][c.id].sum+=calcCategoryScore(c.id,bag);
      projCatAgg[proj][c.id].n++;
    }});
    // --- item grouping (ITEM column, every half in scope) ---
    // In "Both" scope a PO can carry two different items; it contributes its score
    // to each of them, so neither half's items disappear from the chart.
    itemsForScopePO(i.poNum).forEach(itm=>{
      if(!itm) return;
      if(!itemAgg[itm]) itemAgg[itm]={sum:0,n:0,vendors:new Set(),projects:new Set(),scores:[]};
      itemAgg[itm].sum+=tierSc; itemAgg[itm].n++;
      itemAgg[itm].scores.push(tierSc);
      if((i.vendor||'').trim()) itemAgg[itm].vendors.add((i.vendor||'').trim());
      if(proj) itemAgg[itm].projects.add(proj);
      if(!itemCatAgg[itm]) itemCatAgg[itm]={};
      LNT_MATRIX.forEach(c=>{ if(catHas(c)){
        if(!itemCatAgg[itm][c.id]) itemCatAgg[itm][c.id]={sum:0,n:0};
        itemCatAgg[itm][c.id].sum+=calcCategoryScore(c.id,bag);
        itemCatAgg[itm][c.id].n++;
      }});
    });
  });
  // Item-wise performance dataset for the "Item-wise Performance" chart: one point per
  // distinct ITEM name, average score on a 0–5 scale, highest first. When "All Teams" is
  // selected it uses the overall tier score; a chosen team uses that team's own scores.
  function itemChartDataFor(catId){
    let entries;
    const meta = name => { const o=itemAgg[name]||{}; return {
      n:o.n||0, vendors:(o.vendors&&o.vendors.size)||0, projects:(o.projects&&o.projects.size)||0 }; };
    if(!catId){
      entries = Object.entries(itemAgg).map(([name,o])=>({name, avg:o.n?o.sum/o.n/20:0, ...meta(name)}));
    } else {
      entries = Object.entries(itemCatAgg)
        .map(([name,cats])=>{const o=cats[catId]; return (o&&o.n)?{name, avg:o.sum/o.n/20, ...meta(name)}:null;})
        .filter(Boolean);
    }
    entries.sort((a,b)=>b.avg-a.avg);
    return {
      labels: entries.map(e=>tr(e.name,20)),
      fullLabels: entries.map(e=>e.name),
      values: entries.map(e=>+e.avg.toFixed(2)),
      meta: entries.map(e=>({n:e.n,vendors:e.vendors,projects:e.projects})),
    };
  }
  const itemChartData = itemChartDataFor(selectedAnalysisTeam);
  function computeProjBarsFor(catId, limit){
    const cap = limit==null ? 5 : limit;
    const meta = name => { const o=projAgg[name]||{}; return {
      pos:(o.pos&&o.pos.size)||0, vendors:(o.vendors&&o.vendors.size)||0,
      best:(o.scores&&o.scores.length)?Math.max(...o.scores):null,
      worst:(o.scores&&o.scores.length)?Math.min(...o.scores):null }; };
    let list;
    if(!catId){
      list = Object.entries(projAgg).map(([name,o])=>({name,pct:Math.round(o.sum/o.n),...meta(name)}));
    } else {
      list = Object.entries(projCatAgg)
        .map(([name,cats])=>{ const o=cats[catId]; return (o&&o.n)?{name,pct:Math.round(o.sum/o.n),...meta(name)}:null; })
        .filter(Boolean);
    }
    list.sort((a,b)=>b.pct-a.pct);
    return cap<0 ? list : list.slice(0,cap);
  }
  const projBars=computeProjBarsFor(selectedAnalysisTeam);
  const PROJ_COLS=['#2f6fd0','#1f8a72','#8a5cc4','#d08a2a','#c0503a'];
  const projBarsHtml = projBars.length ? projBars.map((p,i)=>`
    <div class="vpd-pbar" onclick="openProjectPage('${esc(p.name)}')" style="cursor:pointer">
      <div class="top"><span class="nm" title="${hesc(p.name)}">${hesc(p.name)}</span><span class="pc">${p.pct}%</span></div>
      <div class="track"><div class="fill" style="width:${p.pct}%;background:${PROJ_COLS[i%PROJ_COLS.length]}"></div></div>
    </div>`).join('') : `<div class="empty" style="padding:24px">${selectedAnalysisVendor?`No rated projects for ${hesc(analysisVendorLabel)}${selectedAnalysisTeam?` under ${hesc(TEAM_LABEL[selectedAnalysisTeam])}`:''}.`:(selectedAnalysisTeam?`No ${hesc(TEAM_LABEL[selectedAnalysisTeam])} ratings yet.`:'No rated projects yet.')}</div>`;

  // ---- BU-wise analysis (PO Master "BU" column) --------------------------
  // Deliberately built from a source that ignores the BU filter itself: filtering to one BU
  // would leave a single bar, which compares nothing. The comparison across BUs therefore
  // stays whole and the picked BU is highlighted while the rest dim. Vendor and team scope
  // still apply, so this reads as "how my BUs compare, for this vendor / this team".
  const buChartSrc = selectedAnalysisVendor
    ? ratedItems.filter(i=>(i.vendor||'').trim()===selectedAnalysisVendor)
    : ratedItems;
  const buAgg={}, buCatAgg={};
  buChartSrc.forEach(i=>{
    const bu=(i.bu||'').trim(); if(!bu) return;
    const ik=stableKey(i);
    const bag=itemRatings[ik];
    const meta=categoryMeta[ik]||{};
    const tierSc=vendorTierScore(bag,meta);
    if(!buAgg[bu]) buAgg[bu]={sum:0,n:0,vendors:new Set(),pos:new Set()};
    buAgg[bu].sum+=tierSc; buAgg[bu].n++;
    if((i.vendor||'').trim()) buAgg[bu].vendors.add((i.vendor||'').trim());
    if(i.poNum) buAgg[bu].pos.add(i.poNum);
    if(!buCatAgg[bu]) buCatAgg[bu]={};
    LNT_MATRIX.forEach(c=>{
      if(!categoryScoreEligible(meta,c.id)) return;
      const has=c.params.some((_,pi)=>{const v=bag[`${c.id}_${pi}`];return v!=null&&v!=='';});
      if(has){
        if(!buCatAgg[bu][c.id]) buCatAgg[bu][c.id]={sum:0,n:0};
        buCatAgg[bu][c.id].sum+=calcCategoryScore(c.id,bag);
        buCatAgg[bu][c.id].n++;
      }
    });
  });
  function computeBuBarsFor(catId){
    const ctx = name => ({ pos:(buAgg[name]&&buAgg[name].pos.size)||0, vendors:(buAgg[name]&&buAgg[name].vendors.size)||0 });
    let list;
    if(!catId){
      list = Object.entries(buAgg).map(([name,o])=>({name,pct:Math.round(o.sum/o.n),n:o.n,...ctx(name)}));
    } else {
      list = Object.entries(buCatAgg)
        .map(([name,cats])=>{ const o=cats[catId]; return (o&&o.n)?{name,pct:Math.round(o.sum/o.n),n:o.n,...ctx(name)}:null; })
        .filter(Boolean);
    }
    return list.sort((a,b)=>b.pct-a.pct);
  }
  const buBars=computeBuBarsFor(selectedAnalysisTeam);
  const BU_COLS=['#2f6fd0','#1f8a72','#8a5cc4','#d08a2a','#c0503a','#3a7d8c'];
  // Colour keyed off the stable BU list, so a BU keeps its colour as bars reorder by score.
  const buColorFor = name => { const ix=analysisBuList.indexOf(name); return BU_COLS[(ix<0?0:ix)%BU_COLS.length]; };
  const buDimmed = name => selectedAnalysisBu && name!==selectedAnalysisBu;
  const buBarsHtml = buBars.length ? buBars.map(p=>`
    <div class="vpd-pbar" onclick="setAnalysisBu('${esc(p.name)}');openCardDetail('ov_bu')" style="cursor:pointer;${buDimmed(p.name)?'opacity:.4;':''}" title="${hesc(p.name)} — ${p.pos} PO(s), ${p.vendors} vendor(s), ${p.n} rating(s). Click for the vendor breakdown.">
      <div class="top"><span class="nm" title="${hesc(p.name)}">${hesc(p.name)}</span><span class="pc">${p.pct}%</span></div>
      <div class="track"><div class="fill" style="width:${p.pct}%;background:${buColorFor(p.name)}"></div></div>
    </div>`).join('') : `<div class="empty" style="padding:24px">${selectedAnalysisVendor?`No rated POs for ${hesc(analysisVendorLabel)}${selectedAnalysisTeam?` under ${hesc(TEAM_LABEL[selectedAnalysisTeam])}`:''}.`:'No rated POs carry a BU yet.'}</div>`;
  const buChartData = {
    labels:     buBars.map(b=>tr(b.name,18)),
    fullLabels: buBars.map(b=>b.name),
    values:     buBars.map(b=>+(b.pct/20).toFixed(2)),
    colors:     buBars.map(b=>buDimmed(b.name)?'#c9ced6':buColorFor(b.name)),
  };

  // Vendor-level breakdown inside each BU — powers the "which vendor performs how in this
  // BU" drill-down. Keyed on BU + vendor because a vendor can hold POs in more than one BU
  // and each of those is a separate performance story.
  const buVenAgg={}, buVenCatAgg={};
  buChartSrc.forEach(i=>{
    const bu=(i.bu||'').trim(); if(!bu) return;
    const code=(i.vendor||'').trim(); if(!code) return;
    const key=bu+'||'+code;
    const ik=stableKey(i);
    const bag=itemRatings[ik];
    const meta=categoryMeta[ik]||{};
    const sc=vendorTierScore(bag,meta);
    if(!buVenAgg[key]) buVenAgg[key]={bu,code,name:i.vendorName||'',sum:0,n:0,pos:new Set(),scores:[]};
    const o=buVenAgg[key];
    if(!o.name && i.vendorName) o.name=i.vendorName;
    o.sum+=sc; o.n++; o.scores.push(sc);
    if(i.poNum) o.pos.add(i.poNum);
    if(!buVenCatAgg[key]) buVenCatAgg[key]={};
    LNT_MATRIX.forEach(c=>{
      if(!categoryScoreEligible(meta,c.id)) return;
      const has=c.params.some((_,pi)=>{const v=bag[`${c.id}_${pi}`];return v!=null&&v!=='';});
      if(has){
        if(!buVenCatAgg[key][c.id]) buVenCatAgg[key][c.id]={sum:0,n:0};
        buVenCatAgg[key][c.id].sum+=calcCategoryScore(c.id,bag);
        buVenCatAgg[key][c.id].n++;
      }
    });
  });
  // Sorted BU first, then best score inside the BU, so the table reads as a per-BU ranking.
  function computeBuVendorRows(catId, onlyBu){
    let list=Object.entries(buVenAgg).map(([key,o])=>{
      let pct,n;
      if(!catId){ pct=Math.round(o.sum/o.n); n=o.n; }
      else { const c=(buVenCatAgg[key]||{})[catId]; if(!c||!c.n) return null; pct=Math.round(c.sum/c.n); n=c.n; }
      return {bu:o.bu, code:o.code, name:o.name||o.code, pct, n, pos:o.pos.size,
              best:o.scores.length?Math.max(...o.scores):null,
              worst:o.scores.length?Math.min(...o.scores):null};
    }).filter(Boolean);
    if(onlyBu) list=list.filter(r=>r.bu===onlyBu);
    list.sort((a,b)=> a.bu===b.bu ? b.pct-a.pct : a.bu.localeCompare(b.bu));
    return list;
  }

  // Region distribution (vendor primary-location). Uses i.region/i.location/i.state when present.
  const REGION_KEYS=[
    {id:'north', label:'North', c:'#8a5cc4', match:/\b(north|delhi|new delhi|ncr|noida|gurgaon|gurugram|faridabad|ghaziabad|punjab|ludhiana|amritsar|jalandhar|haryana|panipat|up|uttar\s*pradesh|lucknow|kanpur|noida|meerut|agra|varanasi|prayagraj|allahabad|rajasthan|jaipur|jodhpur|udaipur|kota|himachal|shimla|uttarakhand|dehradun|haridwar|chandigarh|jammu|kashmir|srinagar)\b/i},
    {id:'west',  label:'West',  c:'#1f8a72', match:/\b(west|mumbai|bombay|maharashtra|pune|nagpur|nashik|thane|aurangabad|gujarat|ahmedabad|surat|vadodara|baroda|rajkot|gandhinagar|goa|panaji|madhya\s*pradesh|bhopal|indore|gwalior|jabalpur)\b/i},
    {id:'east',  label:'East',  c:'#e0863a', match:/\b(east|kolkata|calcutta|bengal|west\s*bengal|howrah|siliguri|durgapur|odisha|orissa|bhubaneswar|cuttack|bihar|patna|gaya|jharkhand|ranchi|jamshedpur|dhanbad|assam|guwahati|chhattisgarh|raipur|northeast|shillong|imphal|agartala|itanagar)\b/i},
    {id:'south', label:'South', c:'#2f6fd0', match:/\b(south|chennai|madras|tamil|tamil\s*nadu|coimbatore|madurai|trichy|salem|karnataka|bangalore|bengaluru|mysore|mysuru|mangalore|hubli|hyderabad|telangana|warangal|kerala|kochi|cochin|trivandrum|thiruvananthapuram|kozhikode|thrissur|andhra|andhra\s*pradesh|vijayawada|visakhapatnam|vizag|tirupati|puducherry|pondicherry)\b/i},
  ];
  // International vendors (outside India). Checked BEFORE the India buckets above so that a
  // specific phrase like "South Africa" or "South Korea" resolves to Africa / East Asia rather
  // than being caught by India's bare "south" keyword.
  const INTL_REGION_KEYS=[
    {id:'middleEast', label:'Middle East', c:'#c0503a', match:/\b(middle\s*east|gcc|saudi|ksa|riyadh|jeddah|jubail|dammam|khobar|dhahran|mecca|makkah|medina|uae|u\.a\.e|dubai|abu\s*dhabi|sharjah|ajman|fujairah|ras\s*al\s*khaimah|qatar|doha|oman|muscat|sohar|salalah|bahrain|manama|kuwait|kuwait\s*city|iraq|baghdad|jordan|amman|lebanon|beirut|egypt|cairo|alexandria|giza|yemen|israel|tel\s*aviv)\b/i},
    {id:'eastAsia',   label:'China & East Asia', c:'#4a6fa5', match:/\b(china|chinese|shanghai|beijing|shenzhen|guangzhou|hangzhou|jiangsu|zhejiang|hebei|langfang|wuxi|suzhou|ningbo|nanjing|xiamen|qingdao|chengdu|wuhan|dongguan|foshan|kunshan|tianjin|chongqing|xian|dalian|guangdong|fujian|shandong|anhui|sichuan|hong\s*kong|\bhk\b|taiwan|taipei|japan|tokyo|osaka|yokohama|nagoya|south\s*korea|korea|seoul|busan|incheon)\b/i},
    {id:'seAsia',     label:'Southeast Asia', c:'#2e9b5b', match:/\b(south\s*east\s*asia|southeast\s*asia|singapore|malaysia|kuala\s*lumpur|johor|penang|thailand|bangkok|chonburi|rayong|vietnam|hanoi|ho\s*chi\s*minh|indonesia|jakarta|surabaya|bandung|batam|philippines|manila|cebu|davao|myanmar|cambodia|laos)\b/i},
    {id:'europe',     label:'Europe', c:'#6b5b95', match:/\b(europe|u\.?k\.?|united\s*kingdom|england|scotland|wales|london|manchester|birmingham|germany|berlin|munich|frankfurt|hamburg|stuttgart|cologne|dusseldorf|france|paris|lyon|marseille|italy|milan|rome|turin|naples|spain|madrid|barcelona|netherlands|amsterdam|rotterdam|switzerland|zurich|geneva|belgium|brussels|antwerp|sweden|stockholm|norway|oslo|denmark|copenhagen|finland|helsinki|poland|warsaw|krakow|austria|vienna|portugal|lisbon|ireland|dublin|greece|athens|czech|prague|hungary|budapest|romania|bucharest)\b/i},
    {id:'americas',   label:'Americas', c:'#c99a2e', match:/\b(usa|u\.s\.a|united\s*states|america|new\s*york|los\s*angeles|chicago|houston|dallas|austin|san\s*antonio|san\s*diego|san\s*francisco|san\s*jose|phoenix|philadelphia|atlanta|boston|miami|seattle|denver|detroit|nashville|charlotte|indianapolis|columbus|pittsburgh|minneapolis|cleveland|cincinnati|kansas\s*city|st\.?\s*louis|texas|california|florida|illinois|ohio|georgia|michigan|pennsylvania|virginia|canada|toronto|vancouver|montreal|calgary|ottawa|edmonton|mexico|monterrey|guadalajara|brazil|sao\s*paulo|rio\s*de\s*janeiro|argentina|buenos\s*aires|chile|santiago|colombia|bogota)\b/i},
    {id:'africa',     label:'Africa', c:'#9b2226', match:/\b(africa|south\s*africa|johannesburg|cape\s*town|durban|pretoria|nigeria|lagos|abuja|kenya|nairobi|morocco|casablanca|rabat|algeria|algiers|tunisia|tunis|ghana|accra|ethiopia|addis\s*ababa|tanzania|dar\s*es\s*salaam)\b/i},
  ];
  // Resolve a vendor's location text to a region: international patterns first (more
  // specific phrases), then the India buckets as fallback for bare words like "South".
  function regionForHay(hay){ return INTL_REGION_KEYS.find(r=>r.match.test(hay)) || REGION_KEYS.find(r=>r.match.test(hay)) || null; }
  const regionCount={north:0,west:0,east:0,south:0,middleEast:0,eastAsia:0,seAsia:0,europe:0,americas:0,africa:0};
  let regionSeen=false;
  (function(){
    const seen=new Set();
    // Scoped to the picked vendor when one is active; otherwise every loaded vendor.
    const regionSrc = selectedAnalysisVendor ? aItems : buAll;
    regionSrc.forEach(i=>{
      const code=(i.vendor||'').trim(); if(!code||seen.has(code)) return; seen.add(code);
      seen.add(normVenKey(code)); seen.add(normCodeKey(code));
      const mloc=vendorLocationFor(i.vendor, i.vendorName);   // Vendor Master location takes priority
      const hay=`${mloc} ${i.region||''} ${i.location||''} ${i.state||''} ${i.city||''}`;
      const hit=regionForHay(hay);
      if(hit){ regionCount[hit.id]++; regionSeen=true; }
    });
    // Vendors that exist only in the Vendor Master (no PO tracker loaded, or this vendor has no
    // PO yet) still count here, so the map works with just the Vendor Master uploaded.
    if(!selectedAnalysisVendor){
      Object.values(VENDOR_MASTER_ROSTER||{}).forEach(v=>{
        const code=(v.code||v.name||'').trim(); if(!code) return;
        const nk=normVenKey(code), ck=normCodeKey(code);
        if(seen.has(code)||seen.has(nk)||seen.has(ck)) return;
        seen.add(code); seen.add(nk); seen.add(ck);
        const hit=regionForHay(v.location||'');
        if(hit){ regionCount[hit.id]++; regionSeen=true; }
      });
    }
  })();

  // ---- Clickable-card drill-down data for the four overview charts ----
  // Declared here (rather than inside the IIFE below) so the Vendor Location map,
  // rendered separately after this IIFE runs, can pick up the same BU/vendor scope.
  let _mapScopeCodes = null, _mapScopeLabel = null;
  (function(){
    const _scopeNote = analysisVendorLabel ? ` · scoped to ${hesc(analysisVendorLabel)}` : '';
    const _pctCol = v => v>=90?'#1e7d34':v>=80?'#4f9d3a':v>=70?'#8a7d17':v>=50?'#c07a1e':'#a82f1c';
    const _bar = (v,max,col) => `<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
      <div style="flex:0 0 96px;height:7px;background:var(--s4);border:1px solid var(--brd);overflow:hidden;border-radius:2px;">
        <div style="height:100%;width:${Math.max(0,Math.min(100,(v/max)*100))}%;background:${col};"></div></div>
      <span style="font-family:var(--mono);font-weight:600;color:${col};min-width:46px;text-align:right;">${v.toFixed(v<10?2:0)}${max===100?'%':''}</span></div>`;

    // ---------- Category-wise Rating ----------
    const _catIds = selectedAnalysisTeam ? [] : LNT_MATRIX.map(c=>c.id);
    const _catRows = (analysisData.labels||[]).map((lb,i)=>{
      const v = Number(analysisData.values[i]||0);
      const cid = _catIds[i];
      return { go: cid?`setAnalysisTeam('${cid}');openCardDetail('ov_category')`:null,
        navTitle: cid?`Drill into ${lb} parameters`:'', cells:[
        `<strong>${hesc((analysisData.fullLabels&&analysisData.fullLabels[i])||lb)}</strong>`,
        _bar(v,5,analysisData.colors[i]||'#2f6fd0'),
        `<span style="font-family:var(--mono);color:var(--t2)">${(v*20).toFixed(0)}%</span>` ] };
    });
    const _catBest = _catRows.length?[...analysisData.values].reduce((m,v)=>Math.max(m,v||0),0):0;
    const _catWorst = analysisData.values.length?[...analysisData.values].reduce((m,v)=>Math.min(m,v==null?5:v),5):0;
    const _catMean = analysisData.values.length?analysisData.values.reduce((x,y)=>x+(y||0),0)/analysisData.values.length:0;
    setCardData('ov_category', { back:'overview', title:'Category-wise Rating', headline:'out of 5',
      sub:analysisVendorLabel?`Average rating per category for ${hesc(analysisVendorLabel)}.`:'Average rating per category across all evaluated vendors.',
      kpis:[
        {label:'Categories', value:analysisData.labels.length, foot:'rating dimensions'},
        {label:'Portfolio mean', value:_catMean.toFixed(2), unit:'/5', color:_pctCol(_catMean*20), foot:`${(_catMean*20).toFixed(0)}% equivalent`},
        {label:'Strongest', value:_catBest.toFixed(2), unit:'/5', color:'#1e7d34', foot:hesc(analysisData.labels[analysisData.values.indexOf(_catBest)]||'—')},
        {label:'Weakest', value:_catWorst.toFixed(2), unit:'/5', color:'#a82f1c', foot:hesc(analysisData.labels[analysisData.values.indexOf(_catWorst)]||'—')},
        {label:'Rated POs', value:aItems.length, foot:`in ${scopeLabel()}${_scopeNote?' (scoped)':''}`},
      ],
      chart:{ title:'Category comparison', badge:'avg ★ / 5', height:290, config:{type:'bar',
        data:{labels:analysisData.labels,datasets:[{data:analysisData.values,backgroundColor:analysisData.colors,borderWidth:0,borderRadius:4}]},
        options:{indexAxis:'y',scales:{x:{beginAtZero:true,max:5,ticks:{...TK,stepSize:1},grid:GR},y:{ticks:{...TK},grid:{display:false}}},plugins:{legend:{display:false}}}}},
      tableTitle:'Categories',
      columns:[{label:'Category'},{label:'Avg score / 5',align:'right'},{label:'As %',align:'right'}], rows:_catRows });

    // ---------- Project-wise Performance (full list, click through) ----------
    const _allProj = computeProjBarsFor(selectedAnalysisTeam, -1);
    const _projRows = _allProj.map((p,idx)=>({
      project:p.name, navTitle:`Open ${p.name}`,
      cells:[
        `<span style="font-family:var(--mono);color:var(--t3)">${String(idx+1).padStart(2,'0')}</span>`,
        `<strong>${hesc(p.name)}</strong>`,
        `<span style="font-family:var(--mono);color:var(--t2)">${p.vendors||0}</span>`,
        `<span style="font-family:var(--mono);color:var(--t2)">${p.pos||0}</span>`,
        p.best!=null?`<span style="font-family:var(--mono);color:#1e7d34">${p.best.toFixed(0)}%</span>`:'—',
        p.worst!=null?`<span style="font-family:var(--mono);color:#a82f1c">${p.worst.toFixed(0)}%</span>`:'—',
        _bar(p.pct,100,_pctCol(p.pct)) ] }));
    const _pAvg = _allProj.length?_allProj.reduce((x,y)=>x+y.pct,0)/_allProj.length:0;
    const _pVend = new Set(); _allProj.forEach(p=>{const o=projAgg[p.name]; if(o&&o.vendors) o.vendors.forEach(v=>_pVend.add(v));});
    const _pPos = _allProj.reduce((x,y)=>x+(y.pos||0),0);

    // -- Chart 1: Top performers (capped so the bar chart stays readable; the full
    //    ranked list is still one click away in the table). --
    const _topN = Math.min(12, _allProj.length);
    const _topProj = _allProj.slice(0, _topN);

    // -- Chart 2: Projects grouped into performance tiers (mirrors the vendor tier
    //    bands: Platinum ≥90, Gold ≥75, Silver ≥60, Bronze <60 — Bronze is a true
    //    catch-all with no floor, same as computeVendorTiers() in
    //    70-rating-matrix-and-scope.js, so a poorly-scoring project is never silently
    //    dropped from every band instead of landing in Bronze). --
    const _tierBands = [
      {label:'Platinum',  c:'#5b4fcf', test:v=>v>=90},
      {label:'Gold',      c:'#b58a1b', test:v=>v>=75&&v<90},
      {label:'Silver',    c:'#5f6b75', test:v=>v>=60&&v<75},
      {label:'Bronze',    c:'#a0592c', test:v=>v<60},
    ];
    const _tierCounts = _tierBands.map(b=>_allProj.filter(p=>b.test(p.pct)).length);

    // -- Chart 3: Best vs. worst PO within each of the top projects — shows how
    //    consistent (or spread out) ratings are inside a project, not just its average. --
    const _spreadProj = _allProj.slice(0, Math.min(8, _allProj.length));

    setCardData('ov_project', { back:'overview', title:'Project-wise Performance', headline:`${_allProj.length} projects`,
      sub:`Every rated project for <strong>${scopeLabel()}</strong>${_scopeNote}, highest score first. Click a project to open its full breakdown — POs, category ratings and parameter-level detail.`,
      kpis:[
        {label:'Projects', value:_allProj.length, foot:'with at least one rating'},
        {label:'Average score', value:_pAvg.toFixed(1), unit:'%', color:_pctCol(_pAvg), foot:'across all projects'},
        {label:'Top project', value:_allProj.length?`${_allProj[0].pct}%`:'—', color:'#1e7d34', foot:hesc(_allProj.length?_allProj[0].name:'—')},
        {label:'Needs attention', value:_allProj.length?`${_allProj[_allProj.length-1].pct}%`:'—', color:'#a82f1c', foot:hesc(_allProj.length?_allProj[_allProj.length-1].name:'—')},
        {label:'Vendors involved', value:_pVend.size, foot:`${_pPos} purchase order(s)`},
      ],
      charts:[
        { title:`Top ${_topN} projects`, badge:'score %', height:Math.max(240, Math.min(420, 30*_topN+70)), config:{type:'bar',
          data:{labels:_topProj.map(p=>tr(p.name,30)),datasets:[{data:_topProj.map(p=>p.pct),backgroundColor:_topProj.map(p=>_pctCol(p.pct)),borderWidth:0,borderRadius:4}]},
          options:{indexAxis:'y',scales:{x:{beginAtZero:true,max:100,ticks:{...TK},grid:GR},y:{ticks:{...TK,font:{size:11,family:'IBM Plex Mono'}},grid:{display:false}}},
            plugins:{legend:{display:false},tooltip:{callbacks:{title:it=>_topProj[it[0].dataIndex].name,
              label:it=>{const p=_topProj[it.dataIndex];return ` ${p.pct}% · ${p.vendors} vendor(s) · ${p.pos} PO(s)`;}}}}}},
          note:_allProj.length>_topN?`+${_allProj.length-_topN} more in the table below.`:null },
        { title:'Projects by tier', badge:'count', height:290, config:{type:'doughnut',
          data:{labels:_tierBands.map(b=>b.label),datasets:[{data:_tierCounts,backgroundColor:_tierBands.map(b=>b.c),borderColor:'#ffffff',borderWidth:2}]},
          plugins:[donutCenterText],
          options:{cutout:'62%',plugins:{legend:{position:'right',labels:{...TK,boxWidth:12,padding:14}},
            donutCenterText:{display:true,big:_allProj.length,small:'Projects'},
            tooltip:{callbacks:{label:it=>` ${it.label}: ${it.raw} project(s)`}}}}} },
        { title:'Best vs. worst PO', badge:`top ${_spreadProj.length}`, height:Math.max(240, Math.min(380, 34*_spreadProj.length+70)), config:{type:'bar',
          data:{labels:_spreadProj.map(p=>tr(p.name,26)),
            datasets:[
              {label:'Best PO %', data:_spreadProj.map(p=>p.best!=null?+p.best.toFixed(0):0), backgroundColor:'#1e7d34', borderWidth:0, borderRadius:3},
              {label:'Worst PO %', data:_spreadProj.map(p=>p.worst!=null?+p.worst.toFixed(0):0), backgroundColor:'#a82f1c', borderWidth:0, borderRadius:3},
            ]},
          options:{indexAxis:'y',scales:{x:{beginAtZero:true,max:100,ticks:{...TK},grid:GR},y:{ticks:{...TK,font:{size:11,family:'IBM Plex Mono'}},grid:{display:false}}},
            plugins:{legend:{display:true,position:'top',labels:{...TK,boxWidth:12}},tooltip:{callbacks:{title:it=>_spreadProj[it[0].dataIndex].name}}}}},
          note:'A big gap between the two bars means the project has both a strong and a weak vendor — worth a closer look.' },
      ],
      tableTitle:'Projects',
      columns:[{label:'#'},{label:'Project'},{label:'Vendors',align:'right'},{label:'POs',align:'right'},
               {label:'Best PO',align:'right'},{label:'Worst PO',align:'right'},{label:'Score %',align:'right'}],
      rows:_projRows });

    // ---------- Item-wise Performance ----------
    const _im = itemChartData.meta||[];
    // Nested drill-down: one sub-card per item listing the vendors/projects behind it.
    (itemChartData.fullLabels||[]).forEach((iname,ix)=>{
      const rowsFor=[];
      aItems.forEach(i=>{
        if(itemsForScopePO(i.poNum).indexOf(iname)===-1) return;
        const ik=stableKey(i);
        const bag=itemRatings[ik];
        const sc=vendorTierScore(bag,categoryMeta[ik]||{});
        rowsFor.push({ code:(i.vendor||'').trim()||null, navTitle:`Open ${i.vendorName||i.vendor||'vendor'}`, _sc:sc, cells:[
          `<strong>${hesc(i.vendorName||i.vendor||'—')}</strong>${i.vendor?`<div style="font-family:var(--mono);font-size:10px;color:var(--t3)">${vendorCodeDisplay(i.vendor)}</div>`:''}`,
          `<span style="font-family:var(--mono);font-size:11px">${hesc(i.poNum||'—')}</span>`,
          hesc(i.jobDesc||i.jobCode||i.sheet||'—'),
          `<span style="font-family:var(--mono);font-weight:600;color:${_pctCol(sc)}">${sc.toFixed(1)}%</span>`,
          `<span style="font-family:var(--mono);color:var(--t2)">${(sc/20).toFixed(2)} ★</span>` ] });
      });
      rowsFor.sort((x,y)=>y._sc-x._sc);
      const scs=rowsFor.map(r=>r._sc);
      const avg=scs.length?scs.reduce((x,y)=>x+y,0)/scs.length:0;
      setCardData('ov_item_'+ix, { back:'card:ov_item', title:hesc(iname), headline:`${(avg/20).toFixed(2)} ★`,
        sub:`Every rated purchase order carrying this item in <strong>${scopeLabel()}</strong>. Click a row to open that vendor's scorecard.`,
        kpis:[
          {label:'Ratings', value:rowsFor.length, foot:'purchase order(s)'},
          {label:'Vendors', value:new Set(rowsFor.map(r=>r.code).filter(Boolean)).size, foot:'supplying this item'},
          {label:'Average', value:avg.toFixed(1), unit:'%', color:_pctCol(avg), foot:`${(avg/20).toFixed(2)} ★ out of 5`},
          {label:'Best', value:scs.length?scs[0].toFixed(1):'—', unit:'%', color:'#1e7d34', foot:hesc(rowsFor.length?rowsFor[0].cells[0].replace(/<[^>]+>/g,' ').trim():'—')},
          {label:'Lowest', value:scs.length?scs[scs.length-1].toFixed(1):'—', unit:'%', color:'#a82f1c', foot:hesc(rowsFor.length?rowsFor[rowsFor.length-1].cells[0].replace(/<[^>]+>/g,' ').trim():'—')},
        ],
        chart: rowsFor.length>1 ? { title:'Score by vendor', badge:'score %', height:Math.max(220, Math.min(460, 32*rowsFor.length+60)), config:{type:'bar',
          data:{labels:rowsFor.map(r=>tr(r.cells[0].replace(/<[^>]+>/g,' ').trim(),26)),
            datasets:[{data:scs,backgroundColor:scs.map(v=>_pctCol(v)),borderWidth:0,borderRadius:4}]},
          options:{indexAxis:'y',scales:{x:{beginAtZero:true,max:100,ticks:{...TK},grid:GR},y:{ticks:{...TK,font:{size:11,family:'IBM Plex Mono'}},grid:{display:false}}},
            plugins:{legend:{display:false},tooltip:{callbacks:{title:it=>rowsFor[it[0].dataIndex].cells[0].replace(/<[^>]+>/g,' ').trim()}}}}}} : null,
        tableTitle:'Purchase orders',
        columns:[{label:'Vendor'},{label:'PO No.'},{label:'Project'},{label:'Score',align:'right'},{label:'Stars',align:'right'}],
        rows:rowsFor });
    });
    const _itemRows = (itemChartData.labels||[]).map((lb,i)=>{
      const v=Number(itemChartData.values[i]||0), m=_im[i]||{};
      return { go:`openCardDetail('ov_item_${i}')`, navTitle:'View every PO with this item', cells:[
        `<span style="font-family:var(--mono);color:var(--t3)">${String(i+1).padStart(2,'0')}</span>`,
        `<strong>${hesc((itemChartData.fullLabels&&itemChartData.fullLabels[i])||lb)}</strong>`,
        `<span style="font-family:var(--mono);color:var(--t2)">${m.vendors||0}</span>`,
        `<span style="font-family:var(--mono);color:var(--t2)">${m.projects||0}</span>`,
        `<span style="font-family:var(--mono);color:var(--t2)">${m.n||0}</span>`,
        _bar(v,5,_pctCol(v*20)),
        `<span style="font-family:var(--mono);color:var(--t2)">${(v*20).toFixed(0)}%</span>` ] };
    });
    const _iVals = itemChartData.values||[];
    const _iAvg = _iVals.length?_iVals.reduce((x,y)=>x+(y||0),0)/_iVals.length:0;
    setCardData('ov_item', { back:'overview', title:'Item-wise Performance', headline:'out of 5',
      sub:`Average rating per distinct item for <strong>${scopeLabel()}</strong>${_scopeNote}, highest first.`,
      kpis:[
        {label:'Distinct items', value:_iVals.length, foot:'rated this period'},
        {label:'Average rating', value:_iAvg.toFixed(2), unit:'/5', color:_pctCol(_iAvg*20), foot:`${(_iAvg*20).toFixed(0)}% equivalent`},
        {label:'Best item', value:_iVals.length?_iVals[0].toFixed(2):'—', unit:'/5', color:'#1e7d34', foot:hesc(_iVals.length?itemChartData.fullLabels[0]:'—')},
        {label:'Lowest item', value:_iVals.length?_iVals[_iVals.length-1].toFixed(2):'—', unit:'/5', color:'#a82f1c', foot:hesc(_iVals.length?itemChartData.fullLabels[_iVals.length-1]:'—')},
      ],
      chart:{ title:'Rating by item', badge:'avg ★ / 5', height:Math.max(260, Math.min(560, 30*_iVals.length+70)), config:{type:'bar',
        data:{labels:(itemChartData.labels||[]).map(l=>tr(l,30)),datasets:[{data:_iVals,backgroundColor:_iVals.map(v=>_pctCol(v*20)),borderWidth:0,borderRadius:4}]},
        options:{indexAxis:'y',scales:{x:{beginAtZero:true,max:5,ticks:{...TK,stepSize:1},grid:GR},y:{ticks:{...TK,font:{size:11,family:'IBM Plex Mono'}},grid:{display:false}}},
          plugins:{legend:{display:false},tooltip:{callbacks:{title:it=>itemChartData.fullLabels[it[0].dataIndex]||'',
            label:it=>{const m=_im[it.dataIndex]||{};return ` ${Number(_iVals[it.dataIndex]).toFixed(2)} ★ · ${m.vendors||0} vendor(s) · ${m.n||0} rating(s)`;}}}}}}},
      tableTitle:'Items',
      columns:[{label:'#'},{label:'Item'},{label:'Vendors',align:'right'},{label:'Projects',align:'right'},
               {label:'Ratings',align:'right'},{label:'Avg / 5',align:'right'},{label:'As %',align:'right'}],
      rows:_itemRows });

    // ---------- Vendor Location ----------
    const _reg={north:[],west:[],east:[],south:[],middleEast:[],eastAsia:[],seAsia:[],europe:[],americas:[],africa:[],none:[]}, _s=new Set();
    const _regSrc = selectedAnalysisVendor ? aItems : buAll;
    // Same vendor codes as _regSrc/_locRows below, kept as a flat list so the
    // Leaflet map (rendered separately) can be scoped to this exact set — this
    // is what makes the BU / vendor Analysis filter actually affect the map.
    _mapScopeCodes = (selectedAnalysisBu || selectedAnalysisVendor) ? [] : null;
    _regSrc.forEach(i=>{
      const code=(i.vendor||'').trim(); if(!code||_s.has(code)) return; _s.add(code);
      _s.add(normVenKey(code)); _s.add(normCodeKey(code));
      if(_mapScopeCodes) _mapScopeCodes.push(code);
      const mloc=vendorLocationFor(i.vendor, i.vendorName);
      const hay=`${mloc} ${i.region||''} ${i.location||''} ${i.state||''} ${i.city||''}`;
      const hit=regionForHay(hay);
      const vm=vendorMatrix.find(v=>v.code===code);
      const sc=vm&&vm.overall!=null?vm.overall:null;
      _reg[hit?hit.id:'none'].push({ code, navTitle:`Open ${i.vendorName||code}`, cells:[
        `<strong>${hesc(i.vendorName||code)}</strong>`,
        `<span style="font-family:var(--mono)">${hesc(code)}</span>`,
        hit?`<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${hit.c};display:inline-block"></i>${hit.label}</span>`:'<span style="color:var(--t2)">Unassigned</span>',
        hesc(mloc||'—'),
        sc!=null?`<span style="font-family:var(--mono);font-weight:600;color:${_pctCol(sc)}">${sc.toFixed(1)}%</span>`:'<span style="color:var(--t4)">—</span>' ] });
    });
    // Vendors that only exist in the Vendor Master (no PO/rating row loaded) still get listed,
    // so this page works with just the Vendor Master uploaded — no score yet, just placement.
    if(!selectedAnalysisVendor){
      Object.values(VENDOR_MASTER_ROSTER||{}).forEach(v=>{
        const code=(v.code||v.name||'').trim(); if(!code) return;
        const nk=normVenKey(code), ck=normCodeKey(code);
        if(_s.has(code)||_s.has(nk)||_s.has(ck)) return;
        _s.add(code); _s.add(nk); _s.add(ck);
        // Master-only vendors (no PO data) carry no BU of their own, so when a BU filter is
        // what made _mapScopeCodes non-null (the only way we can be here with it truthy and
        // no vendor picked — see the ternary above), adding them back in would silently
        // undo the BU restriction the first loop just built — the map badge count would
        // stay stuck at "every vendor" no matter which BU was picked. The region TABLE below
        // still lists them regardless of BU (unrelated to _mapScopeCodes), unchanged.
        if(_mapScopeCodes && !selectedAnalysisBu) _mapScopeCodes.push(v.code||code);
        const hit=regionForHay(v.location||'');
        _reg[hit?hit.id:'none'].push({ code:v.code||'', navTitle:`Open ${v.name||code}`, cells:[
          `<strong>${hesc(v.name||code)}</strong>`,
          `<span style="font-family:var(--mono)">${hesc(v.code||'—')}</span>`,
          hit?`<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${hit.c};display:inline-block"></i>${hit.label}</span>`:'<span style="color:var(--t2)">Unassigned</span>',
          hesc(v.location||'—'),
          '<span style="color:var(--t4)" title="No PO/rating loaded yet">—</span>' ] });
      });
    }
    const _locRows=[..._reg.north,..._reg.west,..._reg.east,..._reg.south,
      ..._reg.middleEast,..._reg.eastAsia,..._reg.seAsia,..._reg.europe,..._reg.americas,..._reg.africa,..._reg.none];
    const _domesticTotal = regionCount.north+regionCount.west+regionCount.east+regionCount.south;
    const _intlTotal = regionCount.middleEast+regionCount.eastAsia+regionCount.seAsia+regionCount.europe+regionCount.americas+regionCount.africa;
    const _placed = _domesticTotal + _intlTotal;
    // Same BU / vendor scope the Analysis charts already respect, shown in the map's badge
    // and used to restrict which pins are plotted (see renderVendorLocationMap's vendorCodes).
    _mapScopeLabel = [selectedAnalysisBu, analysisVendorLabel].filter(Boolean).join(' · ') || null;
    setCardData('ov_location', { back:'overview', title:'Vendor Location', headline:`${_placed} placed`,
      sub:`Vendors grouped by primary region — India split into North/West/East/South, everyone else grouped by their international region. Click a vendor to open its scorecard.`,
      kpis:[
        {label:'India', value:_domesticTotal, color:'#2f6fd0', foot:'N/W/E/S vendors'},
        {label:'International', value:_intlTotal, color:'#c0503a', foot:`${INTL_REGION_KEYS.filter(r=>regionCount[r.id]).length} region(s)`},
        {label:'Unassigned', value:_reg.none.length, color:'var(--t3)', foot:'no location on file'},
      ],
      note:`<div class="phd" style="margin:-14px -18px 12px;"><h3 class="pt">World Map</h3><span class="ch ch-b" id="vpd-leaflet-full-badge">full scale</span></div>
        <div class="vpd-leaflet-wrap full" id="vpd-leaflet-full"></div>
        <div class="vpd-map-hint" id="vpd-leaflet-full-hint" style="display:none;"></div>
        ${VPD_TIER_LEGEND_HTML}`,
      mapInit:{id:'vpd-leaflet-full', opts:{full:true, badgeId:'vpd-leaflet-full-badge', hintId:'vpd-leaflet-full-hint', vendorCodes:_mapScopeCodes, scopeLabel:_mapScopeLabel}},
      charts:[
        { title:'India — by zone', badge:'vendor count', height:270, config:{type:'doughnut',
          data:{labels:['North','West','East','South'],
            datasets:[{data:[regionCount.north,regionCount.west,regionCount.east,regionCount.south],
              backgroundColor:['#8a5cc4','#1f8a72','#e0863a','#2f6fd0'],borderColor:'#ffffff',borderWidth:2}]},
          plugins:[donutCenterText],
          options:{cutout:'62%',plugins:{legend:{position:'right',labels:{...TK,boxWidth:12,padding:14}},
            donutCenterText:{display:true,big:_domesticTotal,small:'India'}}}} },
        { title:'International — by region', badge:'vendor count', height:270, config:{type:'doughnut',
          data:{labels:INTL_REGION_KEYS.map(r=>r.label),
            datasets:[{data:INTL_REGION_KEYS.map(r=>regionCount[r.id]),
              backgroundColor:INTL_REGION_KEYS.map(r=>r.c),borderColor:'#ffffff',borderWidth:2}]},
          plugins:[donutCenterText],
          options:{cutout:'62%',plugins:{legend:{position:'right',labels:{...TK,boxWidth:12,padding:14}},
            donutCenterText:{display:true,big:_intlTotal,small:'Int\'l'}}}},
          note:_intlTotal?null:'No international vendors placed yet — add a city or country to the Location column in the Vendor Master.' },
      ],
      tableTitle:'Vendors by region',
      filterCol:'Region',
      columns:[{label:'Vendor'},{label:'Code'},{label:'Region'},{label:'Location'},{label:'Score',align:'right'}],
      rows:_locRows });

    // ---------- BU-wise Performance (vendor breakdown per BU) ----------
    // Answers "inside this BU, which vendor is performing how". When a BU is picked in the
    // Analysis bar the view narrows to it; otherwise every BU is listed, grouped and ranked.
    const _buFocus = selectedAnalysisBu || null;
    const _buVenRows = computeBuVendorRows(selectedAnalysisTeam, _buFocus);
    const _buList = computeBuBarsFor(selectedAnalysisTeam).filter(b=>!_buFocus||b.name===_buFocus);
    const _bvAvg = _buVenRows.length?_buVenRows.reduce((x,y)=>x+y.pct,0)/_buVenRows.length:0;
    const _bvBest = _buVenRows.length?_buVenRows.reduce((m,r)=>r.pct>m.pct?r:m,_buVenRows[0]):null;
    const _bvWorst = _buVenRows.length?_buVenRows.reduce((m,r)=>r.pct<m.pct?r:m,_buVenRows[0]):null;
    const _bvPos = _buVenRows.reduce((x,y)=>x+(y.pos||0),0);
    // Per-BU spread: the gap between the strongest and weakest vendor inside each BU.
    const _buSpread = _buList.map(b=>{
      const rows=_buVenRows.filter(r=>r.bu===b.name);
      return {name:b.name, hi:rows.length?Math.max(...rows.map(r=>r.pct)):0,
                           lo:rows.length?Math.min(...rows.map(r=>r.pct)):0, count:rows.length};
    }).filter(s=>s.count>0);
    const _bvTopN = Math.min(14, _buVenRows.length);
    const _bvTop = [..._buVenRows].sort((a,b)=>b.pct-a.pct).slice(0,_bvTopN);

    const _buVenTableRows = _buVenRows.map((r,idx)=>{
      const t = tierForScore(r.pct);
      return { go:`openVendorPage('${esc(r.code)}')`, navTitle:`Open ${r.name}`, cells:[
        `<span style="font-family:var(--mono);color:var(--t3)">${String(idx+1).padStart(2,'0')}</span>`,
        `<span style="font-family:var(--mono);font-size:11px;color:var(--t2)">${hesc(r.bu)}</span>`,
        `<strong>${hesc(r.name)}</strong><br><span style="font-family:var(--mono);font-size:10px;color:var(--t3)">${vendorCodeDisplay(r.code)}</span>`,
        `<span style="font-family:var(--mono);color:var(--t2)">${r.pos}</span>`,
        `<span style="font-family:var(--mono);color:var(--t2)">${r.n}</span>`,
        `<span style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.5px;padding:2px 7px;border-radius:2px;background:${t.c}1a;color:${t.c};border:1px solid ${t.c}55">${t.label}</span>`,
        _bar(r.pct,100,_pctCol(r.pct)) ] };
    });

    setCardData('ov_bu', { back:'overview',
      title: _buFocus?`${_buFocus} — Vendor Performance`:'BU-wise Performance',
      headline: _buFocus?`${_buVenRows.length} vendors`:`${_buList.length} BUs`,
      sub: _buFocus
        ? `Every rated vendor in <strong>${hesc(_buFocus)}</strong>${_scopeNote}, best first. Click a vendor to open its full page. Clear the BU filter on the Portfolio page to compare all BUs.`
        : `Every rated vendor grouped by Business Unit${_scopeNote}, ranked inside each BU. Pick a BU on the Portfolio page to narrow this to one unit. Click a vendor to open its full page.`,
      kpis:[
        {label:_buFocus?'Vendors':'BUs', value:_buFocus?_buVenRows.length:_buList.length, foot:_buFocus?`in ${hesc(_buFocus)}`:'with at least one rating'},
        {label:'Average score', value:_bvAvg.toFixed(1), unit:'%', color:_pctCol(_bvAvg), foot:'across these vendors'},
        {label:'Best vendor', value:_bvBest?`${_bvBest.pct}%`:'—', color:'#1e7d34', foot:hesc(_bvBest?_bvBest.name:'—')},
        {label:'Needs attention', value:_bvWorst?`${_bvWorst.pct}%`:'—', color:'#a82f1c', foot:hesc(_bvWorst?_bvWorst.name:'—')},
        {label:'Purchase orders', value:_bvPos, foot:`${_buVenRows.length} vendor-BU pairing(s)`},
      ],
      charts:[
        { title:_buFocus?`Vendors in ${_buFocus}`:`Top ${_bvTopN} vendors`, badge:'score %',
          height:Math.max(240, Math.min(460, 28*_bvTopN+70)), config:{type:'bar',
          data:{labels:_bvTop.map(r=>tr(r.name,28)),datasets:[{data:_bvTop.map(r=>r.pct),backgroundColor:_bvTop.map(r=>_pctCol(r.pct)),borderWidth:0,borderRadius:4}]},
          options:{indexAxis:'y',scales:{x:{beginAtZero:true,max:100,ticks:{...TK},grid:GR},y:{ticks:{...TK,font:{size:11,family:'IBM Plex Mono'}},grid:{display:false}}},
            plugins:{legend:{display:false},tooltip:{callbacks:{title:it=>_bvTop[it[0].dataIndex].name,
              label:it=>{const r=_bvTop[it.dataIndex];return ` ${r.pct}% · ${r.bu} · ${r.pos} PO(s) · ${r.n} rating(s)`;}}}}}},
          note:_buVenRows.length>_bvTopN?`+${_buVenRows.length-_bvTopN} more in the table below.`:null },
        { title:'Strongest vs. weakest vendor per BU', badge:`${_buSpread.length} BU(s)`,
          height:Math.max(220, Math.min(380, 46*_buSpread.length+70)), config:{type:'bar',
          data:{labels:_buSpread.map(s=>tr(s.name,22)),
            datasets:[
              {label:'Best vendor %', data:_buSpread.map(s=>s.hi), backgroundColor:'#1e7d34', borderWidth:0, borderRadius:3},
              {label:'Weakest vendor %', data:_buSpread.map(s=>s.lo), backgroundColor:'#a82f1c', borderWidth:0, borderRadius:3},
            ]},
          options:{indexAxis:'y',scales:{x:{beginAtZero:true,max:100,ticks:{...TK},grid:GR},y:{ticks:{...TK,font:{size:11,family:'IBM Plex Mono'}},grid:{display:false}}},
            plugins:{legend:{display:true,position:'top',labels:{...TK,boxWidth:12}},tooltip:{callbacks:{title:it=>_buSpread[it[0].dataIndex].name}}}}},
          note:'A wide gap means the BU carries both a strong and a weak vendor — the BU average alone would hide that.' },
      ],
      tableTitle:_buFocus?`Vendors in ${_buFocus}`:'Vendors by BU',
      filterCol: _buFocus?null:'BU',
      columns:[{label:'#'},{label:'BU'},{label:'Vendor'},{label:'POs',align:'right'},
               {label:'Ratings',align:'right'},{label:'Tier'},{label:'Score %',align:'right'}],
      rows:_buVenTableRows });
  })();

  // ---- Click-through detail pages for the top KPI stat cards ----
  // Total Vendors / Completion % both drill into the SAME full roster (every vendor,
  // whatever its status) since completion is just a read on that same list; Evaluated
  // Vendors narrows it to the vendors that actually cleared every domain.
  const _kpiPctCol = v => v>=90?'#1e7d34':v>=80?'#4f9d3a':v>=70?'#8a7d17':v>=50?'#c07a1e':'#a82f1c';
  const _statusBadge = v => {
    if(v.score!=null){ const t=tierForScore(v.score);
      return `<span style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.5px;padding:2px 7px;border-radius:2px;background:${t.c}1a;color:${t.c};border:1px solid ${t.c}55">${t.label}</span>`; }
    if(v.missing) return `<span style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.5px;padding:2px 7px;border-radius:2px;background:#d98c1f1a;color:#8a5200;border:1px solid #d98c1f55">DOMAINS INCOMPLETE</span>`;
    return `<span style="font-size:10px;font-family:var(--mono);color:var(--t4)">NOT RATED</span>`;
  };
  const _vendorRow = v => ({ code:v.code, navTitle:`Open ${v.name||v.code}`, cells:[
    `<strong>${hesc(v.name||v.code)}</strong>${v.name?`<div style="font-family:var(--mono);font-size:10px;color:var(--t3)">${vendorCodeDisplay(v.code)}</div>`:''}`,
    v.score!=null?`<span style="font-family:var(--hd);font-weight:600;color:${tierForScore(v.score).c}">${v.score.toFixed(1)}%</span>`:'<span style="color:var(--t4)">—</span>',
    _statusBadge(v),
    `<span class="ch ch-b">${v.ratedCount||0}/${v.itemCount}</span>` ] });
  const _allVendorRows = [...ranked, ...tiers.incomplete, ...tiers.notRated].map(_vendorRow);
  const _statusKpis = [
    {label:'Evaluated', value:evaluatedCount, color:'#1e7d34', foot:'all 4 domains complete', go:"openCardDetail('ov_evaluated_vendors')"},
    {label:'Domains Incomplete', value:tiers.incomplete.length, color:'#8a5200', foot:'partially rated', go:"showTierVendors('incomplete')"},
    {label:'Not Rated', value:tiers.notRated.length, color:'#5e656d', foot:'no rating yet', go:"showTierVendors('notRated')"},
  ];
  setCardData('ov_total_vendors', { back:'overview', title:'All Vendors', headline:totalV,
    sub:`Every vendor across ${SHEETS.length} project sheet(s) in ${scopeLabel()} — evaluated, mid-evaluation, and not yet rated. Click a vendor to open its scorecard.`,
    kpis:_statusKpis,
    tableTitle:'Vendor scoreboard',
    filterCol:'Status',
    columns:[{label:'Vendor'},{label:'Score',align:'right'},{label:'Status'},{label:'Rated / Items',align:'right'}],
    rows:_allVendorRows });
  setCardData('ov_evaluated_vendors', { back:'overview', title:'Evaluated Vendors', headline:evaluatedCount,
    sub:`Vendors with every SCM / EDRC / Quality / Operations domain Completed, so they carry a final tier score. ${tiers.notRated.length+tiers.incomplete.length} more are still pending — click a vendor to open its scorecard.`,
    kpis:[
      {label:'Platinum', value:tiers.platinum.length, color:'#5b4fcf', foot:'90–100%', go:"showTierVendors('platinum')"},
      {label:'Gold', value:tiers.gold.length, color:'#b58a1b', foot:'75–89.9%', go:"showTierVendors('gold')"},
      {label:'Silver', value:tiers.silver.length, color:'#5f6b75', foot:'60–74.9%', go:"showTierVendors('silver')"},
      {label:'Bronze', value:tiers.bronze.length, color:'#a0592c', foot:'50–59.9%', go:"showTierVendors('bronze')"},
    ],
    tableTitle:'Evaluated vendor scoreboard',
    filterCol:'Tier',
    columns:[{label:'Vendor'},{label:'Score',align:'right'},{label:'Tier'},{label:'Rated / Items',align:'right'}],
    rows:ranked.map(_vendorRow) });

  // Total No. of Items — portfolio-wide (unfiltered by the Analysis BU/vendor scope),
  // matching how the KPI card itself counts distinctRatedItems.
  const _totalItemAgg={};
  ratedItems.forEach(i=>{
    const ik=stableKey(i);
    const bag=itemRatings[ik];
    const tierSc=vendorTierScore(bag,categoryMeta[ik]||{});
    itemsForScopePO(i.poNum).forEach(itm=>{
      if(!itm) return;
      if(!_totalItemAgg[itm]) _totalItemAgg[itm]={sum:0,n:0,vendors:new Set()};
      _totalItemAgg[itm].sum+=tierSc; _totalItemAgg[itm].n++;
      if((i.vendor||'').trim()) _totalItemAgg[itm].vendors.add((i.vendor||'').trim());
    });
  });
  const _itemRowsAll = Object.entries(_totalItemAgg)
    .map(([name,o])=>({name,avg:o.n?o.sum/o.n:0,n:o.n,vendors:o.vendors.size}))
    .sort((a,b)=>b.avg-a.avg);
  setCardData('ov_total_items', { back:'overview', title:'Rated Items', headline:distinctRatedItems,
    sub:`Every distinct item (from the ITEM column) with at least one rated PO in ${scopeLabel()}, ranked by average score.`,
    chart: _itemRowsAll.length ? { title:'Average score by item', badge:'out of 100',
      height:Math.max(220, Math.min(460, 32*_itemRowsAll.length+60)), config:{type:'bar',
        data:{labels:_itemRowsAll.map(e=>tr(e.name,26)),
          datasets:[{data:_itemRowsAll.map(e=>+e.avg.toFixed(1)), backgroundColor:_itemRowsAll.map(e=>_kpiPctCol(e.avg)), borderWidth:0, borderRadius:3}]},
        options:{indexAxis:'y',scales:{x:{beginAtZero:true,max:100,ticks:{...TK},grid:GR},y:{ticks:{...TK,font:{size:11,family:'IBM Plex Mono'}},grid:{display:false}}},
          plugins:{legend:{display:false},tooltip:{callbacks:{title:it=>_itemRowsAll[it[0].dataIndex].name}}}}} } : null,
    tableTitle:'Items rated',
    columns:[{label:'Item'},{label:'Ratings',align:'right'},{label:'Vendors',align:'right'},{label:'Avg score',align:'right'}],
    rows:_itemRowsAll.map(e=>({ navTitle:`${e.name} — ${e.n} rating(s)`, cells:[
      hesc(e.name), String(e.n), String(e.vendors),
      `<span style="font-family:var(--hd);font-weight:600;color:${_kpiPctCol(e.avg)}">${e.avg.toFixed(1)}%</span>` ] })) });

  const statCards = `
    <div class="vpd-stat click" onclick="openCardDetail('ov_total_vendors')" title="View every vendor in the portfolio">
      <div class="vpd-stat-ic" style="background:var(--acc-lt);color:var(--acc);"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
      <div class="vpd-stat-body"><div class="vpd-stat-label">Total Vendors</div><div class="vpd-stat-value">${totalV}</div><div class="vpd-stat-foot">across ${SHEETS.length} project sheet(s)</div></div>
    </div>
    <div class="vpd-stat click" onclick="openCardDetail('ov_total_items')" title="View every distinct item that's been rated">
      <div class="vpd-stat-ic" style="background:var(--grn-lt);color:var(--grn);"><svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/></svg></div>
      <div class="vpd-stat-body"><div class="vpd-stat-label">Total No. of Items</div><div class="vpd-stat-value">${distinctRatedItems.toLocaleString()}</div><div class="vpd-stat-foot">distinct items rated</div></div>
    </div>
    <div class="vpd-stat click" onclick="openCardDetail('ov_evaluated_vendors')" title="View vendors that have completed every rating domain">
      <div class="vpd-stat-ic" style="background:var(--amb-lt);color:var(--amb);"><svg viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg></div>
      <div class="vpd-stat-body"><div class="vpd-stat-label">Evaluated Vendors</div><div class="vpd-stat-value">${evaluatedCount} <small>/ ${totalV}</small></div><div class="vpd-stat-foot">Completed</div></div>
    </div>
    <div class="vpd-stat click" onclick="showTierVendors('incomplete')" title="View vendors whose SCM/EDRC/Quality/Operations domains aren't all Completed yet">
      <div class="vpd-stat-ic" style="background:var(--amb-lt);color:var(--amb);"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
      <div class="vpd-stat-body"><div class="vpd-stat-label">Domains Incomplete</div><div class="vpd-stat-value">${tiers.incomplete.length}</div><div class="vpd-stat-foot ${tiers.incomplete.length?'warn':''}">${tiers.incomplete.length?'Not yet tier-eligible':'All done ✓'}</div></div>
    </div>
    <div class="vpd-stat click" onclick="showTierVendors('notRated')" title="View not-rated vendors">
      <div class="vpd-stat-ic" style="background:var(--red-lt);color:var(--red);"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15h6"/></svg></div>
      <div class="vpd-stat-body"><div class="vpd-stat-label">Pending Evaluation</div><div class="vpd-stat-value">${tiers.notRated.length}</div><div class="vpd-stat-foot ${tiers.notRated.length?'warn':''}">${tiers.notRated.length?'Action Required':'All done ✓'}</div></div>
    </div>`;

  const legendHtml = legendDefs.map(d=>{
    const ct = tierCounts[d.key];
    return `<div class="vpd-legrow" onclick="showTierVendors('${d.key}')" title="View ${d.name} vendors">
      <span class="medal">${d.medal}</span>
      <span class="nm" style="color:${d.c}">${d.name}</span>
      <span class="ct">${ct}</span>
    </div>`;
  }).join('');

  const regionMapCard = `
    <div class="pn vpd-map-card">
      <div class="phd phd-click" onclick="openCardDetail('ov_location')" title="View full details"><h3 class="pt">Vendor Location</h3><span class="ch ch-b" id="vpd-leaflet-compact-badge">worldwide</span></div>
      <div class="pb">
        <div class="vpd-leaflet-wrap compact" id="vpd-leaflet-compact"></div>
        <div class="vpd-map-hint" id="vpd-leaflet-compact-hint" style="display:none;"></div>
        ${VPD_TIER_LEGEND_HTML}
      </div>
    </div>`;

  setM(`
    <div class="vpd-period-bar" style="display:none;"></div>

    <div class="vpd-stats">${statCards}</div>

    <div class="vpd-band3">
      <div class="pn">
        <div class="phd"><h3 class="pt">Vendor Tier Distribution</h3><span class="ch ch-b">${totalV} vendors</span></div>
        <div class="pb">
          <div class="vpd-donut-wrap">
            <div class="cbox" style="height:300px"><canvas id="ch-tier"></canvas></div>
            <div class="vpd-legend">${legendHtml}</div>
          </div>
        </div>
      </div>

      <div class="pn">
        <div class="phd"><h3 class="pt">Vendors in Selected Tier</h3><select class="ch" onchange="setOverviewTier(this.value)" title="Choose a tier to view" style="background:${featuredDef.c}1a;color:${featuredDef.c};border-color:${featuredDef.c}77;border-width:1.5px;border-style:solid;cursor:pointer;-webkit-appearance:none;appearance:none;font-size:11px;font-weight:700;padding:4px 12px;border-radius:999px;">${['platinum','gold','silver','bronze'].map(k=>{const d=legendDefs.find(x=>x.key===k);return `<option value="${k}" ${k===featuredKey?'selected':''} style="background:var(--s1);color:${d.c};">${d.medal} ${d.name} (${tierCounts[k]})</option>`;}).join('')}</select></div>
        <div class="pb">
          <table class="vpd-mini">
            <thead><tr><th>Vendor</th><th>Code</th><th style="text-align:right">Rated</th><th style="text-align:right">Score</th></tr></thead>
            <tbody>${featRows}</tbody>
          </table>
          ${featuredList.length>6?`<button class="vpd-viewall" onclick="showTierVendors('${featuredKey}')">View all ${featuredList.length} vendors <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>`:''}
        </div>
      </div>

      <div class="pn">
        <div class="phd phd-click" onclick="openCardDetail('ov_cat_vendors')" title="View every vendor ranked, team by team"><h3 class="pt">Overall Category-wise Rating</h3><span class="ch ch-b">out of 5</span></div>
        <div class="pb" style="padding-top:6px">
          ${catRowsHtml}
        </div>
      </div>
    </div>

    <div class="vpd-analysis-hd">
      <div class="t">Analysis</div>
      <div class="vpd-legdots">
        <select class="vpd-vendorsel" onchange="setAnalysisBu(this.value)" title="Scope every chart below to one Business Unit">
          <option value="">All BUs</option>
          ${analysisBuList.map(b=>`<option value="${hesc(b)}"${b===selectedAnalysisBu?' selected':''}>${hesc(b)}</option>`).join('')}
        </select>
        <select class="vpd-vendorsel" onchange="setAnalysisVendor(this.value)" title="Scope every chart below to one vendor">
          <option value="">All Vendors</option>
          ${analysisVendorList.map(v=>`<option value="${hesc(v.code)}"${v.code===selectedAnalysisVendor?' selected':''}>${hesc(v.name||v.code)}</option>`).join('')}
        </select>
        <span class="vpd-legsep"></span>
        <span class="pick${selectedAnalysisTeam?'':' on'}" onclick="setAnalysisTeam(null)" title="Show all teams"><i style="background:var(--t3)"></i>All Teams</span>
        <span class="pick${selectedAnalysisTeam==='scm'?' on':''}" onclick="setAnalysisTeam('scm')" title="Scope charts to SCM"><i style="background:${CAT_COLORS.scm}"></i>SCM</span>
        <span class="pick${selectedAnalysisTeam==='edrc'?' on':''}" onclick="setAnalysisTeam('edrc')" title="Scope charts to EDRC"><i style="background:${CAT_COLORS.edrc}"></i>EDRC</span>
        <span class="pick${selectedAnalysisTeam==='quality'?' on':''}" onclick="setAnalysisTeam('quality')" title="Scope charts to Quality"><i style="background:${CAT_COLORS.quality}"></i>Quality</span>
        <span class="pick${selectedAnalysisTeam==='operation'?' on':''}" onclick="setAnalysisTeam('operation')" title="Scope charts to Operations"><i style="background:${CAT_COLORS.operation}"></i>Operations</span>
      </div>
    </div>

    <div class="vpd-band4">
      <div class="pn"><div class="phd phd-click" onclick="openCardDetail('ov_category')" title="View full details"><h3 class="pt">${analysisVendorLabel?`${hesc(analysisVendorLabel)} — `:''}${analysisTeamLabel?`${hesc(analysisTeamLabel)} Parameter Rating`:'Category-wise Rating'}</h3><span class="ch ch-b">out of 5</span></div><div class="pb"><div class="cbox"><canvas id="ch-cat"></canvas></div></div></div>
      <div class="pn"><div class="phd phd-click" onclick="openCardDetail('ov_project')" title="View full details"><h3 class="pt">${analysisVendorLabel?`${hesc(analysisVendorLabel)} — `:''}Project-wise Performance</h3><span class="ch ch-b">${analysisTeamLabel?`${hesc(analysisTeamLabel)} score %`:'score %'}</span></div><div class="pb">${projBarsHtml}</div></div>
      <div class="pn"><div class="phd phd-click" onclick="openCardDetail('ov_item')" title="View full details"><h3 class="pt">${analysisVendorLabel?`${hesc(analysisVendorLabel)} — `:''}${analysisTeamLabel?`${hesc(analysisTeamLabel)} `:''}Item-wise Performance</h3><span class="ch ch-b">out of 5</span></div><div class="pb"><div class="cbox"><canvas id="ch-item"></canvas></div></div></div>
      ${regionMapCard}
    </div>

    <div class="g2" style="margin-top:16px;">
      <div class="pn"><div class="phd phd-click" onclick="openCardDetail('ov_bu')" title="See which vendor performs how in each BU"><h3 class="pt">${analysisVendorLabel?`${hesc(analysisVendorLabel)} — `:''}${analysisTeamLabel?`${hesc(analysisTeamLabel)} `:''}BU-wise Rating</h3><span class="ch ch-b">out of 5</span></div><div class="pb"><div class="cbox"><canvas id="ch-bu"></canvas></div></div></div>
      <div class="pn"><div class="phd phd-click" onclick="openCardDetail('ov_bu')" title="See which vendor performs how in each BU"><h3 class="pt">${analysisVendorLabel?`${hesc(analysisVendorLabel)} — `:''}BU-wise Performance</h3><span class="ch ch-b">${analysisTeamLabel?`${hesc(analysisTeamLabel)} score %`:'score %'}</span></div><div class="pb">${buBarsHtml}</div></div>
    </div>

    ${advancedPanels}

  `);

  // Donut — tier distribution
  mkCh('ch-tier',{type:'doughnut',data:{labels:['Platinum','Gold','Silver','Bronze','Domains Incomplete','Not Rated'],datasets:[{data:[tiers.platinum.length,tiers.gold.length,tiers.silver.length,tiers.bronze.length,tiers.incomplete.length,tiers.notRated.length],backgroundColor:['#5b4fcf','#f5a623','#1a73e8','#e8710a','#d98c1f','#188038'],borderColor:'#ffffff',borderWidth:2}]},plugins:[donutCenterText,donutPercentLabels],options:{cutout:'66%',animation:false,layout:{padding:{top:24,bottom:24,left:50,right:50}},plugins:{legend:{display:false},donutCenterText:{display:true,big:totalV,small:'Vendors'},donutPercentLabels:{display:true,color:'#333',minPercent:4,outside:true,outsideOffset:10,fontSize:16,weight:600}}}});
  // Category-wise rating (0–5)
  mkCh('ch-cat',{type:'bar',data:{labels:analysisData.labels,datasets:[{data:analysisData.values,backgroundColor:analysisData.colors,borderWidth:0,borderRadius:4}]},options:{scales:{x:{ticks:{...TK,font:{size:13,family:'IBM Plex Mono'}},grid:{display:false}},y:{ticks:{...TK,stepSize:1},grid:GR,beginAtZero:true,max:5}},plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>{const i=items[0].dataIndex; return (analysisData.fullLabels&&analysisData.fullLabels[i])||analysisData.labels[i];}}}}}});
  // Item-wise performance line (avg star, 0–5). "All Teams" = across categories; a chosen team = across its own parameters.
  const _itemLineColor = selectedAnalysisTeam ? CAT_COLORS[selectedAnalysisTeam] : '#2f6fd0';
  const _itemLineBg = (()=>{ const h=_itemLineColor.replace('#',''); const r=parseInt(h.substring(0,2),16),g=parseInt(h.substring(2,4),16),b=parseInt(h.substring(4,6),16); return `rgba(${r},${g},${b},.14)`; })();
  const _itemChartCfg={type:'line',data:{labels:itemChartData.labels,datasets:[{data:itemChartData.values,borderColor:_itemLineColor,backgroundColor:_itemLineBg,fill:true,tension:.35,pointBackgroundColor:_itemLineColor,pointRadius:4,borderWidth:2}]},options:{scales:{x:{ticks:{...TK,font:{size:13,family:'IBM Plex Mono'}},grid:{display:false}},y:{ticks:{...TK,stepSize:1},grid:GR,beginAtZero:true,max:5}},plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>{const i=items[0].dataIndex; return (itemChartData.fullLabels&&itemChartData.fullLabels[i])||itemChartData.labels[i];}}}}}};
  // The item chart canvas is #ch-item in the normal layout; when no region/location data is
  // present the 4th band slot falls back to a second item panel (#ch-item2). Draw whichever
  // exists — mkCh no-ops on a missing canvas — so we never leave a duplicate id blank.
  mkCh('ch-item', _itemChartCfg);

  mkCh('ch-bu',{type:'bar',data:{labels:buChartData.labels,datasets:[{data:buChartData.values,backgroundColor:buChartData.colors,borderWidth:0,borderRadius:4}]},options:{scales:{x:{ticks:{...TK,font:{size:12,family:'IBM Plex Mono'}},grid:{display:false}},y:{ticks:{...TK,stepSize:1},grid:GR,beginAtZero:true,max:5}},plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>buChartData.fullLabels[items[0].dataIndex]||buChartData.labels[items[0].dataIndex],label:(it)=>`${it.parsed.y} / 5  (${buBars[it.dataIndex]?buBars[it.dataIndex].pct:0}%)`}}}}});
  mkCh('ch-item2', _itemChartCfg);
  if(typeof renderVendorLocationMap==='function'){
    requestAnimationFrame(()=>renderVendorLocationMap('vpd-leaflet-compact', {full:false, badgeId:'vpd-leaflet-compact-badge', hintId:'vpd-leaflet-compact-hint', vendorCodes:_mapScopeCodes, scopeLabel:_mapScopeLabel}));
  }
}

// TIER DRILL-DOWN: show all vendors belonging to a specific tier (Platinum/Gold/Silver/Bronze/High Risk/Not Rated)
function showTierVendors(tierKey, fromHistory=false){
  const h = '#tier:' + encodeURIComponent(tierKey);
  if(!fromHistory && window.location.hash !== h) {
    window.history.pushState(null, '', h);
  }
  initRatings();
  const tiers=computeVendorTiers();
  const TIER_DEF={
    platinum: {medal:'💎', label:'Platinum',  sub:'90 – 100%',    c:'#5b4fcf', bg:'rgba(91,79,207,.10)',  brd:'rgba(91,79,207,.40)'},
    gold:     {medal:'🥇', label:'Gold',      sub:'75 – 89.9%',   c:'#b58a1b', bg:'rgba(181,138,27,.10)', brd:'rgba(181,138,27,.40)'},
    silver:   {medal:'🥈', label:'Silver',    sub:'60 – 74.9%',   c:'#5f6b75', bg:'rgba(95,107,117,.10)', brd:'rgba(95,107,117,.40)'},
    bronze:   {medal:'🥉', label:'Bronze',    sub:'50 – 59.9%',   c:'#a0592c', bg:'rgba(160,89,44,.10)',  brd:'rgba(160,89,44,.40)'},
    incomplete: {medal:'⏳', label:'Domains Incomplete', sub:'SCM+EDRC+Quality+Ops must all be Completed', c:'#8a5200', bg:'rgba(217,140,31,.10)', brd:'rgba(217,140,31,.40)'},
    notRated: {medal:'—',  label:'Not Rated', sub:'no rating yet', c:'#5e656d', bg:'var(--s2)',           brd:'var(--brd)'},
  };
  const def=TIER_DEF[tierKey]; if(!def) return;
  const list=tiers[tierKey]||[];

  // Build vendor cards with score, item count, and click-through to vendor detail
  const cards=list.length ? list.map((v,idx)=>{
    const init=(v.name||v.code).split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const scoreTxt = v.score!=null
      ? `<div style="font-family:var(--hd);font-weight:700;font-size:24px;color:${def.c};margin-top:8px;">${v.score.toFixed(1)}%</div>`
      : `<div style="font-size:11px;color:var(--t4);font-family:var(--mono);margin-top:8px;">Not rated</div>`;
    return `<div class="tcard" data-vn="${hesc(((v.name||'')+' '+v.code).toLowerCase())}" onclick="openVendorPage('${esc(v.code)}')" style="cursor:pointer" title="Click to view details for ${hesc(v.name||v.code)}">
      <div class="tav" style="background:${def.c}20;color:${def.c}">${hesc(init)}</div>
      <div class="tn" style="white-space:normal;word-break:normal;overflow-wrap:break-word;text-wrap:pretty;">${hesc(v.name||v.code)}</div>
      ${v.name?`<div style="font-family:var(--mono);font-size:10px;color:var(--t3);margin-top:2px;">${vendorCodeDisplay(v.code)}</div>`:''}
      ${scoreTxt}
      <div class="tst" style="margin-top:6px;"><span><span style="color:var(--txt);font-weight:600">${v.ratedCount||0}</span> rated</span><span style="color:var(--t3)">${v.itemCount} item(s)</span></div>
    </div>`;
  }).join('') : `<div class="empty" style="grid-column:1/-1;padding:30px;color:var(--t3);text-align:center;">No vendors in the ${hesc(def.label)} tier.</div>`;

  // Build table view
  const tbadge=(t)=>`<span style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.5px;padding:2px 7px;border-radius:2px;background:${t.c}1a;color:${t.c};border:1px solid ${t.c}55">${t.label}</span>`;
  const tblRows=list.map(v=>{
    const t = v.score!=null ? tierForScore(v.score) : null;
    return `<tr data-vn="${hesc(((v.name||'')+' '+v.code).toLowerCase())}" onclick="openVendorPage('${esc(v.code)}')" style="cursor:pointer">
      <td><strong>${hesc(v.name||v.code)}</strong>${v.name?`<div style="font-family:var(--mono);font-size:10px;color:var(--t3)">${vendorCodeDisplay(v.code)}</div>`:''}</td>
      <td>${v.score!=null?`<span style="font-family:var(--hd);font-weight:600;color:${def.c}">${v.score.toFixed(1)}%</span>`:'<span style="color:var(--t4)">—</span>'}</td>
      <td>${t?tbadge(t):'<span style="font-size:10px;font-family:var(--mono);color:var(--t4)">NOT RATED</span>'}</td>
      <td><span class="ch ch-b">${v.ratedCount||0}/${v.itemCount}</span></td></tr>`;
  }).join('')||`<tr><td colspan="4" style="text-align:center;color:var(--t4);padding:22px">No vendors in this tier.</td></tr>`;

  setM(`
    <div class="shd">
      <h2 class="stitle">${hesc(def.medal)} ${hesc(def.label)} Vendors</h2>
      <div class="chps">
        <span class="ch ch-a">${scopeLabel()}</span>
        <span class="ch ch-b">${list.length} vendor(s)</span>
        <span class="ch" style="background:${def.c}1a;color:${def.c};border-color:${def.c}55">${hesc(def.sub)}</span>
      </div>
    </div>
    <div class="pn" style="margin-bottom:14px">
      <div class="pb" style="padding:12px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <button class="pgb" onclick="goBack('overview')" style="display:inline-flex;align-items:center;gap:6px;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back to Portfolio
        </button>
        <span style="color:var(--t3);font-size:12px;">Showing all <strong>${hesc(def.label)}</strong> tier vendors</span>
        <input class="sinp" id="tier-filter" placeholder="Filter by vendor name or code…" oninput="tierFilterRows(this.value)" style="margin-left:auto;min-width:180px;max-width:260px;"/>
      </div>
    </div>
    <div class="tgrid" id="tier-cards">${cards}</div>
    <div id="tier-cards-empty" style="display:none;padding:30px;color:var(--t3);text-align:center;">No vendors match this filter.</div>
    <div class="pn" style="margin-top:18px;">
      <div class="phd"><h3 class="pt">${hesc(def.label)} Vendor Scoreboard</h3><span class="ch ch-b" id="tier-table-count">${list.length} vendor${list.length===1?'':'s'}</span></div>
      <div class="tw"><table class="dt" id="tier-table"><thead><tr><th>Vendor</th><th>Score</th><th>Tier</th><th>Rated / Items</th></tr></thead><tbody>${tblRows}</tbody></table></div>
    </div>
  `);
}
// Live filter for the tier drill-down page (showTierVendors): narrows both the card
// grid and the scoreboard table together by vendor name or code, same "type to narrow"
// pattern used everywhere else this data shows up as a list.
function tierFilterRows(q){
  q=(q||'').trim().toLowerCase();
  let cardsShown=0, rowsShown=0, rowsTotal=0;
  document.querySelectorAll('#tier-cards .tcard').forEach(e=>{
    const show=!q||(e.dataset.vn||'').includes(q);
    e.style.display=show?'':'none';
    if(show) cardsShown++;
  });
  const emptyCards=document.getElementById('tier-cards-empty');
  if(emptyCards) emptyCards.style.display=cardsShown===0?'':'none';
  const tbl=document.getElementById('tier-table');
  if(tbl){
    [...tbl.tBodies[0].rows].forEach(tr=>{
      if(!tr.dataset.vn) return; // the "No vendors in this tier" placeholder row
      rowsTotal++;
      const show=!q||tr.dataset.vn.includes(q);
      tr.style.display=show?'':'none';
      if(show) rowsShown++;
    });
  }
  const countEl=document.getElementById('tier-table-count');
  if(countEl && rowsTotal) countEl.textContent = q ? `${rowsShown} of ${rowsTotal} vendor${rowsTotal===1?'':'s'}` : `${rowsTotal} vendor${rowsTotal===1?'':'s'}`;
}

// VIEW: RISK

function rRisk(){
  const risks=getRisk(),high=risks.filter(r=>r.level==='high'),med=risks.filter(r=>r.level==='medium');
  const rCards=list=>list.length?list.map(r=>`<div class="ri ${r.level}"><div style="flex:1;min-width:0"><div class="rn" title="${hesc(r.item)}">${hesc(r.item)}</div><div class="rp">${hesc(r.sheet)} · ${hesc(r.vendor||'TBD')}</div></div><div class="rr" title="${hesc(r.reason)}">${hesc(r.reason)}</div><span class="rbdg ${r.level}">${r.level.toUpperCase()}</span></div>`).join(''):'<div class="empty">No items at this level 🎉</div>';

  const projR=SHEETS.map(s=>({n:tr(DB[s].name,16),full:DB[s].name,h:risks.filter(r=>r.sheetId===s&&r.level==='high').length,m:risks.filter(r=>r.sheetId===s&&r.level==='medium').length}));

  setM(`
    <div class="shd"><h2 class="stitle">Risk Alerts</h2><div class="chps"><span class="ch ch-r">${high.length} High</span><span class="ch ch-a">${med.length} Medium</span></div></div>
    <div class="kg">
      <div class="kpi"><div class="kl">Total At-Risk</div><div class="kv cr">${risks.length}</div></div>
      <div class="kpi"><div class="kl">High Priority</div><div class="kv cr">${high.length}</div></div>
      <div class="kpi"><div class="kl">Medium</div><div class="kv ca">${med.length}</div></div>
      <div class="kpi"><div class="kl">CAT-1 Blocked</div><div class="kv ca">${risks.filter(r=>r.reason.includes('CAT-1')).length}</div></div>
    </div>
    <div class="g2">
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--red)">🔴 High Risk</h3><span class="ch ch-r">${high.length}</span></div><div class="pb"><div class="rl">${rCards(high)}</div></div></div>
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--amb)">🟡 Medium Risk</h3><span class="ch ch-a">${med.length}</span></div><div class="pb"><div class="rl">${rCards(med)}</div></div></div>
    </div>
    <div class="pn"><div class="phd"><h3 class="pt">Risk by Sheet</h3></div><div class="pb"><div class="cboxl"><canvas id="ch-rp"></canvas></div></div></div>
  `);
  mkCh('ch-rp',{type:'bar',data:{labels:projR.map(p=>p.n),datasets:[{label:'High',data:projR.map(p=>p.h),backgroundColor:'#a82f1c',borderRadius:0,borderWidth:0},{label:'Medium',data:projR.map(p=>p.m),backgroundColor:'#9a6a07',borderRadius:0,borderWidth:0}]},options:{scales:{x:{stacked:true,ticks:TK,grid:GR},y:{stacked:true,ticks:TK,grid:GR,beginAtZero:true}},plugins:{tooltip:{callbacks:{title:(items)=>projR[items[0].dataIndex]?.full||items[0].label}}}}});
}


// VIEW: PIPELINE

function rPipeline(){
  const a=all();
  const rfq=a.filter(i=>['pending'].includes(poSt(i)));
  const conf=a.filter(i=>poSt(i)==='confirmed');
  const poRel=a.filter(i=>poSt(i)==='released');
  const mfc=poRel.filter(i=>['issued','partial','pending'].includes(mfcSt(i)));
  const del=a.filter(i=>i.matRec&&i.matRec.length>2);
  const cols=[{t:'Pending',n:rfq.length,items:rfq,c:'#aab0b6'},{t:'Confirmed',n:conf.length,items:conf,c:'#2a5f6b'},{t:'PO Released',n:poRel.length,items:poRel,c:'#0072bc'},{t:'MFC Stage',n:mfc.length,items:mfc,c:'#9a6a07'},{t:'Delivered',n:del.length,items:del,c:'#3f6d2c'}];
  const knC=items=>{let h=items.slice(0,10).map(i=>`<div class="knc"><div class="kncn" title="${hesc(i.item)}">${hesc(i.item)}</div><div class="kncp">${hesc(i.sheet)}</div></div>`).join('');if(items.length>10)h+=`<div class="knm">+${items.length-10} more</div>`;return h};
  const pp=SHEETS.map(s=>({n:tr(s,16),full:s,r:DB[s].rows.filter(i=>poSt(i)==='released').length,c:DB[s].rows.filter(i=>poSt(i)==='confirmed').length,p:DB[s].rows.filter(i=>poSt(i)==='pending').length}));

  setM(`
    <div class="shd"><h2 class="stitle">PO Pipeline</h2><span class="ch ch-b">${a.length} items</span></div>
    <div class="kg">${cols.map(c=>`<div class="kpi"><div class="kl">${c.t}</div><div class="kv" style="color:${c.c}">${c.n}</div></div>`).join('')}</div>
    <div class="pn"><div class="phd"><h3 class="pt">Procurement Flow</h3></div><div class="pb" style="overflow-x:auto;padding-bottom:14px"><div class="kanban">${cols.map(c=>`<div class="kncol"><div class="knhd" style="color:${c.c}">${c.t}<span class="kncnt" style="color:${c.c}">${c.n}</span></div><div class="knb">${knC(c.items)}</div></div>`).join('')}</div></div></div>
    <div class="pn"><div class="phd"><h3 class="pt">Pipeline by Sheet</h3></div><div class="pb"><div class="cboxl"><canvas id="ch-pp"></canvas></div></div></div>
  `);
  mkCh('ch-pp',{type:'bar',data:{labels:pp.map(p=>p.n),datasets:[{label:'Released',data:pp.map(p=>p.r),backgroundColor:'#3f6d2c',borderRadius:0,borderWidth:0},{label:'Confirmed',data:pp.map(p=>p.c),backgroundColor:'#2a5f6b',borderRadius:0,borderWidth:0},{label:'Pending',data:pp.map(p=>p.p),backgroundColor:'#9a6a07',borderRadius:0,borderWidth:0}]},options:{scales:{x:{stacked:true,ticks:TK,grid:GR},y:{stacked:true,ticks:TK,grid:GR,beginAtZero:true}},plugins:{tooltip:{callbacks:{title:(items)=>pp[items[0].dataIndex]?.full||items[0].label}}}}});
}


// VIEW: TEAM

// Index each PO's per-category Buyer (from the rating workbook meta, active half-year)
// so a selected team can be driven by the Excel's category Buyer columns, not the single
// PO-owner field. Returns { poNumber: { scm, edrc, quality, operation } } (buyer names).
function buildCatBuyerIndex(){
  const idx={}; const cm=categoryMeta||{};
  Object.keys(cm).forEach(sk=>{
    const mm=cm[sk]; if(!mm) return;
    const pm=String(sk).match(/^po:([^|]+)\|/); if(!pm) return;
    const po=pm[1]; if(!po) return;
    if(!idx[po]) idx[po]={};
    ['scm','edrc','quality','operation'].forEach(cid=>{
      const b=mm[cid]&&String(mm[cid].buyer||'').trim();
      if(b && !idx[po][cid]) idx[po][cid]=b;
    });
  });
  return idx;
}
