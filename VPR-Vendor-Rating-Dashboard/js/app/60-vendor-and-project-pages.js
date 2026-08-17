/* ============================================================
 * 60-vendor-and-project-pages.js
 * Vendor Focus list + per-vendor / per-project detail pages
 * ------------------------------------------------------------
 * Part of the Acme Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */
function rVendors(){
  initRatings();
  const a=all(),vm={};
  a.forEach(i=>{const v=i.vendor||'TBD';if(v.length<2)return;if(!vm[v])vm[v]={code:v,name:i.vendorName||'',items:[],sheets:new Set()};if(!vm[v].name&&i.vendorName)vm[v].name=i.vendorName;vm[v].items.push(i);vm[v].sheets.add(i.sheet)});
  const vs=Object.values(vm).sort((a,b)=>b.items.length-a.items.length);
  const vc=vs.map(v=>{
    const grpN=(VENDOR_GROUP_MEMBERS[v.code]||[]).length;
    const grpBadge=grpN>1?`<span title="${grpN} registered entities merged into this company view" style="display:inline-block;margin-top:4px;padding:2px 7px;border-radius:999px;background:var(--acc-lt,#e8f1fa);color:var(--acc,#0072bc);font-size:9.5px;font-weight:700;letter-spacing:.03em;">${grpN} ENTITIES</span>`:'';
    return `<div class="vcard ${v.sheets.size>1?'multi':''}" data-vn="${hesc((v.code+' '+v.name).toLowerCase())}" style="cursor:pointer" title="Click to view all items for ${hesc(v.name||v.code)}" onclick="openVendorPage('${esc(v.code)}')"><div class="vn" style="white-space:normal;word-break:normal;overflow-wrap:break-word;text-wrap:pretty;" title="${hesc(v.name||v.code)}">${hesc(v.name||v.code)}</div>${v.code?`<div style="font-family:var(--mono);font-size:11.5px;color:var(--t2);margin-top:2px;line-height:1.4;word-break:normal;overflow-wrap:normal;">${wbrCode(vendorCodeDisplay(v.code))}</div>`:''}<div class="vm" style="margin-top:4px;">${v.items.length} item(s) · ${v.sheets.size} sheet(s)</div><div style="font-size:10px;color:var(--t3);margin-top:2px;font-family:var(--mono)">${hesc([...v.sheets].join(', '))}</div>${grpBadge}</div>`;
  }).join('');

  const totalPOs = a.length;
  const catTotals = { scm:0, edrc:0, quality:0, operation:0 };
  const catCounts = { scm:0, edrc:0, quality:0, operation:0 };
  let sumScores = 0, scoredVendors = 0;

  const tiers = typeof computeVendorTiers==='function'?computeVendorTiers():{platinum:[],gold:[],silver:[],bronze:[]};
  ['platinum','gold','silver','bronze'].forEach(k => {
    (tiers[k]||[]).forEach(v => {
      sumScores += v.score;
      scoredVendors++;
    });
  });
  const avgVendorScore = scoredVendors ? (sumScores / scoredVendors).toFixed(1) : 0;

  a.forEach(i => {
    const k = stableKey(i);
    const bag = itemRatings[k];
    if(hasSavedRatingValues(bag)) {
      REPORT_CATS.forEach(rc => {
        const cScore = calcCategoryScore(rc.id, bag);
        if (cScore != null) {
           catTotals[rc.id] += cScore;
           catCounts[rc.id]++;
        }
      });
    }
  });

  const catAverages = REPORT_CATS.map(rc => catCounts[rc.id] ? +(catTotals[rc.id]/catCounts[rc.id]).toFixed(1) : 0);
  const catLabels = REPORT_CATS.map(rc => ({scm:'SCM',edrc:'EDRC',quality:'Quality',operation:'Operation'}[rc.id]||rc.id.toUpperCase()));

  /* The half-year selector lives in ONE place: the H1 / H2 / Both control in the
     top bar. Each view used to carry its own copy, which drifted out of sync with
     the header (and this page's copy was missing "Both" entirely, so Completeness
     could never show the combined view). Kept as an empty string so the render
     templates below are untouched. */
  const vendorsQuarterSelector = '';

  setM(`
    <div class="shd"><h2 class="stitle">Vendor Concentration</h2><div class="chps" style="align-items:center;gap:10px;">${vendorsQuarterSelector}<span class="ch ch-b">${vs.length} vendors</span></div></div>
    ${vendorTierPanelHTML()}
    <div class="kg">
      <div class="kpi"><div class="kl">Total POs Tracked</div><div class="kv cb">${totalPOs}</div></div>
      <div class="kpi"><div class="kl">Vendors Rated</div><div class="kv cp">${scoredVendors} <small>/ ${vs.length}</small></div></div>
      <div class="kpi"><div class="kl">Avg Vendor Score</div><div class="kv ca">${avgVendorScore}%</div></div>
    </div>
    <div class="pn"><div class="phd"><h3 class="pt">Global Category Performance</h3></div><div class="pb"><div class="cboxl" style="height:220px;"><canvas id="ch-cat-perf"></canvas></div></div></div>
    <div class="pn"><div class="phd"><h3 class="pt">Vendor Directory</h3><input class="sinp" placeholder="Search by code or name…" oninput="fltV(this.value)" style="width:200px"/></div><div class="pb"><div class="vgrid" id="vg">${vc}</div></div></div>
  `);
  
  mkCh('ch-cat-perf',{
    type:'bar',
    data:{
      labels:catLabels,
      datasets:[{
        data:catAverages,
        backgroundColor:['#2a5f6b','#5b4fcf','#b58a1b','#a0592c'],
        borderWidth:0,
        borderRadius:4,
        barPercentage:0.6
      }]
    },
    options:{
      indexAxis:'y',
      maintainAspectRatio:false,
      scales:{
        x:{ticks:{...TK,callback:v=>v+'%'},grid:GR,min:0,max:100},
        y:{ticks:{...TK,font:{size:11.5,family:'IBM Plex Sans',weight:'600'},color:'var(--t1)'},grid:{display:false}}
      },
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label:(ctx)=>` Average: ${ctx.raw}%`
          }
        }
      }
    }
  });
}
function fltV(q){q=q.toLowerCase();document.querySelectorAll('#vg .vcard').forEach(e=>{e.style.display=!q||e.dataset.vn.includes(q)?'':'none'})}


// VENDOR DASHBOARD — full page, one row per PO/project with the
// SCM / EDRC / Quality / Operation responsibility matrix + rating.

function openVendorPage(code, fromHistory=false){
  const h = '#vendor:' + encodeURIComponent(code);
  if(!fromHistory && window.location.hash !== h) {
    window.history.pushState(null, '', h);
  }
  initRatings();
  const a=all();
  const items=a.filter(i=>(i.vendor||'TBD')===code);
  const nm=items.find(i=>i.vendorName&&i.vendorName.length>1);
  const vname=nm?nm.vendorName:'';
  const vemail=(items.map(i=>i.vendorEmail).find(e=>e&&e.includes('@')))||vendorEmailFor(code,vname);
  const sheets=new Set(items.map(i=>i.sheet)).size;

  // Group-of-entities panel: when several vendor codes were folded into this company
  // view, show each one's own Vendor Master record side by side instead of picking a
  // single "representative" — no entity's location/contact is silently hidden.
  const groupMembers = VENDOR_GROUP_MEMBERS[code]||[];
  const groupEntitiesPanel = groupMembers.length>1 ? `
    <div class="pn" style="margin-bottom:14px;">
      <div class="phd"><h3 class="pt">Registered Entities (${groupMembers.length})</h3><span class="ch ch-b">combined into this company view</span></div>
      <div class="pb" style="overflow:auto;padding-top:2px;">
        <table class="dt">
          <thead><tr><th>Vendor Code</th><th>Legal Name</th><th>Factory Location</th><th>Primary Contact</th></tr></thead>
          <tbody>
            ${groupMembers.map(m=>{
              const d=vendorDetailsFor(m.code, m.name)||{};
              const contact = (d.c1Name||d.c1Email)
                ? `${d.c1Name?hesc(d.c1Name):''}${d.c1Email?`${d.c1Name?' · ':''}<a href="mailto:${hesc(d.c1Email)}" style="color:var(--acc,#0072bc);text-decoration:none;">${hesc(d.c1Email)}</a>`:''}`
                : `<span style="color:var(--t3)">Not in Vendor Master</span>`;
              return `<tr style="cursor:pointer" onclick="openVendorDetail('${esc(m.code)}')" title="Open full contact details">
                <td style="font-family:var(--mono);font-size:11.5px;white-space:nowrap">${hesc(m.code)}</td>
                <td>${hesc(d.name||m.name)}</td>
                <td>${hesc(d.factory||'—')}</td>
                <td style="font-size:11.5px">${contact}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  // Header cell for one category group (label + weight), spanning Evaluator+Approver.
  const grpHdr=REPORT_CATS.map(rc=>{
    const cat=LNT_MATRIX.find(c=>c.id===rc.id)||{w:0};
    const short={scm:'SCM',edrc:'EDRC',quality:'Quality',operation:'Operation'}[rc.id]||rc.id.toUpperCase();
    return `<th colspan="2" class="vmx-grp">${short}-${cat.w}%</th>`;
  }).join('');

  const rows=items.map((i,idx)=>{
    const key=stableKey(i);
    const meta=categoryMeta[key]||{};
    const bagForRow=itemRatings[key]||{};
    const proj=i.item||i.jobDesc||i.poNum||'—';
    const catCells=REPORT_CATS.map(rc=>{
      const cm=meta[rc.id]||{};
      const def=CATEGORY_ROLES[rc.id]||{ev:'—',ap:'—'};
      const ev=cm.buyer    ? hesc(cm.buyer)    : `<span class="vmx-def">${def.ev}</span>`;
      const ap=cm.approver ? hesc(cm.approver) : `<span class="vmx-def">${def.ap}</span>`;
      const st=(cm.status||'').trim();
      let stMark;
      if (isNAStatus(st)) {
        // The Excel REMARKS column is where evaluators actually write why a
        // line is NA — show that instead of a generic label whenever it's
        // there, so "why" isn't a mystery you'd have to open the workbook for.
        const naReason=(cm.remarks||'').trim()||'Not applicable this half';
        stMark = `<span class="vmx-na" data-tt="${hesc(naReason)}">NA</span>`;
      } else if (st) {
        stMark = `<span class="vmx-st" data-tt="${hesc(st)}">●</span>`;
      } else {
        // A blank STATUS covers two very different states — nobody has rated this
        // category yet, or the evaluator has finished and it's just sitting with the
        // approver — so the badge needs to say which, not just "Pending".
        const cat=LNT_MATRIX.find(c=>c.id===rc.id);
        const evalStarted = cat && cat.params.some((_,pi)=>{const v=bagForRow[`${rc.id}_${pi}`];return v!=null&&v!=='';});
        const label = evalStarted ? 'Pending Approval' : 'Pending Rating';
        const tip   = evalStarted ? 'Rated, awaiting approver sign-off' : 'Not yet rated by the evaluator';
        stMark = `<span class="vmx-na" style="background:var(--s2);color:var(--t3);" data-tt="${hesc(tip)}">${label}</span>`;
      }
      return `<td class="vmx-ev">${ev}${stMark}</td><td class="vmx-ap">${ap}</td>`;
    }).join('');
    const bag=itemRatings[key];
    let rateCell;
    if(hasSavedRatingValues(bag)){
      const catScoresFiltered=REPORT_CATS.map(rc=>{
        if(!categoryScoreEligible(meta, rc.id)) return null;   // NA, or still Pending approval
        return calcCategoryScore(rc.id,bag);
      });
      const sc=calcWeightedVendorScoreFromCategories(catScoresFiltered);
      const t=tierForScore(sc);
      rateCell=`<td><button onclick="gotoRatingItem('${esc(key)}')" title="Open full rating editor for this PO" style="cursor:pointer;border:1px solid ${t.c}66;background:${t.c}1a;color:${t.c};font-family:var(--hd);font-weight:600;font-size:11px;line-height:1;padding:4px 8px;border-radius:2px;white-space:nowrap;">${sc.toFixed(1)}%</button></td>`;
    }else{
      rateCell=`<td><button onclick="gotoRatingItem('${esc(key)}')" title="Not rated yet — open the scorecard to rate this PO" style="cursor:pointer;border:1px dashed var(--brd2,#a3aab1);background:none;color:var(--t3);font-size:10px;line-height:1;padding:4px 8px;border-radius:2px;white-space:nowrap;">Rate &rarr;</button></td>`;
    }

    return `<tr>
      <td class="vmx-cat">PO</td>
      <td class="vmx-proj" title="${hesc(proj)}"><strong>${hesc(proj)}</strong>${i.poNum?`<div class="vmx-pono">${hescCode(i.poNum)}</div>`:''}</td>
      ${catCells}
      ${rateCell}
    </tr>`;
  }).join('')||`<tr><td colspan="11" style="text-align:center;color:var(--t3);padding:24px">No purchase orders for this vendor.</td></tr>`;

  // ---- Vendor-level category & parameter ratings (active half-year) ----
  // For each category: aggregate % = average of this vendor's rated POs' category scores.
  // For each parameter: average star (1–5) across the POs where that parameter was rated.
  // Both are scoped to POs whose category is score-eligible (STATUS recorded, not NA,
  // not still Pending) — an evaluator's number for a Pending category is real data for
  // Rating Completeness, but not yet a finished figure this vendor should be judged by.
  const CAT_SHORT={scm:'SCM',edrc:'EDRC',quality:'Quality',operation:'Operation'};
  const ratedCount=items.filter(i=>hasSavedRatingValues(itemRatings[stableKey(i)])).length;
  const catAgg=LNT_MATRIX.map(cat=>{
    const paramStats=cat.params.map((label,pi)=>{
      let sum=0,n=0;
      items.forEach(i=>{
        const ik=stableKey(i);
        if(!categoryScoreEligible(categoryMeta[ik]||{}, cat.id)) return;
        const bag=itemRatings[ik];
        const v=bag&&bag[`${cat.id}_${pi}`];
        if(v!=null&&v!==''){ sum+=Number(v); n++; }
      });
      return {label,avg:n?sum/n:null,n};
    });
    let cSum=0,cN=0;
    items.forEach(i=>{
      const ik=stableKey(i);
      if(!categoryScoreEligible(categoryMeta[ik]||{}, cat.id)) return;
      const bag=itemRatings[ik];
      if(!bag) return;
      const has=cat.params.some((_,pi)=>{const v=bag[`${cat.id}_${pi}`];return v!=null&&v!=='';});
      if(has){ cSum+=calcCategoryScore(cat.id,bag); cN++; }
    });
    return {id:cat.id,short:CAT_SHORT[cat.id]||cat.id,w:cat.w,score:cN?cSum/cN:null,ratedPOs:cN,paramStats};
  });
  const catCards=catAgg.map(c=>{
    const t=c.score!=null?tierForScore(c.score):null; const col=t?t.c:'#8b9199';
    const rated=c.paramStats.filter(p=>p.avg!=null).length;
    const params=c.paramStats.map(p=>`
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px dashed var(--brd);">
        <span style="font-size:10.5px;color:var(--t2);line-height:1.35;">${hesc(p.label)}</span>
        <span style="white-space:nowrap;font-family:var(--mono);font-size:10.5px;font-weight:600;color:${p.avg!=null?col:'var(--t4)'};" title="${p.n} rated PO(s)">${p.avg!=null?p.avg.toFixed(1)+' ★':'—'}</span>
      </div>`).join('');
    return `<div style="border:1px solid ${col}44;border-radius:2px;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:10px 12px;background:${c.score!=null?col+'14':'var(--s2)'};display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div><div style="font-family:var(--hd);font-weight:700;font-size:13px;color:var(--navy);">${c.short}</div>
        <div style="font-size:9.5px;color:var(--t3);font-family:var(--mono);">weight ${c.w}% · ${c.ratedPOs} PO(s)</div></div>
        <div style="font-family:var(--hd);font-weight:700;font-size:20px;color:${col};white-space:nowrap;">${c.score!=null?c.score.toFixed(1)+'%':'—'}</div>
      </div>
      <details style="padding:0 12px 8px;">
        <summary style="cursor:pointer;font-size:10px;color:var(--acc);font-family:var(--hd);font-weight:600;text-transform:uppercase;letter-spacing:.4px;padding:6px 0;">Parameters (${rated}/${c.paramStats.length})</summary>
        ${params}
      </details>
    </div>`;
  }).join('');
  const catPanel = ratedCount===0
    ? `<div class="pn" style="margin-bottom:16px;padding:14px 16px;"><div style="font-size:12px;color:var(--t3);">No ratings recorded for this vendor in <strong>${scopeLabel()}</strong> yet. Open the <strong>Vendor Scorecard</strong> to rate a PO.</div></div>`
    : `<div class="pn" style="margin-bottom:16px;padding:16px;">
        <div class="phd"><h3 class="pt">Category Ratings — how each team rated this vendor</h3><div class="chps"><span class="ch ch-a">${scopeLabel()}</span><span class="ch ch-b">${ratedCount} rated PO(s)</span></div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:12px;margin-top:12px;">${catCards}</div>
        <div style="margin-top:10px;font-size:10px;color:var(--t3);font-family:var(--mono);">Category % = average of this vendor's rated POs for ${scopeLabel()}. ★ = average star (out of 5) per parameter. Expand a card for the parameter-level detail.</div>
      </div>`;

  const vParamAgg=[];
  LNT_MATRIX.forEach(c=>c.params.forEach((label,pi)=>{
    let sum=0,n=0;
    items.forEach(i=>{
      const ik=stableKey(i);
      if(!categoryScoreEligible(categoryMeta[ik]||{}, c.id)) return;
      const bag=itemRatings[ik];const v=bag&&bag[`${c.id}_${pi}`];if(v!=null&&v!==''){sum+=Number(v);n++;}
    });
    if(n) vParamAgg.push({cat:TEAM_LABEL[c.id],label,avg:sum/n,n});
  }));
  const vStrongest=bestPerTeam(vParamAgg,true);
  const vWeakest=bestPerTeam(vParamAgg,false);
  const vSwBar=(p,good)=>{const w=(p.avg/5*100),col=good?'#3f6d2c':'#a82f1c';
    return `<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;margin-bottom:3px;"><span style="color:var(--t2);line-height:1.3;">${hesc(p.label)}</span><span style="font-family:var(--mono);font-weight:600;color:${col};white-space:nowrap;">${p.avg.toFixed(1)} ★</span></div><div style="height:6px;background:var(--s4);border:1px solid var(--brd);overflow:hidden;"><div style="height:100%;width:${w}%;background:${col};"></div></div><div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">${hesc(p.cat)} · ${p.n} rating(s)</div></div>`;};

  const strengthsWeaknessesPanel = vParamAgg.length ? `
    <div class="g2" style="margin-bottom:16px;">
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--grn)">💪 Top Strengths</h3><span class="ch ch-b">avg ★ / 5</span></div><div class="pb">${vStrongest.map(p=>vSwBar(p,true)).join('')||'<div class="empty">No data</div>'}</div></div>
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--red)">⚠ Weakest Parameters</h3><span class="ch ch-b">avg ★ / 5</span></div><div class="pb">${vWeakest.map(p=>vSwBar(p,false)).join('')||'<div class="empty">No data</div>'}</div></div>
    </div>
  ` : '';

  setM(`
    <style>
      .vmx{border-collapse:collapse;width:100%;font-size:11.5px;}
      .vmx th,.vmx td{border:1px solid var(--brd2,#cfd4d9);padding:6px 9px;text-align:left;vertical-align:middle;}
      .vmx thead th{background:var(--s2,#eef0f2);font-family:var(--hd);font-weight:600;text-transform:uppercase;letter-spacing:.4px;font-size:11px;color:var(--navy);text-align:center;white-space:nowrap;}
      .vmx .vmx-grp{background:var(--s3,#e3e6e9);}
      .vmx .vmx-cat{font-family:var(--mono);font-size:10.5px;color:var(--t2);text-align:center;}
      .vmx .vmx-proj{min-width:170px;max-width:300px;word-break:normal;overflow-wrap:break-word;text-wrap:pretty;}
      .vmx .vmx-pono{font-family:var(--mono);font-size:9.5px;color:var(--t3);margin-top:1px;word-break:normal;overflow-wrap:normal;}
      .vmx .vmx-ev,.vmx .vmx-ap{font-size:11px;color:var(--txt);white-space:normal;word-break:normal;overflow-wrap:break-word;text-wrap:pretty;min-width:78px;}
      .vmx .vmx-def{color:var(--t3);}
      .vmx .vmx-st{color:var(--acc);font-size:9px;margin-left:4px;vertical-align:middle;}
      .vmx .vmx-na{display:inline-block;margin-left:5px;font-family:var(--hd);font-weight:700;font-size:9px;letter-spacing:.3px;color:#8a6d1a;background:#f7e6b8;border:1px solid #d8b64a;padding:1px 5px;border-radius:2px;vertical-align:middle;line-height:1.4;white-space:nowrap;word-break:normal;overflow-wrap:normal;}
      .vmx .vmx-na[data-tt], .vmx .vmx-st[data-tt] { position: relative; cursor: help; }
      .vmx .vmx-na[data-tt]:hover::after, .vmx .vmx-st[data-tt]:hover::after {
        content: attr(data-tt); position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%);
        background: #191c1f; color: #fff; padding: 5px 9px; font-size: 11px; font-family: var(--fn); 
        font-weight: 500; white-space: nowrap; border-radius: 4px; z-index: 100; pointer-events: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); letter-spacing: 0; text-transform: none;
      }
      .vmx tbody tr:hover td{background:var(--acc-lt,rgba(191,69,23,.06));}
      .vmx-vbar{display:flex;align-items:stretch;border:1px solid var(--brd2,#cfd4d9);border-bottom:none;font-size:12px;}
      .vmx-vbar .lbl{padding:8px 12px;background:var(--s2,#eef0f2);font-family:var(--hd);font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--t2);border-right:1px solid var(--brd2,#cfd4d9);min-width:90px;}
      .vmx-vbar .val{padding:8px 14px;font-family:var(--mono);font-weight:600;color:var(--navy);}
    </style>
    <div class="shd">
      <h2 class="stitle">Vendor Dashboard</h2>
      <div class="chps"><span class="ch ch-a">${scopeLabel()}</span><span class="ch ch-b">${items.length} PO(s)</span><span class="ch">${sheets} sheet(s)</span></div>
    </div>
    <div style="margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <button onclick="goBack('vendors')" style="cursor:pointer;background:none;border:1px solid var(--brd2,#a3aab1);color:var(--t2);font-family:var(--hd);font-weight:500;font-size:12px;padding:7px 14px;border-radius:2px;display:inline-flex;align-items:center;gap:6px;">&larr; All Vendors</button>
      <button onclick="emailVendor('${esc(code)}')" title="${vemail?('Email '+hesc(vemail)):'No email in data — opens Outlook with a blank recipient'}" style="cursor:pointer;background:var(--acc,#0072bc);border:1px solid var(--acc,#0072bc);color:#fff;font-family:var(--hd);font-weight:600;font-size:12px;padding:7px 14px;border-radius:2px;display:inline-flex;align-items:center;gap:7px;">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
        Email Vendor
      </button>
      <button onclick="openVendorDetail('${esc(code)}')" title="Factory location, address and both contact levels from the Vendor Master" style="cursor:pointer;background:none;border:1px solid var(--brd2,#a3aab1);color:var(--t2);font-family:var(--hd);font-weight:500;font-size:12px;padding:7px 14px;border-radius:2px;display:inline-flex;align-items:center;gap:6px;">Contact Details &rarr;</button>
      <span style="font-size:12.5px;color:var(--t2);font-family:var(--mono);">Evaluator &amp; Approver responsibility per category · grey = default role</span>
    </div>
    ${catPanel}
    ${strengthsWeaknessesPanel}
    ${groupEntitiesPanel}
    <div class="pn" style="overflow:hidden;padding:16px;">
      <div class="vmx-vbar"><div class="lbl">Vendor</div><div class="val" style="font-family:var(--fn);">${hesc(vname||code)}${code?`&nbsp;&nbsp;<span style="color:var(--t2);font-weight:500;font-family:var(--mono);font-size:11.5px;">${vendorCodeDisplay(code,', ')}</span>`:''}</div>${vemail?`<div class="lbl" style="border-left:1px solid var(--brd2,#cfd4d9);">Email</div><div class="val" style="font-size:11.5px;">${hesc(vemail)}</div>`:''}</div>
      <div class="tw" style="overflow:auto;">
        <table class="vmx">
          <thead>
            <tr>
              <th rowspan="2">Category</th>
              <th rowspan="2">Project</th>
              ${grpHdr}
              <th rowspan="2">Rating</th>
            </tr>
            <tr>
              <th>Evaluator</th><th>Approver</th>
              <th>Evaluator</th><th>Approver</th>
              <th>Evaluator</th><th>Approver</th>
              <th>Evaluator</th><th>Approver</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `);
  document.querySelectorAll('.nav').forEach(e=>e.classList.remove('on'));
  const nv=document.getElementById('nav-vendors'); if(nv) nv.classList.add('on');
  scrollMainToTop();
}

// PROJECT DASHBOARD — full page, mirrors openVendorPage but scoped to one project/item,
// showing the complete rating detail (category + parameter breakdown) instead of a
// PO-Master-style row list. Reached by clicking a project in Top Projects.
function openProjectPage(projectName, fromHistory=false){
  const h = '#project:' + encodeURIComponent(projectName);
  if(!fromHistory && window.location.hash !== h) {
    window.history.pushState(null, '', h);
  }
  initRatings();
  const a=all();
  const items=a.filter(i=>(i.jobDesc||i.jobCode||i.sheet||'')===projectName);
  const vendorCodes=new Set(items.map(i=>i.vendor||'TBD'));
  const sheets=new Set(items.map(i=>i.sheet)).size;

  const grpHdr=REPORT_CATS.map(rc=>{
    const cat=LNT_MATRIX.find(c=>c.id===rc.id)||{w:0};
    const short={scm:'SCM',edrc:'EDRC',quality:'Quality',operation:'Operation'}[rc.id]||rc.id.toUpperCase();
    return `<th colspan="2" class="vmx-grp">${short}-${cat.w}%</th>`;
  }).join('');

  const rows=items.map((i)=>{
    const key=stableKey(i);
    const meta=categoryMeta[key]||{};
    const bagForRow=itemRatings[key]||{};
    const catCells=REPORT_CATS.map(rc=>{
      const cm=meta[rc.id]||{};
      const def=CATEGORY_ROLES[rc.id]||{ev:'—',ap:'—'};
      const ev=cm.buyer    ? hesc(cm.buyer)    : `<span class="vmx-def">${def.ev}</span>`;
      const ap=cm.approver ? hesc(cm.approver) : `<span class="vmx-def">${def.ap}</span>`;
      const st=(cm.status||'').trim();
      let stMark;
      if (isNAStatus(st)) {
        // The Excel REMARKS column is where evaluators actually write why a
        // line is NA — show that instead of a generic label whenever it's
        // there, so "why" isn't a mystery you'd have to open the workbook for.
        const naReason=(cm.remarks||'').trim()||'Not applicable this half';
        stMark = `<span class="vmx-na" data-tt="${hesc(naReason)}">NA</span>`;
      } else if (st) {
        stMark = `<span class="vmx-st" data-tt="${hesc(st)}">●</span>`;
      } else {
        const cat=LNT_MATRIX.find(c=>c.id===rc.id);
        const evalStarted = cat && cat.params.some((_,pi)=>{const v=bagForRow[`${rc.id}_${pi}`];return v!=null&&v!=='';});
        const label = evalStarted ? 'Pending Approval' : 'Pending Rating';
        const tip   = evalStarted ? 'Rated, awaiting approver sign-off' : 'Not yet rated by the evaluator';
        stMark = `<span class="vmx-na" style="background:var(--s2);color:var(--t3);" data-tt="${hesc(tip)}">${label}</span>`;
      }
      return `<td class="vmx-ev">${ev}${stMark}</td><td class="vmx-ap">${ap}</td>`;
    }).join('');
    const bag=itemRatings[key];
    let rateCell;
    if(hasSavedRatingValues(bag)){
      const catScoresFiltered=REPORT_CATS.map(rc=>{
        if(!categoryScoreEligible(meta, rc.id)) return null;   // NA, or still Pending approval
        return calcCategoryScore(rc.id,bag);
      });
      const sc=calcWeightedVendorScoreFromCategories(catScoresFiltered);
      const t=tierForScore(sc);
      rateCell=`<td><button onclick="gotoRatingItem('${esc(key)}')" title="Open full rating editor for this PO" style="cursor:pointer;border:1px solid ${t.c}66;background:${t.c}1a;color:${t.c};font-family:var(--hd);font-weight:600;font-size:11px;line-height:1;padding:4px 8px;border-radius:2px;white-space:nowrap;">${sc.toFixed(1)}%</button></td>`;
    }else{
      rateCell=`<td><button onclick="gotoRatingItem('${esc(key)}')" title="Not rated yet — open the scorecard to rate this PO" style="cursor:pointer;border:1px dashed var(--brd2,#a3aab1);background:none;color:var(--t3);font-size:10px;line-height:1;padding:4px 8px;border-radius:2px;white-space:nowrap;">Rate &rarr;</button></td>`;
    }

    return `<tr>
      <td class="vmx-cat">PO</td>
      <td class="vmx-proj" style="cursor:pointer" onclick="openVendorPage('${esc(i.vendor||'TBD')}')" title="Open ${hesc(i.vendorName||i.vendor||'vendor')}"><strong>${hesc(i.vendorName||i.vendor||'—')}</strong>${i.vendor?`<div class="vmx-pono">${wbrCode(vendorCodeDisplay(i.vendor))}</div>`:''}${i.poNum?`<div class="vmx-pono">${hescCode(i.poNum)}</div>`:''}</td>
      ${catCells}
      ${rateCell}
    </tr>`;
  }).join('')||`<tr><td colspan="11" style="text-align:center;color:var(--t3);padding:24px">No purchase orders for this project.</td></tr>`;

  // ---- Project-level category & parameter ratings (active half-year) ----
  // Same aggregation as the vendor dashboard, just scoped to this project's items instead
  // of one vendor's items — average of the project's rated POs' category scores, only
  // counting categories that are score-eligible (see categoryScoreEligible above).
  const CAT_SHORT={scm:'SCM',edrc:'EDRC',quality:'Quality',operation:'Operation'};
  const ratedCount=items.filter(i=>hasSavedRatingValues(itemRatings[stableKey(i)])).length;
  const catAgg=LNT_MATRIX.map(cat=>{
    const paramStats=cat.params.map((label,pi)=>{
      let sum=0,n=0;
      items.forEach(i=>{
        const ik=stableKey(i);
        if(!categoryScoreEligible(categoryMeta[ik]||{}, cat.id)) return;
        const bag=itemRatings[ik];
        const v=bag&&bag[`${cat.id}_${pi}`];
        if(v!=null&&v!==''){ sum+=Number(v); n++; }
      });
      return {label,avg:n?sum/n:null,n};
    });
    let cSum=0,cN=0;
    items.forEach(i=>{
      const ik=stableKey(i);
      if(!categoryScoreEligible(categoryMeta[ik]||{}, cat.id)) return;
      const bag=itemRatings[ik];
      if(!bag) return;
      const has=cat.params.some((_,pi)=>{const v=bag[`${cat.id}_${pi}`];return v!=null&&v!=='';});
      if(has){ cSum+=calcCategoryScore(cat.id,bag); cN++; }
    });
    return {id:cat.id,short:CAT_SHORT[cat.id]||cat.id,w:cat.w,score:cN?cSum/cN:null,ratedPOs:cN,paramStats};
  });
  const catCards=catAgg.map(c=>{
    const t=c.score!=null?tierForScore(c.score):null; const col=t?t.c:'#8b9199';
    const rated=c.paramStats.filter(p=>p.avg!=null).length;
    const params=c.paramStats.map(p=>`
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px dashed var(--brd);">
        <span style="font-size:10.5px;color:var(--t2);line-height:1.35;">${hesc(p.label)}</span>
        <span style="white-space:nowrap;font-family:var(--mono);font-size:10.5px;font-weight:600;color:${p.avg!=null?col:'var(--t4)'};" title="${p.n} rated PO(s)">${p.avg!=null?p.avg.toFixed(1)+' ★':'—'}</span>
      </div>`).join('');
    return `<div style="border:1px solid ${col}44;border-radius:2px;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:10px 12px;background:${c.score!=null?col+'14':'var(--s2)'};display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div><div style="font-family:var(--hd);font-weight:700;font-size:13px;color:var(--navy);">${c.short}</div>
        <div style="font-size:9.5px;color:var(--t3);font-family:var(--mono);">weight ${c.w}% · ${c.ratedPOs} PO(s)</div></div>
        <div style="font-family:var(--hd);font-weight:700;font-size:20px;color:${col};white-space:nowrap;">${c.score!=null?c.score.toFixed(1)+'%':'—'}</div>
      </div>
      <details style="padding:0 12px 8px;">
        <summary style="cursor:pointer;font-size:10px;color:var(--acc);font-family:var(--hd);font-weight:600;text-transform:uppercase;letter-spacing:.4px;padding:6px 0;">Parameters (${rated}/${c.paramStats.length})</summary>
        ${params}
      </details>
    </div>`;
  }).join('');
  const catPanel = ratedCount===0
    ? `<div class="pn" style="margin-bottom:16px;padding:14px 16px;"><div style="font-size:12px;color:var(--t3);">No ratings recorded for this project in <strong>${scopeLabel()}</strong> yet. Open the <strong>Vendor Scorecard</strong> to rate a PO.</div></div>`
    : `<div class="pn" style="margin-bottom:16px;padding:16px;">
        <div class="phd"><h3 class="pt">Category Ratings — how each team rated this project</h3><div class="chps"><span class="ch ch-a">${scopeLabel()}</span><span class="ch ch-b">${ratedCount} rated PO(s)</span></div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:12px;margin-top:12px;">${catCards}</div>
        <div style="margin-top:10px;font-size:10px;color:var(--t3);font-family:var(--mono);">Category % = average of this project's rated POs for ${scopeLabel()}. ★ = average star (out of 5) per parameter. Expand a card for the parameter-level detail.</div>
      </div>`;

  const pParamAgg=[];
  LNT_MATRIX.forEach(c=>c.params.forEach((label,pi)=>{
    let sum=0,n=0;
    items.forEach(i=>{
      const ik=stableKey(i);
      if(!categoryScoreEligible(categoryMeta[ik]||{}, c.id)) return;
      const bag=itemRatings[ik];const v=bag&&bag[`${c.id}_${pi}`];if(v!=null&&v!==''){sum+=Number(v);n++;}
    });
    if(n) pParamAgg.push({cat:TEAM_LABEL[c.id],label,avg:sum/n,n});
  }));
  const pStrongest=bestPerTeam(pParamAgg,true);
  const pWeakest=bestPerTeam(pParamAgg,false);
  const pSwBar=(p,good)=>{const w=(p.avg/5*100),col=good?'#3f6d2c':'#a82f1c';
    return `<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;margin-bottom:3px;"><span style="color:var(--t2);line-height:1.3;">${hesc(p.label)}</span><span style="font-family:var(--mono);font-weight:600;color:${col};white-space:nowrap;">${p.avg.toFixed(1)} ★</span></div><div style="height:6px;background:var(--s4);border:1px solid var(--brd);overflow:hidden;"><div style="height:100%;width:${w}%;background:${col};"></div></div><div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">${hesc(p.cat)} · ${p.n} rating(s)</div></div>`;};

  const strengthsWeaknessesPanel = pParamAgg.length ? `
    <div class="g2" style="margin-bottom:16px;">
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--grn)">💪 Top Strengths</h3><span class="ch ch-b">avg ★ / 5</span></div><div class="pb">${pStrongest.map(p=>pSwBar(p,true)).join('')||'<div class="empty">No data</div>'}</div></div>
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--red)">⚠ Weakest Parameters</h3><span class="ch ch-b">avg ★ / 5</span></div><div class="pb">${pWeakest.map(p=>pSwBar(p,false)).join('')||'<div class="empty">No data</div>'}</div></div>
    </div>
  ` : '';

  setM(`
    <style>
      .vmx{border-collapse:collapse;width:100%;font-size:11.5px;}
      .vmx th,.vmx td{border:1px solid var(--brd2,#cfd4d9);padding:6px 9px;text-align:left;vertical-align:middle;}
      .vmx thead th{background:var(--s2,#eef0f2);font-family:var(--hd);font-weight:600;text-transform:uppercase;letter-spacing:.4px;font-size:11px;color:var(--navy);text-align:center;white-space:nowrap;}
      .vmx .vmx-grp{background:var(--s3,#e3e6e9);}
      .vmx .vmx-cat{font-family:var(--mono);font-size:10.5px;color:var(--t2);text-align:center;}
      .vmx .vmx-proj{min-width:170px;max-width:300px;word-break:normal;overflow-wrap:break-word;text-wrap:pretty;}
      .vmx .vmx-pono{font-family:var(--mono);font-size:9.5px;color:var(--t3);margin-top:1px;word-break:normal;overflow-wrap:normal;}
      .vmx .vmx-ev,.vmx .vmx-ap{font-size:11px;color:var(--txt);white-space:normal;word-break:normal;overflow-wrap:break-word;text-wrap:pretty;min-width:78px;}
      .vmx .vmx-def{color:var(--t3);}
      .vmx .vmx-st{color:var(--acc);font-size:9px;margin-left:4px;vertical-align:middle;}
      .vmx .vmx-na{display:inline-block;margin-left:5px;font-family:var(--hd);font-weight:700;font-size:9px;letter-spacing:.3px;color:#8a6d1a;background:#f7e6b8;border:1px solid #d8b64a;padding:1px 5px;border-radius:2px;vertical-align:middle;line-height:1.4;white-space:nowrap;word-break:normal;overflow-wrap:normal;}
      .vmx .vmx-na[data-tt], .vmx .vmx-st[data-tt] { position: relative; cursor: help; }
      .vmx .vmx-na[data-tt]:hover::after, .vmx .vmx-st[data-tt]:hover::after {
        content: attr(data-tt); position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%);
        background: #191c1f; color: #fff; padding: 5px 9px; font-size: 11px; font-family: var(--fn); 
        font-weight: 500; white-space: nowrap; border-radius: 4px; z-index: 100; pointer-events: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); letter-spacing: 0; text-transform: none;
      }
      .vmx tbody tr:hover td{background:var(--acc-lt,rgba(191,69,23,.06));}
      .vmx-vbar{display:flex;align-items:stretch;border:1px solid var(--brd2,#cfd4d9);border-bottom:none;font-size:12px;}
      .vmx-vbar .lbl{padding:8px 12px;background:var(--s2,#eef0f2);font-family:var(--hd);font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--t2);border-right:1px solid var(--brd2,#cfd4d9);min-width:90px;}
      .vmx-vbar .val{padding:8px 14px;font-family:var(--mono);font-weight:600;color:var(--navy);}
    </style>
    <div class="shd">
      <h2 class="stitle">Project Dashboard</h2>
      <div class="chps"><span class="ch ch-a">${scopeLabel()}</span><span class="ch ch-b">${items.length} PO(s)</span><span class="ch">${vendorCodes.size} vendor(s)</span><span class="ch">${sheets} sheet(s)</span></div>
    </div>
    <div style="margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <button onclick="goBack('overview')" style="cursor:pointer;background:none;border:1px solid var(--brd2,#a3aab1);color:var(--t2);font-family:var(--hd);font-weight:500;font-size:12px;padding:7px 14px;border-radius:2px;display:inline-flex;align-items:center;gap:6px;">&larr; Portfolio Overview</button>
      <span style="font-size:12.5px;color:var(--t2);font-family:var(--mono);">Evaluator &amp; Approver responsibility per category · grey = default role · click a vendor to open its dashboard</span>
    </div>
    ${catPanel}
    ${strengthsWeaknessesPanel}
    <div class="pn" style="overflow:hidden;padding:16px;">
      <div class="vmx-vbar"><div class="lbl">Project</div><div class="val" style="font-family:var(--fn);">${hesc(projectName)}</div></div>
      <div class="tw" style="overflow:auto;">
        <table class="vmx">
          <thead>
            <tr>
              <th rowspan="2">Category</th>
              <th rowspan="2">Vendor</th>
              ${grpHdr}
              <th rowspan="2">Rating</th>
            </tr>
            <tr>
              <th>Evaluator</th><th>Approver</th>
              <th>Evaluator</th><th>Approver</th>
              <th>Evaluator</th><th>Approver</th>
              <th>Evaluator</th><th>Approver</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `);
  document.querySelectorAll('.nav').forEach(e=>e.classList.remove('on'));
  const ov=document.getElementById('nav-overview'); if(ov) ov.classList.add('on');
  scrollMainToTop();
}

// Compose an Outlook mail (via mailto:) prefilled with the vendor's half-yearly rating
// summary — BOTH H1 and H2 of the current financial year, with per-PO category detail.
// Recipient/CC come from the Vendor Master (or an email column in the data).
// Body layout follows the Acme Renewables vendor-rating letter format:
// intro -> Vendor Information -> Overall Performance Summary -> PO Reference ->
// Performance by PO -> Performance Feedback -> Areas for Continuous Improvement.
function emailVendor(code){
  initRatings();
  const a=all();
  const items=a.filter(i=>(i.vendor||'TBD')===code);
  const nm=items.find(i=>i.vendorName&&i.vendorName.length>1);
  const vname=nm?nm.vendorName:'';
  const em=(items.map(i=>i.vendorEmail).find(e=>e&&e.includes('@')))||vendorEmailFor(code,vname);
  const cc=vendorCcFor(code,vname);

  const HALVES=['H1','H2'];
  const fyq=getIndianFYQuarter(new Date());
  const fyLabel=`FY ${fyq.fy}\u2013${String((fyq.fy+1)%100).padStart(2,'0')}`;

  // Gather per-PO, per-half detail (overall + 4 category scores) and vendor-level half averages.
  // Active half comes from in-memory itemRatings; the other half is read back from appStorage.
  const halfSum={H1:{sum:0,n:0},H2:{sum:0,n:0}};
  const poData=items.map(i=>{
    const key=stableKey(i);
    const halves={};
    HALVES.forEach(q=>{
      const ratings=(q===activeQuarter)?(itemRatings[key]||{}):getQuarterRatingsForItem(key,q);
      if(!hasSavedRatingValues(ratings)){ halves[q]=null; return; }
      const meta=(q===activeQuarter)?(categoryMeta[key]||{}):getQuarterMetaForItem(key,q);
      // Only categories that are actually score-eligible (STATUS recorded, not NA, not
      // still Pending) go into this vendor-facing letter — an unapproved number has no
      // business appearing in a formal performance rating sent to the vendor.
      const cats=REPORT_CATS.filter(rc=>categoryScoreEligible(meta, rc.id)).map(rc=>({id:rc.id,score:calcCategoryScore(rc.id,ratings)}));
      if(!cats.length){ halves[q]=null; return; }
      const overall=calcWeightedVendorScoreFromCategories(cats.map(c=>c.score));
      halves[q]={overall,tier:tierForScore(overall).label,cats};
      halfSum[q].sum+=overall; halfSum[q].n++;
    });
    return {po:i.poNum||i.item||'PO', proj:String(i.jobDesc||i.item||'').trim(), halves};
  }).filter(p=>p.halves.H1||p.halves.H2);

  // Which half(s) actually have ratings — drives the subject line and the period text.
  const periodsPresent=HALVES.filter(q=>halfSum[q].n>0);
  const periodLabel=periodsPresent.length?periodsPresent.join(' & '):'H1 & H2';

  const subject=`Vendor Performance Rating | ${fyLabel} (${periodLabel}) | ${vname||code}`;

  // Fixed-width monospaced text table - reads as a grid in a plain-text email.
  const textTable=(headers,rows,aligns)=>{
    const w=headers.map((h,i)=>Math.max(String(h).length,...rows.map(r=>String(r[i]??'').length)));
    const cell=(v,i)=>{ v=String(v??''); const p=w[i]-v.length; return (aligns&&aligns[i]==='r')?(' '.repeat(p)+v):(v+' '.repeat(p)); };
    const line=r=>r.map((v,i)=>cell(v,i)).join(' | ');
    const rule=w.map(x=>'-'.repeat(x)).join('-+-');
    return [line(headers),rule,...rows.map(line)].join('\n');
  };

  // Shorten a PO number for the narrow per-PO table, e.g.
  // "LE/LE00X000/POD/00/000000" -> "LE00X000...000"
  const shortPO=po=>{
    const s=String(po||'');
    const parts=s.split('/');
    if(parts.length>=2) return `${parts[1]}...${parts[parts.length-1].slice(-3)}`;
    return s.length>14?`${s.slice(0,8)}...${s.slice(-3)}`:s;
  };

  // ---- Vendor Information ----
  const vendorInfoTable=textTable(['Particular','Details'],[
    ['Vendor Name', vname||code],
    ['Vendor Code', code],
    ['Evaluation Period', `${fyLabel} (${periodLabel})`],
    ['Purchase Orders Evaluated', String(poData.length)],
  ],null);

  // ---- Overall Performance Summary (vendor-level, avg across rated POs) ----
  const halfPct=q=>{ const s=halfSum[q]; return s.n?`${(s.sum/s.n).toFixed(1)}%`:'Not Rated'; };
  const summaryTable=textTable(['Period','Overall Score'],[['H1',halfPct('H1')],['H2',halfPct('H2')]],[null,'r']);

  // ---- Purchase Order Reference (full PO number + full project name) ----
  const poRefTable=poData.length
    ? textTable(['PO Number','Project'],poData.map(p=>[p.po,p.proj||'-']),null)
    : '(No POs rated yet.)';

  // ---- Performance by Purchase Order (whole-number % per category) ----
  const catPct=(h,id)=>{ if(!h) return '-'; const c=h.cats.find(x=>x.id===id); return (c&&c.score!=null)?`${Math.round(c.score)}%`:'-'; };
  const fullRows=[]; poData.forEach(p=>HALVES.forEach(q=>{ const h=p.halves[q]; if(!h) return;
    fullRows.push([shortPO(p.po),q,`${Math.round(h.overall)}%`,catPct(h,'scm'),catPct(h,'edrc'),catPct(h,'quality'),catPct(h,'operation')]);
  }));
  const fullTable=()=>textTable(['PO Number','Half','Overall','SCM','EDRC','Quality','Operations'],fullRows,[null,null,'r','r','r','r','r']);
  const compactRows=fullRows.map(r=>[r[0],r[1],r[2]]);
  const compactTable=()=>textTable(['PO Number','Half','Overall'],compactRows,[null,null,'r']);

  // ---- Tier-based Performance Feedback & Areas for Continuous Improvement ----
  // Driven off the average score across whichever half(s) are rated.
  const ratedHalves=periodsPresent.map(q=>halfSum[q].sum/halfSum[q].n);
  const overallAvg=ratedHalves.length?ratedHalves.reduce((s,v)=>s+v,0)/ratedHalves.length:null;
  const tier=overallAvg!=null?tierForScore(overallAvg):null;
  const tierKey=tier?tier.label:'NONE';

  const FEEDBACK={
    PLATINUM:`The evaluation reflects an exceptional level of performance across the assessed functional domains. Your organization's consistent commitment to quality, delivery reliability, technical competence, and collaborative engagement has significantly contributed to the successful execution of our projects.\n\nAcme Construction \u2013 Renewables values your continued partnership and looks forward to strengthening our long-term business relationship.`,
    GOLD:`The evaluation reflects a strong and consistent level of performance across the assessed functional domains. Your organization has demonstrated good delivery reliability, technical competence, and collaborative engagement, contributing positively to project execution.\n\nAcme Construction \u2013 Renewables appreciates your partnership and looks forward to working towards even higher performance levels together.`,
    SILVER:`The evaluation reflects a satisfactory level of performance overall, with certain functional domains meeting expectations and others presenting scope for improvement. We encourage a focused effort to strengthen consistency across quality, delivery, and coordination.\n\nAcme Construction \u2013 Renewables values the partnership and looks forward to seeing improved performance in the coming period.`,
    BRONZE:`The evaluation reflects a below-expectation level of performance across several assessed functional domains. Recurring gaps in delivery reliability, quality, or coordination were observed and require prompt corrective action.\n\nAcme Construction \u2013 Renewables requests your organization to prioritize the improvement areas below to sustain the business partnership.`,
    NONE:`Performance data for the evaluated purchase order(s) is not yet sufficient to generate a rating for this period. This section will be updated once ratings are recorded.`,
  };
  const IMPROVEMENTS={
    PLATINUM:['Continue driving value engineering and innovation initiatives.','Sustain delivery and quality excellence across projects.','Further strengthen digital collaboration and process efficiency.'],
    GOLD:['Tighten delivery schedule adherence to close the gap to top-tier performance.','Continue strengthening quality control and documentation practices.','Deepen digital collaboration and proactive status reporting.'],
    SILVER:['Improve on-time delivery performance and proactive schedule communication.','Strengthen quality control processes to reduce non-conformances.','Enhance responsiveness on EDRC/coordination items.'],
    BRONZE:['Implement a corrective action plan for delivery and quality gaps.','Improve responsiveness and coordination on open action items.','Provide a clear improvement roadmap with defined timelines.'],
    NONE:['Complete pending ratings to enable a meaningful improvement plan.'],
  };

  const head=
    `Dear ${vname||code} Team,\n\n`+
    `Greetings from Acme Construction \u2013 Renewables.\n\n`+
    `As part of our Vendor Performance Evaluation Framework, we are pleased to share your Vendor Performance Rating for ${fyLabel} (${periodLabel}). This assessment recognizes supplier performance, identifies opportunities for continuous improvement, and strengthens our long-term business partnership.\n`;
  const foot=`\nRegards,\nAcme Construction \u2013 Renewables\nProcurement\n`;
  const vendorInfoSection=`\nVENDOR INFORMATION\n${vendorInfoTable}\n`;
  const summarySection=`\nOVERALL PERFORMANCE SUMMARY\n${summaryTable}\n`;
  const poRefSection=`\nPURCHASE ORDER REFERENCE\n${poRefTable}\n`;
  const poPerfHdr=`\nPERFORMANCE BY PURCHASE ORDER\n`;
  const feedbackSection=`\nPERFORMANCE FEEDBACK\n${FEEDBACK[tierKey]}\n`;
  const improvementSection=`\nAREAS FOR CONTINUOUS IMPROVEMENT\n${IMPROVEMENTS[tierKey].map(x=>`- ${x}`).join('\n')}\n`;

  // ---- Merged fallback table (PO + Project + Half + Overall in one row) ----
  // Used when the two-table layout gets long. Keeps every PO row and the project
  // name (truncated, never removed) so the vendor — who has no dashboard access —
  // still gets the full PO list either way.
  const mergedRows=(projLen)=>poData.flatMap(p=>HALVES.map(q=>{ const h=p.halves[q]; if(!h) return null;
    return [shortPO(p.po), tr(p.proj||'-',projLen), q, `${Math.round(h.overall)}%`];
  }).filter(Boolean));
  const mergedTable=projLen=>textTable(['PO Number','Project','Half','Overall'],mergedRows(projLen),[null,null,null,'r']);

  const ccParam=cc?`cc=${encodeURIComponent(cc)}&`:'';
  const buildUrl=body=>`mailto:${encodeURIComponent(em)}?${ccParam}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const withTwoTables=table=>head+vendorInfoSection+summarySection+poRefSection+poPerfHdr+table()+'\n'+feedbackSection+improvementSection+foot;
  const withMergedTable=projLen=>head+vendorInfoSection+summarySection+`\nPERFORMANCE BY PURCHASE ORDER\n`+mergedTable(projLen)+'\n'+feedbackSection+improvementSection+foot;

  // Richest to leanest layout, but every layout always includes EVERY PO row — the
  // vendor has no dashboard to "see more" on, so rows are never dropped, only the
  // amount of per-category / project-name detail shrinks as needed to fit the
  // mailto length that modern Outlook/Gmail clients reliably accept.
  const MAILTO_LIMIT=3800;
  let body,url,fit=false;
  const layouts=poData.length
    ? [()=>withTwoTables(fullTable), ()=>withTwoTables(compactTable), ()=>withMergedTable(45), ()=>withMergedTable(25)]
    : [()=>head+vendorInfoSection+summarySection+`\n(No POs rated yet.)\n`+feedbackSection+improvementSection+foot];
  for(const build of layouts){
    body=build();
    url=buildUrl(body);
    if(url.length<=MAILTO_LIMIT || !poData.length){ fit=true; break; }
  }
  // Even the leanest layout is long (a lot of rated POs) — send it anyway rather
  // than cut any vendor's PO off the list; just flag it so the sender knows why.
  const tooLong=!fit && poData.length;

  window.location.href=url;
  if(tooLong){
    toast('Email is long ('+poData.length+' POs) — some mail clients may clip the body. Please verify before sending.','err');
  } else {
    toast(em?('Opening Outlook for '+em+' ✓'):'Opening Outlook — no email in data, add a recipient', em?'ok':'err');
  }
}


// DETAIL DRILL-DOWN MODAL (Team owner / Vendor click → all items)

let _detailItems=[];
function openDetail(type,key,cat){
  const a=all();
  let items,title,badge;
  if(type==='catbuyer'){
    // cat empty = All Teams: match the evaluator in any category, mirroring rTeam's idsOf.
    const cbi=buildCatBuyerIndex(), cats=cat?[cat]:CAT_IDS;
    items=a.filter(i=>{ const m=cbi[String(i.poNum||'').trim()]||{}; return cats.some(c=>String(m[c]||'').trim()===key); });
    title=key;badge=(cat?TEAM_LABEL[cat]+' ':'')+'Evaluator';
  }else if(type==='owner'){
    items=a.filter(i=>(i.acc||'')===key);
    title=key;badge='Owner';
  }else if(type==='project'){
    items=a.filter(i=>(i.item||i.sheet||'')===key);
    title=key;badge='Project';
  }else{
    items=a.filter(i=>(i.vendor||'TBD')===key);
    const nm=items.find(i=>i.vendorName&&i.vendorName.length>1);
    title=(nm?nm.vendorName+' — ':'')+key;badge='Vendor';
  }
  _detailItems=items;
  const sheets=new Set(items.map(i=>i.sheet)).size;
  document.getElementById('detail-modal-title').textContent=title;
  // Grouped by the rating sheet's Evaluator; PO Owner comes from PO Master and can name
  // someone else, so say so rather than let the two columns look like a contradiction.
  const note = type==='catbuyer' ? ' · grouped by Evaluator — PO Owner may differ' : '';
  document.getElementById('detail-modal-sub').textContent=`${badge} · ${items.length} item(s) · ${sheets} sheet(s)${note}`;
  const si=document.getElementById('detail-modal-search');si.value='';
  renderDetailRows('');
  document.getElementById('detail-modal').style.display='flex';
  setTimeout(()=>si.focus(),50);
}
function renderDetailRows(q){
  q=(q||'').toLowerCase();
  if(!itemRatings||!Object.keys(itemRatings).length){ try{initRatings();}catch(e){} }
  const risks=getRisk();
  const filtered=_detailItems.filter(i=>!q||(`${i.item} ${i.sheet} ${i.vendor} ${i.vendorName} ${i.acc} ${i.remarks} ${i.poNum}`).toLowerCase().includes(q));
  const rows=filtered.map(i=>{
    const r=riskFor(i.item,i.sheetId);
    return `<tr>
      <td title="${hesc(i.item)}"><strong>${hesc(i.item)}</strong></td>
      <td style="font-family:var(--mono);font-size:10.5px">${hesc(i.vendor||'—')}${i.vendorName&&i.vendorName.length>1?`<div style="color:var(--t3);font-size:9.5px;font-family:var(--fn)" title="${hesc(i.vendorName)}">${hesc(i.vendorName)}</div>`:''}</td>
      <td style="color:var(--acc2)">${hesc(i.acc||'—')}</td>
      <td>${pill(poSt(i))}</td>
      <td style="font-family:var(--mono);font-size:10px">${hesc(i.poNum||'—')}</td>
      <td style="font-family:var(--mono);font-size:10px;white-space:nowrap">${i.poVal?`${i.currency?hesc(i.currency)+' ':''}${hesc(i.poVal)}`:'—'}</td>
      ${itemRatingCell(i)}
      <td>${i.mfcStatus?pill(mfcSt(i)):'<span style="color:var(--t3)">—</span>'}</td>
      <td style="font-size:10px;color:var(--t2)" title="${hesc(i.payTerms)}">${hesc(i.payTerms||'—')}</td>
      <td>${r?`<span class="rbdg ${r.level}" style="font-size:9px">${r.level.toUpperCase()}</span>`:'—'}</td>
      <td style="font-size:10px;color:var(--t2)" title="${hesc(i.remarks)}">${hesc(i.remarks||'—')}</td>
    </tr>`;
  }).join('')||`<tr><td colspan="11" style="text-align:center;color:var(--t3);padding:24px">No matching items</td></tr>`;
  document.getElementById('detail-modal-body').innerHTML=rows;
  document.getElementById('detail-modal-count').textContent=`${filtered.length} shown`;
}
function closeDetail(){document.getElementById('detail-modal').style.display='none';_detailItems=[]}

// Per-PO rating, shown inside the Vendor Focus detail table
// Each row is a PO/line-item; its rating is stored per stableKey(po|ven|item).
function tierForScore(s){
  if(s>=90) return {label:'PLATINUM', c:'#5b4fcf'};
  if(s>=75) return {label:'GOLD',     c:'#b58a1b'};
  if(s>=60) return {label:'SILVER',   c:'#5f6b75'};
  if(s>=50) return {label:'BRONZE',   c:'#a0592c'};
  // Below Bronze still needs a real tier — returning null here was the root cause of
  // the Rating button silently failing (and, in a few other call sites that don't
  // guard for null, an outright crash) whenever a PO's weighted score fell under 50%.
  return {label:'HIGH RISK', c:'#a82f1c'};
}
function itemRatingCell(i){
  const key=stableKey(i);
  const bag=itemRatings[key];
  if(hasSavedRatingValues(bag)){
    // Exclude NA and still-Pending categories from the score so the button matches the
    // full rating editor (and doesn't count a category before its approver has acted).
    const meta=categoryMeta[key]||{};
    const catScoresFiltered=REPORT_CATS.map(rc=>{
      if(!categoryScoreEligible(meta, rc.id)) return null;
      return calcCategoryScore(rc.id,bag);
    });
    const sc=calcWeightedVendorScoreFromCategories(catScoresFiltered);
    const t=tierForScore(sc);
    return `<td><button onclick="gotoRatingItem('${esc(key)}')" title="Open full rating editor for this PO" style="cursor:pointer;border:1px solid ${t.c}66;background:${t.c}1a;color:${t.c};font-family:var(--hd);font-weight:600;font-size:11px;line-height:1;padding:4px 8px;border-radius:2px;white-space:nowrap;">${sc.toFixed(1)}%</button></td>`;
  }
  return `<td><button onclick="gotoRatingItem('${esc(key)}')" title="Not rated yet — open the scorecard to rate this PO" style="cursor:pointer;border:1px dashed var(--brd2,#a3aab1);background:none;color:var(--t3);font-size:10px;line-height:1;padding:4px 8px;border-radius:2px;white-space:nowrap;">Rate &rarr;</button></td>`;
}
// Pop a compact breakdown (overall + 4 categories, both half-years) for one PO,
// without leaving Vendor Focus. "Open full editor" jumps to the scorecard.
let _ratingBreakdownKey='';
function showItemRatingBreakdown(key){
  _ratingBreakdownKey=key;
  if(!itemRatings||!Object.keys(itemRatings).length){ try{initRatings();}catch(e){} }
  const item=all().find(x=>stableKey(x)===key)||{};
  document.getElementById('itemrate-modal-title').textContent=item.poNum?('PO '+item.poNum):(item.item||'Rating');
  const subBits=[];
  if(item.vendor) subBits.push(item.vendor+(item.vendorName?(' — '+item.vendorName):''));
  if(item.item)   subBits.push(item.item);
  document.getElementById('itemrate-modal-sub').textContent=subBits.join('  ·  ')||'Per-PO rating';

  const cards=['H1','H2'].map(q=>{
    const ratings=(q===activeQuarter)?(itemRatings[key]||{}):getQuarterRatingsForItem(key,q);
    if(!hasSavedRatingValues(ratings)){
      return `<div style="border:1px solid var(--brd);border-radius:2px;padding:12px 14px;opacity:.6;">
        <div style="font-family:var(--hd);font-weight:600;font-size:12px;color:var(--t2);">${q}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:6px;">Not rated</div></div>`;
    }
    // Fetch meta FIRST so NA / still-Pending categories can be excluded from both display
    // and the overall weighted score. Without this, a category marked NA (or simply not
    // yet approved) but with saved parameter values would still contribute its score —
    // causing the modal to show e.g. Quality 76% before Quality has actually been signed
    // off, or a category marked NA still showing a number instead of the NA badge.
    const halfMeta=getQuarterMetaForItem(key,q);
    const catScores=REPORT_CATS.map(rc=>{
      if(!categoryScoreEligible(halfMeta, rc.id)) return null;
      return calcCategoryScore(rc.id,ratings);
    });
    const overall=calcWeightedVendorScoreFromCategories(catScores);
    const t=tierForScore(overall);
    const rows=REPORT_CATS.map((rc,idx)=>{
      const cat=LNT_MATRIX.find(c=>c.id===rc.id);
      const sc=catScores[idx];
      let scoreHtml;
      if(sc==null){
        const st=String((halfMeta[rc.id]||{}).status||'').trim();
        const isNA=isNAStatus(st);
        // Blank STATUS with no score (sc==null) here means either nobody has rated it
        // yet, or the evaluator has but the approver hasn't signed off — categoryScoreEligible
        // above already excluded it from `overall` either way, so this badge just needs to
        // say which of those two it is.
        const evalDone = REPORT_CATS.length && LNT_MATRIX.find(c=>c.id===rc.id)?.params.some((_,pi)=>{
          const v=ratings[`${rc.id}_${pi}`]; return v!=null && v!=='';
        });
        const label = isNA ? 'NA' : (st ? hesc(st) : (evalDone ? 'Pending Approval' : 'Not rated'));
        const color = isNA ? '#8a6d1a' : (evalDone ? 'var(--amb,#9a6a07)' : 'var(--t4)');
        scoreHtml=`<span title="${isNA?'Not applicable this half':(st?'Status: '+hesc(st):(evalDone?'Rated, awaiting approver sign-off':'No parameters rated by this team yet'))}" style="display:inline-block;font-family:var(--hd);font-weight:700;font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;color:${color};background:${color}1a;border:1px solid ${color}55;padding:2px 8px;border-radius:2px;white-space:nowrap;">${label}</span>`;
      }else{
        scoreHtml=`<span style="font-family:var(--hd);font-weight:600;font-size:13px;color:var(--navy);white-space:nowrap;">${sc.toFixed(1)}%</span>`;
      }
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid var(--brd);">
        <div style="min-width:0;"><div style="font-size:11px;color:var(--txt);line-height:1.2;">${hesc(rc.label)}</div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);">weight ${cat?cat.w:0}%</div></div>
        ${scoreHtml}</div>`;
    }).join('');
    return `<div style="border:1px solid ${t.c}55;border-radius:2px;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:${t.c}14;">
        <div><div style="font-family:var(--hd);font-weight:600;font-size:12px;color:var(--t2);letter-spacing:.5px;">${q}${q===activeQuarter?' · ACTIVE':''}</div>
        <div style="font-size:10px;font-family:var(--mono);color:${t.c};font-weight:600;letter-spacing:.5px;">${t.label}</div></div>
        <div style="font-family:var(--hd);font-weight:700;font-size:22px;color:${t.c};white-space:nowrap;">${overall.toFixed(1)}%</div></div>
      <div style="padding:4px 14px 12px;">${rows}</div></div>`;
  }).join('');

  document.getElementById('itemrate-modal-body').innerHTML=
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">${cards}</div>`;
  document.getElementById('itemrate-modal').style.display='flex';
}
function closeItemRating(){document.getElementById('itemrate-modal').style.display='none'}
function openFullRatingFromBreakdown(){
  const k=_ratingBreakdownKey;
  closeItemRating(); closeDetail();
  if(k) gotoRatingItem(k);
}
(function injectItemRatingModal(){
  if(document.getElementById('itemrate-modal'))return;
  const m=document.createElement('div');
  m.id='itemrate-modal';
  m.style.cssText='display:none;position:fixed;inset:0;z-index:1004;background:rgba(16,24,40,.5);backdrop-filter:blur(3px);align-items:center;justify-content:center;padding:24px;';
  m.onclick=e=>{if(e.target.id==='itemrate-modal')closeItemRating()};
  m.innerHTML=`
    <div style="background:var(--s1,#fff);border:1px solid var(--brd2,#a3aab1);border-radius:2px;width:100%;max-width:680px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 14px 30px -12px rgba(15,18,22,.42);overflow:hidden;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--brd2,#e4e7ec);">
        <div style="min-width:0">
          <div id="itemrate-modal-title" style="font-family:var(--hd);font-size:18px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--navy,#101828);line-height:1.1;word-break:normal;overflow-wrap:break-word;text-wrap:pretty;"></div>
          <div id="itemrate-modal-sub" style="font-size:11px;color:var(--t3,#98a2b3);font-family:var(--mono);margin-top:3px;word-break:normal;overflow-wrap:break-word;"></div>
        </div>
        <button class="modal-x-close" onclick="closeItemRating()">×</button>
      </div>
      <div id="itemrate-modal-body" style="overflow:auto;flex:1;padding:16px 20px;"></div>
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 20px;border-top:1px solid var(--brd2,#e4e7ec);">
        <button onclick="closeItemRating()" style="cursor:pointer;background:none;border:1px solid var(--brd2,#a3aab1);color:var(--t2);font-family:var(--hd);font-weight:500;font-size:12px;padding:8px 16px;border-radius:2px;">Close</button>
        <button onclick="openFullRatingFromBreakdown()" class="btn1" style="cursor:pointer;">Open full rating editor &rarr;</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('itemrate-modal').style.display==='flex')closeItemRating()});
})();
(function injectDetailModal(){
  if(document.getElementById('detail-modal'))return;
  const m=document.createElement('div');
  m.id='detail-modal';
  m.style.cssText='display:none;position:fixed;inset:0;z-index:1002;background:rgba(16,24,40,.5);backdrop-filter:blur(3px);align-items:center;justify-content:center;padding:24px;';
  m.onclick=e=>{if(e.target.id==='detail-modal')closeDetail()};
  m.innerHTML=`
    <div style="background:var(--s1,#fff);border:1px solid var(--brd2,#a3aab1);border-radius:2px;width:100%;max-width:1120px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 14px 30px -12px rgba(15,18,22,.42);overflow:hidden;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--brd2,#e4e7ec);">
        <div style="min-width:0">
          <div id="detail-modal-title" style="font-family:var(--hd);font-size:20px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--navy,#101828);line-height:1.1;word-break:normal;overflow-wrap:break-word;text-wrap:pretty;"></div>
          <div id="detail-modal-sub" style="font-size:11.5px;color:var(--t3,#98a2b3);font-family:var(--mono);margin-top:3px;"></div>
        </div>
        <button class="modal-x-close" onclick="closeDetail()">×</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;padding:10px 20px;border-bottom:1px solid var(--brd2,#e4e7ec);">
        <input id="detail-modal-search" class="sinp" placeholder="Filter these items…" oninput="renderDetailRowsD(this.value)" style="flex:1;max-width:320px"/>
        <span class="ch ch-b" id="detail-modal-count" style="margin-left:auto"></span>
      </div>
      <div class="tw" style="overflow:auto;flex:1;">
        <table class="dt">
          <thead><tr><th>Item</th><th>Vendor</th><th title="The PO Master BUYER — who raised the PO, not who evaluates it">PO Owner</th><th>PO Status</th><th>PO No</th><th>PO Value</th><th>Rating</th><th>MFC</th><th>Pay Terms</th><th>Risk</th><th>Remarks</th></tr></thead>
          <tbody id="detail-modal-body"></tbody>
        </table>
      </div>
    </div>`;
  document.body.appendChild(m);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('detail-modal').style.display==='flex')closeDetail()});
})();


// VIEW: PAYMENTS

function rPayments(){
  const a=all();
  const wPay=a.filter(i=>i.payTerms&&i.payTerms.length>10);
  const wLC=a.filter(i=>i.lc&&i.lc.length>5);
  const wBG=a.filter(i=>i.bgReq&&i.bgReq.length>2&&!['nil','na','not applicable','none'].includes(i.bgReq.toLowerCase()));
  const lcT=l=>{const s=l.toLowerCase();if(s.includes('180'))return'180D';if(s.includes('60'))return'60D';if(s.includes('30'))return'30D';if(s.includes('45'))return'45D';return'Other'};
  const lcC={};wLC.forEach(i=>{const t=lcT(i.lc);lcC[t]=(lcC[t]||0)+1});
  const pm=a.reduce((o,i)=>{const s=(i.payTerms+i.lc).toLowerCase();if(s.includes('vfs'))o.VFS=(o.VFS||0)+1;else if(s.includes('rxil'))o.RXIL=(o.RXIL||0)+1;else if(s.includes('neft'))o.NEFT=(o.NEFT||0)+1;else if(s.includes('l/c')||s.includes(' lc'))o.LC=(o.LC||0)+1;else if(s.length>5)o.Other=(o.Other||0)+1;return o},{});

  setM(`
    <div class="shd"><h2 class="stitle">Payments &amp; LC</h2><span class="ch ch-b">${wPay.length} with terms</span></div>
    <div class="kg">
      <div class="kpi"><div class="kl">Pay Terms</div><div class="kv cb">${wPay.length}</div></div>
      <div class="kpi"><div class="kl">With LC</div><div class="kv" style="color:var(--cyan)">${wLC.length}</div></div>
      <div class="kpi"><div class="kl">BG Required</div><div class="kv ca">${wBG.length}</div></div>
      <div class="kpi"><div class="kl">VFS</div><div class="kv cp">${pm.VFS||0}</div></div>
    </div>
    <div class="g2">
      <div class="pn"><div class="phd"><h3 class="pt">LC Type</h3></div><div class="pb"><div class="cbox"><canvas id="ch-lc"></canvas></div></div></div>
      <div class="pn"><div class="phd"><h3 class="pt">Payment Mode</h3></div><div class="pb"><div class="cbox"><canvas id="ch-pm"></canvas></div></div></div>
    </div>
    <div class="pn"><div class="phd"><h3 class="pt">BG Requirements</h3><span class="ch ch-a">${wBG.length}</span></div><div class="tw"><table class="dt"><thead><tr><th>Item</th><th>Sheet</th><th>BG Type</th><th>Payment Terms</th></tr></thead><tbody>${wBG.slice(0,40).map(i=>`<tr><td title="${hesc(i.item)}"><strong>${hesc(i.item)}</strong></td><td style="color:var(--t2);font-size:10.5px">${hesc(i.sheet)}</td><td><span class="ch ch-a">${hesc(i.bgReq.slice(0,22))}</span></td><td style="font-size:10.5px;color:var(--t2)" title="${hesc(i.payTerms)}">${hesc(i.payTerms)}</td></tr>`).join('')}</tbody></table></div></div>
  `);
  mkCh('ch-lc',{type:'doughnut',data:{labels:Object.keys(lcC),datasets:[{data:Object.values(lcC),backgroundColor:['#2a5f6b','#1f6f86','#0072bc','#bcc1c6','#9a6a07'],borderColor:'#f6f7f8',borderWidth:2}]},options:{cutout:'60%'}});
  mkCh('ch-pm',{type:'doughnut',data:{labels:Object.keys(pm),datasets:[{data:Object.values(pm),backgroundColor:['#0072bc','#3f6d2c','#1f6f86','#2a5f6b','#bcc1c6'],borderColor:'#f6f7f8',borderWidth:2}]},options:{cutout:'60%'}});
}


// VIEW: BLOCKERS

function rBlockers(){
  const a=all();
  const isC=i=>{const m=(i.mfcStatus||'').toLowerCase(),r=(i.remarks||'').toLowerCase();return m.includes('cat-1')||m.includes('cat1')||r.includes('cat-1')||r.includes('agel')||m.includes('awaited')};
  const isT=i=>['tbd','ytd',''].includes((i.vendor||'').toLowerCase().trim())&&poSt(i)!=='released';
  const isP=i=>(i.remarks||'').toLowerCase().includes('pre bid');
  const c1=a.filter(isC),tbd=a.filter(isT),pb=a.filter(isP);
  const bL=(items,cls)=>items.length?items.map(i=>`<div style="display:flex;align-items:center;gap:12px;padding:11px 15px;background:var(--s2);border:1px solid var(--brd);border-left:3px solid ${cls==='tbd'?'var(--red)':cls==='pb'?'var(--pur)':'var(--amb)'};border-radius:10px"><div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:500;color:var(--txt);word-break:normal;overflow-wrap:break-word;text-wrap:pretty;" title="${hesc(i.item)}">${hesc(i.item)}</div><div style="font-size:10px;color:var(--t3);margin-top:1px;font-family:var(--mono)">${hesc(i.sheet)} · ${hesc(i.vendor||'TBD')}</div></div><span class="ch ${cls==='tbd'?'ch-r':cls==='pb'?'ch-p':'ch-a'}">${cls==='tbd'?'TBD':cls==='pb'?'PRE-BID':'AGEL'}</span></div>`).join(''):'<div class="empty">None</div>';

  setM(`
    <div class="shd"><h2 class="stitle">Blockers</h2><span class="ch ch-a">${c1.length} blocked</span></div>
    <div class="kg">
      <div class="kpi"><div class="kl">CAT-1/AGEL</div><div class="kv ca">${c1.length}</div></div>
      <div class="kpi"><div class="kl">Vendor TBD</div><div class="kv cr">${tbd.length}</div></div>
      <div class="kpi"><div class="kl">Pre-Bid</div><div class="kv cp">${pb.length}</div></div>
      <div class="kpi"><div class="kl">Total</div><div class="kv cr">${new Set([...c1,...tbd,...pb].map(i=>i.item+i.sheet)).size}</div></div>
    </div>
    <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--amb)">CAT-1 / AGEL Blocked</h3><span class="ch ch-a">${c1.length}</span></div><div class="pb" style="display:flex;flex-direction:column;gap:7px">${bL(c1,'')}</div></div>
    <div class="g2">
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--red)">Vendor TBD</h3><span class="ch ch-r">${tbd.length}</span></div><div class="pb" style="display:flex;flex-direction:column;gap:7px">${bL(tbd,'tbd')}</div></div>
      <div class="pn"><div class="phd"><h3 class="pt" style="color:var(--pur)">Pre-Bid</h3><span class="ch ch-p">${pb.length}</span></div><div class="pb" style="display:flex;flex-direction:column;gap:7px">${bL(pb,'pb')}</div></div>
    </div>
  `);
}


// VIEW: SHEET (per-sheet tracker with multi-filters)

function rSheet(name){
  const data=DB[name];if(!data)return;
  const items=data.rows;
  const poR=items.filter(i=>poSt(i)==='released').length;
  const mfcOK=items.filter(i=>['issued','partial'].includes(mfcSt(i))).length;
  const pct=items.length?Math.round(poR/items.length*100):0;
  const risks=getRisk().filter(r=>r.sheetId===name);

  const hasF=field=>items.some(i=>i[field]&&i[field].length>0);
  const hasVendor=hasF('vendor'),hasOwner=hasF('acc'),hasPO=hasF('poNum')||hasF('poIssued'),hasMFC=hasF('mfcStatus');
  const hasBG=hasF('bgReq'),hasPay=hasF('payTerms'),hasLT=hasF('leadTime');
  const hasRemarks=hasF('remarks'),hasStatus=hasF('status');

  const uVen=[...new Set(items.map(i=>i.vendor).filter(v=>v&&v.length>0))].sort();
  const uOwn=[...new Set(items.map(i=>i.acc).filter(a=>a&&a.length>1))].sort();
  const uPON=[...new Set(items.map(i=>i.poNum).filter(p=>p&&p.length>3))].sort();

  let ths='<th>Item</th>';
  if(hasVendor) ths+='<th>Vendor</th>';
  if(hasOwner) ths+='<th>Owner</th>';
  if(hasPO) {
    ths+='<th>PO Status</th>';
    ths+='<th>PO Number</th>';
    ths+='<th>PO Date</th>';
    ths+='<th>PO Value</th>';
  }
  if(hasMFC) ths+='<th>MFC Status</th>';
  if(hasBG) ths+='<th>BG Req.</th>';
  if(hasPay) ths+='<th>Payment Terms</th>';
  if(hasLT) ths+='<th>Lead Time</th>';
  if(hasRemarks||hasStatus) ths+='<th>Status / Remarks</th>';
  ths+='<th>Risk</th>';

  const trowsArr=items.map(i=>{
    const r=riskFor(i.item);
    const bgC=!i.bgReq||['nil','na','not applicable'].includes(i.bgReq.toLowerCase())?'var(--t3)':'var(--amb)';

    let h=`<tr data-po="${poSt(i)}" data-vendor="${hesc((i.vendor||'').toLowerCase())}" data-owner="${hesc((i.acc||'').toLowerCase())}" data-ponum="${hesc((i.poNum||'').toLowerCase())}">`;
    h+=`<td title="${hesc(i.item)}"><strong>${hesc(i.item)}</strong></td>`;
    if(hasVendor) h+=`<td style="color:var(--t2)">${hesc(i.vendor||'TBD')}</td>`;
    if(hasOwner) h+=`<td style="color:var(--acc2);font-size:11px">${hesc(i.acc||'—')}</td>`;

    if(hasPO) {
      h+=`<td>${pill(poSt(i))}</td>`;
      h+=`<td style="font-size:11.5px;font-family:var(--mono);color:var(--txt)">${hesc(i.poNum||'—')}</td>`;
      h+=`<td style="font-size:11.5px;font-family:var(--mono);color:var(--txt)">${hesc(i.poDate||'—')}</td>`;
      h+=`<td style="font-size:11.5px;font-family:var(--mono);color:var(--txt)">${hesc(formatMoney(i.poVal))}</td>`;
    }

    if(hasMFC) h+=`<td>${i.mfcStatus?pill(mfcSt(i)):'<span style="color:var(--t3)">—</span>'}</td>`;
    if(hasBG) h+=`<td style="color:${bgC};font-size:11px;font-family:var(--mono)">${hesc(i.bgReq||'—')}</td>`;
    if(hasPay) h+=`<td style="color:var(--t3);font-size:10.5px;max-width:240px" title="${hesc(i.payTerms)}">${hesc(i.payTerms||'—')}</td>`;
    if(hasLT) h+=`<td style="color:var(--t3);font-size:10.5px">${hesc(i.leadTime||'—')}</td>`;
    if(hasRemarks||hasStatus) h+=`<td style="color:var(--t3);font-size:10.5px;max-width:260px" title="${hesc(i.remarks||i.status)}">${hesc(i.remarks||i.status||'—')}</td>`;
    h+=`<td>${r?`<span class="rbdg ${r.level}" style="font-size:9px">${r.level.toUpperCase()}</span>`:'—'}</td></tr>`;
    return h;
  });

  setM(`
    <div class="shd">
      <h2 class="stitle">${hesc(name)}</h2>
      <div class="chps"><span class="ch ch-b">${items.length} items</span>${risks.filter(r=>r.level==='high').length>0?`<span class="ch ch-r">${risks.filter(r=>r.level==='high').length} high risk</span>`:''}</div>
    </div>
    <div class="kg">
      <div class="kpi"><div class="kl">Total</div><div class="kv cb">${items.length}</div></div>
      <div class="kpi"><div class="kl">PO Released</div><div class="kv cg">${poR}</div><div class="ks">${pct}%</div><div class="kb"><div class="kbf" style="width:${pct}%;background:var(--grn)"></div></div></div>
      ${hasMFC?`<div class="kpi"><div class="kl">MFC</div><div class="kv ca">${mfcOK}</div></div>`:''}
      ${hasVendor?`<div class="kpi"><div class="kl">Vendors</div><div class="kv">${uVen.length}</div></div>`:''}
      <div class="kpi"><div class="kl">At Risk</div><div class="kv cr">${risks.length}</div></div>
    </div>

    <div class="pn">
      <div class="phd" style="flex-direction:column;align-items:stretch;gap:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <h3 class="pt">Item Tracker</h3>
          <button class="btn-exp" onclick="expSheet('${esc(name)}')"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Export CSV</button>
          <button class="btn-exp" onclick="expSheetXlsx('${esc(name)}')"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Export Excel</button>
        </div>
        <div class="fbar">
          <input class="sinp" id="sh-q" placeholder="🔍 Search…" oninput="shFltD()" style="flex:1;min-width:140px"/>
          <select class="sel" id="sh-po" onchange="shFlt()">
            <option value="">All PO Status</option>
            <option value="released">Released</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="na">N/A</option>
          </select>
          ${hasVendor?`<select class="sel" id="sh-ven" onchange="shFlt()"><option value="">All Vendors</option>${uVen.map(v=>`<option value="${hesc(v.toLowerCase())}">${hesc(v)}</option>`).join('')}</select>`:''}
          ${hasOwner?`<select class="sel" id="sh-own" onchange="shFlt()"><option value="">All Owners</option>${uOwn.map(o=>`<option value="${hesc(o.toLowerCase())}">${hesc(o)}</option>`).join('')}</select>`:''}
          ${uPON.length?`<select class="sel" id="sh-pon" onchange="shFlt()"><option value="">All PO#</option>${uPON.map(p=>`<option value="${hesc(p.toLowerCase())}">${hesc(p)}</option>`).join('')}</select>`:''}
          <button class="pgb" onclick="clrSh()" style="white-space:nowrap">✕ Clear</button>
          <span class="pgi" id="sh-cnt"></span>
        </div>
      </div>
      <div class="tw"><table class="dt" id="sh-tbl"><thead><tr>${ths}</tr></thead><tbody id="sh-tbody"></tbody></table></div>
    </div>
  `);
  streamRows(document.getElementById('sh-tbody'), trowsArr, ()=>shFlt());
}

function shFlt(){
  const q=(document.getElementById('sh-q')?.value||'').toLowerCase();
  const po=document.getElementById('sh-po')?.value||'';
  const ven=document.getElementById('sh-ven')?.value||'';
  const own=document.getElementById('sh-own')?.value||'';
  const pon=document.getElementById('sh-pon')?.value||'';
  let vis=0;
  document.querySelectorAll('#sh-tbl tbody tr').forEach(tr=>{
    const ok=(!po||tr.dataset.po===po)&&(!ven||tr.dataset.vendor?.includes(ven))&&(!own||tr.dataset.owner?.includes(own))&&(!pon||tr.dataset.ponum?.includes(pon))&&(!q||tr.textContent.toLowerCase().includes(q));
    tr.style.display=ok?'':'none';if(ok)vis++;
  });
  const c=document.getElementById('sh-cnt');if(c)c.textContent=vis+' item'+(vis!==1?'s':'')+' shown';
}
function clrSh(){['sh-q','sh-po','sh-ven','sh-own','sh-pon'].forEach(id=>{const e=document.getElementById(id);if(e)e.value=''});shFlt()}

// VIEW: RAW DATA

function rRaw(){
  const a = all();
  RAW_ITEMS = [...new Set(a.flatMap(i => [i.jobCode, i.jobDesc, i.item]).filter(v => v && v.length > 0))].sort();
  RAW_VENDORS = [...new Set(a.map(i => i.vendor).filter(v => v && v.length > 0))].sort();
  RAW_POS = [...new Set(a.map(i => i.poNum).filter(v => v && v.length > 0))].sort();

  setM(`
    <div class="shd"><h2 class="stitle">Raw Data</h2><span class="ch ch-b" id="rc"></span></div>
    <div class="pn">
      <div class="phd" style="flex-direction:column; align-items:stretch; gap:12px;">

        <div class="tc" style="gap:10px;">
          <input class="sinp" id="rq" placeholder="General Search…" oninput="rSrchD()" style="width:130px"/>

          <input class="sinp" list="dl-items" id="rf-item" placeholder="Job Code / Desc…" oninput="rSrchD();updateRawDatalist('item')" style="width:160px"/>
          <datalist id="dl-items">${RAW_ITEMS.map(v => `<option value="${hesc(v)}">`).join('')}</datalist>

          <input class="sinp" list="dl-vens" id="rf-ven" placeholder="Vendor Desc…" oninput="rSrchD();updateRawDatalist('ven')" style="width:160px"/>
          <datalist id="dl-vens">${RAW_VENDORS.map(v => `<option value="${hesc(v)}">`).join('')}</datalist>

          <input class="sinp" list="dl-pos" id="rf-po" placeholder="PO Number…" oninput="rSrchD();updateRawDatalist('po')" style="width:150px"/>
          <datalist id="dl-pos">${RAW_POS.map(v => `<option value="${hesc(v)}">`).join('')}</datalist>

          <select class="sel" id="rp" onchange="rSrch()">
            <option value="">All Sheets</option>
            ${SHEETS.map(s => `<option value="${hesc(s)}">${hesc(DB[s].name)}</option>`).join('')}
          </select>

          <select class="sel" id="rs" onchange="rSrch()">
            <option value="">All Status</option>
            <option value="released">Released</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
          </select>

          <button class="pgb" onclick="clrRawFlt()" style="white-space:nowrap; padding:6px 12px;">✕ Clear</button>
        </div>

        <div class="tc" style="justify-content:space-between; border-top:1px solid var(--brd2); padding-top:10px;">
          <button class="btn-exp" onclick="expAll()"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Export All</button>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="pgi" id="rpi"></span>
            <button class="pgb" id="rpv" onclick="rPg(-1)">← Prev</button>
            <button class="pgb" id="rnx" onclick="rPg(1)">Next →</button>
          </div>
        </div>
      </div>
      <div class="tw" id="rtbl"></div>
    </div>
  `);
  syncRawDatalists();
  rSrch();
}

function rSrch(){
  const q = (document.getElementById('rq')?.value || '').toLowerCase();
  const pf = document.getElementById('rp')?.value || '';
  const sf = document.getElementById('rs')?.value || '';

  const fItem = (document.getElementById('rf-item')?.value || '').toLowerCase();
  const fVen = (document.getElementById('rf-ven')?.value || '').toLowerCase();
  const fPo = (document.getElementById('rf-po')?.value || '').toLowerCase();

  const a = all();

  _filt = a.filter(i => {
    if(pf && i.sheetId !== pf) return false;
    if(sf && poSt(i) !== sf) return false;

    if(fItem && !(`${i.jobCode || ''} ${i.jobDesc || ''} ${i.item || ''}`).toLowerCase().includes(fItem)) return false;
    if(fVen && !(i.vendor || '').toLowerCase().includes(fVen)) return false;
    if(fPo && !(i.poNum || '').toLowerCase().includes(fPo)) return false;

    if(!q) return true;
    return Object.values(i).some(v => String(v).toLowerCase().includes(q));
  });

  _pg = 1;
  const e = document.getElementById('rc');
  if(e) e.textContent = _filt.length + ' records';

  rRndr();
}

function updateRawDatalist(type){
  const mapping = {
    item:{input:'rf-item',datalist:'dl-items',src:RAW_ITEMS},
    ven:{input:'rf-ven',datalist:'dl-vens',src:RAW_VENDORS},
    po:{input:'rf-po',datalist:'dl-pos',src:RAW_POS}
  };
  const m = mapping[type];
  if(!m) return;
  const q = (document.getElementById(m.input)?.value || '').toLowerCase();
  const list = m.src.filter(v => !q || v.toLowerCase().includes(q)).slice(0,40);
  const el = document.getElementById(m.datalist);
  if(el) el.innerHTML = list.map(v => `<option value="${hesc(v)}">`).join('');
}

function syncRawDatalists(){
  ['item','ven','po'].forEach(updateRawDatalist);
}

window.clrRawFlt = function() {
  ['rq','rf-item','rf-ven','rf-po','rp','rs'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  rSrch();
};

function rRndr(){
  const start=(_pg-1)*PG, end=start+PG, page=_filt.slice(start,end);
  const cols=['item','vendor','acc','poIssued','poNum','poVal','poDate','mfcStatus','bgReq','payTerms','lc','leadTime','remarks','qty'];
  const ths=cols.map(c=>`<th>${c}</th>`).join('');
  const trs=page.map(i=>`<tr>${cols.map(c=>`<td title="${hesc(i[c]||'')}">${hesc(i[c]||'')}</td>`).join('')}</tr>`).join('');
  const tbl=`<table class="dt"><thead><tr>${ths}</tr></thead><tbody>${trs||'<tr><td colspan="'+cols.length+'" style="color:var(--t3)">No results</td></tr>'}</tbody></table>`;
  const el=document.getElementById('rtbl');if(el)el.innerHTML=`<div class="tw">${tbl}</div>`;
  const tot=_filt.length,pages=Math.ceil(tot/PG)||1;
  const pi=document.getElementById('rpi');if(pi)pi.textContent=`Page ${_pg}/${pages} · ${tot} records`;
  const pv=document.getElementById('rpv'),nx=document.getElementById('rnx');
  if(pv)pv.disabled=_pg<=1;if(nx)nx.disabled=_pg>=pages;
}
function rPg(d){const pages=Math.ceil(_filt.length/PG)||1;_pg=Math.max(1,Math.min(_pg+d,pages));rRndr();}
// INDIAN FINANCIAL YEAR HALF-YEAR HELPERS
// H1 = Apr–Sep, H2 = Oct–Mar. q holds the half number (1 or 2).
function getIndianFYQuarter(date) {
  const m = date.getMonth();
  const yr = date.getFullYear();
  if (m >= 3 && m <= 8)  return { fy: yr,      q: 1 }; // Apr–Sep -> H1
  if (m >= 9 && m <= 11) return { fy: yr,      q: 2 }; // Oct–Dec -> H2
  return                        { fy: yr - 1,  q: 2 }; // Jan–Mar -> H2 (prev FY)
}
function currentIndianFYQuarter() {
  const { fy, q } = getIndianFYQuarter(new Date());
  return `${fy}-H${q}`;
}


// VIEW: VENDOR SCORECARD (Acme Matrix - Multi-Page)


