/* ============================================================
 * 50-view-team-workload.js
 * Evaluation-task model (buildTeamTasks) + Team Workload page
 * ------------------------------------------------------------
 * Part of the Acme Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html).
 * ============================================================ */
/* ════════════════════════════════════════════════════════════════════════
   TEAM WORKLOAD — evaluation progress model
   ------------------------------------------------------------------------
   The unit of work is one EVALUATION TASK = (PO × team × half-year), which
   is exactly one row on a category sheet of the rating workbook. That is the
   only unit that reconciles with the Excel: the same PO is evaluated again in
   H2, by (possibly) the same evaluator, and gets its own STATUS.

   Each task carries:
     evaluator  — the sheet's EVALUATOR column (who must rate it)
     approver   — the sheet's APPROVER column (who must sign it off)
     rated      — does that half hold at least one parameter score for the team
     appr       — approval state derived from the sheet's STATUS column
   ==================================================================== */

// STATUS on the category sheets is free text, not an enum. SCM/EDRC use it as
// a workflow flag ("Approved" / "Changed and Approved"), while Quality and
// Operations also use it to record WHY a PO was not evaluated this period
// ("Not offered for the inspection in H1", "FAT Schedule in Oct", …). Anything
// that is not a recognised workflow value is therefore treated as a written
// justification rather than a pending approval, so it never inflates the queue.
// Score colour ramp. The overview defines an identical _pctCol, but it is a const
// scoped inside that render function, so Team Workload needs its own.
const _twCol = v => v>=90?'#1e7d34':v>=80?'#4f9d3a':v>=70?'#8a7d17':v>=50?'#c07a1e':'#a82f1c';

// A category sheet row with a blank EVALUATOR is still a real evaluation that is
// owed — it just has nobody's name against it. Dropping those rows made each team's
// total disagree with the workbook (SCM 244 instead of 250, EDRC 238, and so on).
// They are now bucketed under this label so the totals reconcile and the gap is
// visible and actionable rather than silently missing.
const NO_EVALUATOR = '(no evaluator named)';

const APPROVAL_META = {
  approved: { label:'Approved',           short:'Approved', c:'#1e7d34' },
  changed:  { label:'Changed and Approved', short:'Changed',  c:'#9a6a07' },
  pending:  { label:'Awaiting approval',  short:'Pending',  c:'#1a73e8' },
  remark:   { label:'Not applicable',     short:'N/A',      c:'#6b7280' },
};
function classifyApproval(status){
  const t = String(status||'').trim();
  if(!t) return 'pending';
  const tl = t.toLowerCase();
  if(tl === 'approved') return 'approved';
  if(isNAStatus(t)) return 'remark';            // NA/N/A/Not Applicable → "Not applicable" bucket
  // The workbook dropdown now reads "Changed and Approved"; the old "Not Approved and
  // Changed" wording is still accepted so sheets saved before the rename classify the same.
  if(tl === 'changed and approved' || tl.startsWith('not approved')) return 'changed';
  return 'remark';
}

// The importer stores each PO's ratings/meta under SEVERAL stableKey variants
// (vendor code vs vendor name vs blank), because the tracker's own key spelling
// isn't known at import time. Looking a task up by stableKey(item) therefore
// misses whenever the tracker resolved a different variant — which silently
// dropped most Quality and Operation ratings. Every variant is prefixed
// `po:<po>|`, so collapsing the store to one bag per PO is both exact and
// spelling-proof.
function _byPoIndex(map){
  const out = {};
  Object.keys(map || {}).forEach(k => {
    const m = String(k).match(/^po:([^|]+)\|/);
    if (!m || !m[1]) return;
    out[m[1]] = Object.assign(out[m[1]] || {}, map[k]);
  });
  return out;
}

// Build every evaluation task for the given team ids, across the halves in scope.
// Read the raw stored per-item ratings map for one half ({} if none).
function _rawItemRatingsForHalf(half) {
  try {
    const stored = appStorage.getItem(`lnt_itemRatings_${half}`);
    return stored ? (JSON.parse(stored) || {}) : {};
  } catch (e) { return {}; }
}

// Driven by the rating workbook (categoryMeta), not by the PO Master, so a PO that
// exists on a category sheet but not in the tracker still shows up as work owed.
function buildTeamTasks(catIds){
  const halves = scopePeriods();
  const itemByPo = {};
  all().forEach(i => { const p = String(i.poNum||'').trim(); if (p && !itemByPo[p]) itemByPo[p] = i; });

  const tasks = [];
  halves.forEach(q => {
    const ir = _byPoIndex(_rawItemRatingsForHalf(q));
    const cm = _byPoIndex(_lsParsed(`lnt_categoryMeta_${q}`));
    const pr = _byPoIndex(_lsParsed(`lnt_evalProgress_${q}`));
    Object.keys(cm).forEach(po => {
      const meta = cm[po] || {};
      const bag  = ir[po] || {};
      const prog = pr[po] || null;
      const item = itemByPo[po] || { poNum:po, vendor:'', vendorName:'', jobDesc:'', jobCode:'', item:'' };
      catIds.forEach(cid => {
        const m = meta[cid] || {};
        // A row belongs to this team when the sheet carries it at all, whether or not
        // an evaluator is named — see NO_EVALUATOR.
        if (!m || (m.buyer === undefined && m.approver === undefined && m.status === undefined)) return;
        const raw = String(m.buyer || '').trim();
        const unassigned = raw.length < 2;
        const ev = unassigned ? NO_EVALUATOR : raw;
        const cat = LNT_MATRIX.find(c => c.id === cid);
        const n = cat ? cat.params.length : 0;
        const filledN = cat ? cat.params.reduce((s,_,pi) => {
          const v = bag[`${cid}_${pi}`]; return s + (v != null && v !== '' ? 1 : 0);
        }, 0) : 0;
        // `scored`  = at least one param has a published value (STATUS-gated by the
        //             importer — same "bag" Completeness reads, so this can only be
        //             non-zero once STATUS carries a value at all).
        // `started` = the evaluator touched it AT ALL, independent of STATUS — falls
        //             back to the STATUS-gated `scored` only for pre-existing imports
        //             saved before evalProgress tracking existed.
        // `rated`   = STRICT: every parameter is filled. This intentionally matches
        //             Completeness's itemCompleteness() (same bag, same filled===total
        //             rule) rather than "touched at all" — the two pages used to define
        //             "rated" differently, which meant a PO could show green/done here
        //             while Completeness still counted it as incomplete for the exact
        //             same reason (see BAHRA/SCM in the test data: Approved status, but
        //             only 9 of 15 parameters actually filled in).
        const scored = filledN > 0;
        const started = prog ? !!prog[cid] : scored;
        const rated = n > 0 && filledN === n;
        const status = String(m.status || '').trim();
        tasks.push({
          item, po, cat:cid, half:q, evaluator:ev,
          approver:String(m.approver || '').trim(),
          status, appr:classifyApproval(status), rated, started, scored, unassigned,
          filledN, totalN:n,
          score: scored ? calcCategoryScore(cid, bag) : null,
        });
      });
    });
  });
  return tasks;
}

// Roll a task list up into the counters every panel on this page needs.
// rated = every parameter filled (strict). Of what's NOT rated, split further into
// inProgress (started, some parameters filled) vs notStarted (nothing filled at all) —
// "yet to be rated" used to lump those two very different states together.
function tallyTasks(list){
  const t = { total:list.length, rated:0, unrated:0, inProgress:0, notStarted:0,
              approved:0, changed:0, pending:0, remark:0, scoreSum:0, scoreN:0, pos:new Set() };
  list.forEach(x => {
    if (x.rated) t.rated++;
    else { t.unrated++; if (x.started) t.inProgress++; else t.notStarted++; }
    t[x.appr]++;
    if (x.score != null) { t.scoreSum += x.score; t.scoreN++; }
    if (x.item && x.item.poNum) t.pos.add(x.item.poNum);
  });
  t.pct = t.total ? Math.round(t.rated / t.total * 100) : 0;
  t.avg = t.scoreN ? t.scoreSum / t.scoreN : null;
  return t;
}

function setTeamStatusFilter(s){ teamSel.status = (teamSel.status === s) ? '' : s; rTeam(); }
function setTeamSearch(v){ teamSel.q = v; _teamRenderTable(); }

// Rows are re-rendered on their own so typing in the search box doesn't rebuild
// the whole view (and lose focus) on every keystroke.
let _teamTaskCache = [];
// Set by rTeam() before _teamRenderTable() runs. When "All Teams" is selected, one PO can
// carry up to 4 rows here (one per SCM/EDRC/Quality/Operation task) with the same PO
// Number/Vendor/Project but different Evaluator/Rating/Approval — with no way to tell
// which team a given row belongs to. That made a PO look self-contradictory (e.g. one
// row "Rated" and another "Not started" for what looked like the same line) whenever two
// of its teams were at different stages. Showing the Team column only when it's actually
// ambiguous (i.e. not already scoped to one team) keeps the single-team view uncluttered.
let _teamShowTeamCol = false;
function _teamRenderTable(){
  const host = document.getElementById('tw-rows');
  const cnt  = document.getElementById('tw-count');
  if(!host) return;
  const q = String(teamSel.q||'').trim().toLowerCase();
  const both = scopePeriods().length > 1;
  const rows = _teamTaskCache.filter(t => !q ||
    [t.item.poNum, t.item.vendorName, t.item.vendor, t.item.jobDesc, t.evaluator, t.approver, TEAM_LABEL[t.cat]]
      .some(v => String(v||'').toLowerCase().includes(q)));
  const CAP = 400;
  host.innerHTML = rows.slice(0, CAP).map(t => {
    const am = APPROVAL_META[t.appr];
    // Rated (all params filled) / In Progress (some filled) / Not Started (none) —
    // was a flat Rated/Not-rated split that couldn't tell "9 of 15 filled in" apart
    // from "nothing touched yet".
    const rc = t.rated ? '#1e7d34' : t.started ? '#9a6a07' : '#a82f1c';
    const rlabel = t.rated ? 'Rated' : t.started ? `In progress (${t.filledN}/${t.totalN})` : 'Not started';
    const rb = `<span style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.4px;padding:2px 7px;border-radius:2px;background:${rc}1a;color:${rc};border:1px solid ${rc}55">${rlabel}</span>`;
    // A blank STATUS ("pending", APPROVAL_META's default) means two different things
    // depending on whether the evaluator has actually filled anything in yet: nothing to
    // approve at all yet ("Pending Rating") vs. work sitting in the approver's queue
    // ("Pending Approval"). A flat "Pending" here couldn't tell those apart, which read
    // as the same non-informative state as a line nobody had touched.
    const apLabel = t.appr === 'pending' ? (t.started ? 'Pending Approval' : 'Pending Rating') : am.short;
    const apTitle = t.appr === 'pending' ? (t.started ? 'Rated, awaiting approver sign-off' : 'Not yet rated by the evaluator') : (t.status||am.label);
    const ap = `<span title="${hesc(apTitle)}" style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.4px;padding:2px 7px;border-radius:2px;background:${am.c}1a;color:${am.c};border:1px solid ${am.c}55">${hesc(apLabel)}</span>`;
    return `<tr onclick="openVendorPage('${esc(t.item.vendor||'')}')" style="cursor:pointer" title="Open ${hesc(t.item.vendorName||t.item.vendor||'vendor')}">
      ${both?`<td style="font-family:var(--mono);color:var(--t3)">${t.half}</td>`:''}
      ${_teamShowTeamCol?`<td><span style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.4px;padding:2px 7px;border-radius:2px;background:${CAT_COLORS[t.cat]||'#5e656d'}1a;color:${CAT_COLORS[t.cat]||'#5e656d'};border:1px solid ${CAT_COLORS[t.cat]||'#5e656d'}55">${hesc(TEAM_LABEL[t.cat]||t.cat)}</span></td>`:''}
      <td style="font-family:var(--mono);font-size:11px">${hesc(t.item.poNum||'—')}</td>
      <td><strong>${hesc(t.item.vendorName||t.item.vendor||'—')}</strong></td>
      <td style="color:var(--t2)" title="${hesc(t.item.jobDesc||t.item.jobCode||'—')}">${hesc(t.item.jobDesc||t.item.jobCode||'—')}</td>
      <td style="color:var(--acc2);white-space:nowrap;">${hesc(t.evaluator)}</td>
      <td style="color:var(--t2);white-space:nowrap;">${hesc(t.approver||'—')}</td>
      <td>${rb}</td>
      <td>${ap}</td>
      <td style="text-align:right;font-family:var(--mono);font-weight:600;color:${t.score!=null?_twCol(t.score):'var(--t4)'}">${t.score!=null?t.score.toFixed(1)+'%':'—'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="${(both?9:8)+(_teamShowTeamCol?1:0)}" style="text-align:center;color:var(--t3);padding:22px;">Nothing matches this filter.</td></tr>`;
  if(cnt) cnt.textContent = rows.length > CAP
    ? `showing ${CAP} of ${rows.length}`
    : `${rows.length} row(s)`;
}

function rTeam(){
  initRatings();
  const isCat = !!(teamSel.team && teamSel.team!=='__none__');   // a real category/team selected
  const catId = isCat ? teamSel.team : null;

  // ---- evaluation tasks: build once for every team, then slice ------------
  // Member identity is always the rating workbook's Evaluator column — never the
  // PO Master BUYER, which names whoever raised the PO rather than who rates it.
  const allTasks = buildTeamTasks(CAT_IDS);
  const byName = arr => [...new Set(arr)].sort((x,y)=>String(x).localeCompare(String(y)));
  const evalsAll = byName(allTasks.map(t=>t.evaluator));   // every Evaluator in the rating workbook

  let memberNames;
  if(isCat){ memberNames = byName(allTasks.filter(t=>t.cat===catId).map(t=>t.evaluator)); }
  else if(teamSel.team==='__none__'){ memberNames = evalsAll.filter(b=>!buyerTeamOf(b)); }
  else { memberNames = evalsAll; }
  if(teamSel.buyer&&!memberNames.includes(teamSel.buyer)) teamSel.buyer='';

  let tasks = isCat ? allTasks.filter(t=>t.cat===catId) : allTasks.slice();
  if(teamSel.team==='__none__') tasks = tasks.filter(t=>!buyerTeamOf(t.evaluator));
  if(teamSel.buyer)             tasks = tasks.filter(t=>t.evaluator===teamSel.buyer);

  const both = scopePeriods().length > 1;
  // A task is only literally "one PO" when it's scoped to exactly one team AND one
  // half — otherwise it's a PO×team (and/or PO×half) pair, and calling that a "PO"
  // undercounts what a PO actually is. This used to key off `both` alone, so the
  // default "All Teams" view showed e.g. "Total POs: 64" for 16 real POs (4 teams ×
  // 16), which is exactly the kind of number that makes this page hard to trust.
  const unitLabel = (isCat && !both) ? 'PO' : 'evaluation';
  const grand     = tallyTasks(tasks);

  // status chip filter applies to the table + evaluator table, not the KPI strip
  const F = teamSel.status;
  // notStarted must mirror tallyTasks()'s own definition exactly (!t.rated && !t.started)
  // — it used to check only !t.started, so a task whose final numbers came from the
  // APPROVER's revised entry (a "Changed" row where the original evaluator column was
  // never touched) could be fully `rated` yet still `!started`, and would slip into the
  // "Not started" table even though it wasn't counted in that chip's own total.
  const passes = t => !F
    || (F==='rated'      && t.rated)
    || (F==='inProgress' && !t.rated && t.started)
    || (F==='notStarted' && !t.rated && !t.started)
    || (F===t.appr);
  const shown = tasks.filter(passes);

  const roleLabel = isCat ? hesc(TEAM_LABEL[catId])+' Evaluator' : 'Evaluator';

  // ---- KPI strip ----------------------------------------------------------
  const kpi = (label,value,foot,color,onclick,active) => `
    <div class="vpd-stat${onclick?' click':''}"${onclick?` onclick="${onclick}"`:''}${active?' style="outline:2px solid var(--acc);outline-offset:-2px"':''}>
      <div class="vpd-stat-body">
        <div class="vpd-stat-label">${label}</div>
        <div class="vpd-stat-value"${color?` style="color:${color}"`:''}>${value}</div>
        <div class="vpd-stat-foot">${foot}</div>
      </div>
    </div>`;
  const kpis = `
    <div class="vpd-stats" style="margin-bottom:16px">
      ${kpi(`Total ${unitLabel}s`, grand.total, `${grand.pos.size} distinct PO(s)${both?' × 2 halves':''}${!isCat?' × 4 teams':''}`,'', '', false)}
      ${kpi('Rated', grand.rated, `${grand.pct}% complete · every parameter filled`, '#1e7d34', "setTeamStatusFilter('rated')", F==='rated')}
      ${kpi('In progress', grand.inProgress, 'some parameters filled', grand.inProgress?'#9a6a07':'#1e7d34', "setTeamStatusFilter('inProgress')", F==='inProgress')}
      ${kpi('Not started', grand.notStarted, grand.notStarted?'Action required':'All done ✓', grand.notStarted?'#a82f1c':'#1e7d34', "setTeamStatusFilter('notStarted')", F==='notStarted')}
      ${kpi('Approved', grand.approved, `signed off by approver`, '#1e7d34', "setTeamStatusFilter('approved')", F==='approved')}
      ${kpi('Approval pending', grand.pending + grand.changed, `${grand.pending} awaiting · ${grand.changed} changed`, (grand.pending+grand.changed)?'#9a6a07':'#1e7d34', "setTeamStatusFilter('pending')", F==='pending')}
    </div>`;

  // ---- per-evaluator progress --------------------------------------------
  const byEval = {};
  memberNames.forEach(n=>{
    if(teamSel.buyer&&n!==teamSel.buyer) return;
    if(teamSel.team==='__none__'&&buyerTeamOf(n)) return;
    byEval[n] = [];
  });
  tasks.forEach(t=>{ (byEval[t.evaluator] = byEval[t.evaluator] || []).push(t); });
  const team = Object.entries(byEval)
    .map(([name,list])=>({name, list, t:tallyTasks(list)}))
    .sort((a,b)=>b.t.total-a.t.total || String(a.name).localeCompare(String(b.name)));

  const evalRows = team.map(m=>{
    const t=m.t;
    const bar = `<div class="tbar" style="margin:0"><div class="tbf" style="width:${t.pct}%;background:${t.pct>=100?'#1e7d34':t.pct>=60?'#0072bc':'#9a6a07'}"></div></div>`;
    return `<tr onclick="setBuyerFilter('${esc(m.name)}')" style="cursor:pointer" title="Filter to ${hesc(m.name)}">
      <td style="white-space:nowrap;"><strong>${hesc(m.name)}</strong>${isCat?'':`<div style="font-size:10px;color:var(--t3)">${buyerTeamOf(m.name)?hesc(TEAM_LABEL[buyerTeamOf(m.name)]):'unassigned'}</div>`}</td>
      <td style="text-align:right;font-family:var(--mono)">${t.total}</td>
      <td style="text-align:right;font-family:var(--mono);color:#1e7d34;font-weight:600">${t.rated}</td>
      <td style="text-align:right;font-family:var(--mono);color:${t.inProgress?'#9a6a07':'var(--t4)'}">${t.inProgress}</td>
      <td style="text-align:right;font-family:var(--mono);color:${t.notStarted?'#a82f1c':'var(--t4)'};font-weight:600">${t.notStarted}</td>
      <td style="text-align:right;font-family:var(--mono);color:#1e7d34">${t.approved}</td>
      <td style="text-align:right;font-family:var(--mono);color:${(t.pending+t.changed)?'#9a6a07':'var(--t4)'}">${t.pending+t.changed}</td>
      <td style="min-width:120px">${bar}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--t2)">${t.pct}%</td>
    </tr>`;
  }).join('');

  const emptyMsg = isCat
    ? `No ${hesc(TEAM_LABEL[catId])} evaluators found. Fill the <strong>Evaluator</strong> column on the ${hesc(TEAM_LABEL[catId])} sheet of the rating workbook and re-import it (open &amp; save it in Excel first).`
    : 'No evaluators found. Fill the <strong>Evaluator</strong> column on the rating workbook’s category sheets and re-import it (open &amp; save it in Excel first).';

  // ---- approver queue -----------------------------------------------------
  const byAppr={};
  tasks.forEach(t=>{
    const n=t.approver||'(not named)';
    if(!byAppr[n]) byAppr[n]={name:n,list:[]};
    byAppr[n].list.push(t);
  });
  const apprRows=Object.values(byAppr).map(a=>({...a,t:tallyTasks(a.list)}))
    .sort((x,y)=>(y.t.pending+y.t.changed)-(x.t.pending+x.t.changed) || y.t.total-x.t.total)
    .map(a=>`<tr>
      <td style="white-space:nowrap;"><strong>${hesc(a.name)}</strong></td>
      <td style="text-align:right;font-family:var(--mono)">${a.t.total}</td>
      <td style="text-align:right;font-family:var(--mono);color:#1e7d34">${a.t.approved}</td>
      <td style="text-align:right;font-family:var(--mono);color:${a.t.pending?'#1a73e8':'var(--t4)'};font-weight:600">${a.t.pending}</td>
      <td style="text-align:right;font-family:var(--mono);color:${a.t.changed?'#9a6a07':'var(--t4)'}">${a.t.changed}</td>
      <td style="text-align:right;font-family:var(--mono);color:var(--t3)">${a.t.remark}</td>
    </tr>`).join('');

  // ---- All Teams: side-by-side team comparison ---------------------------
  let teamMatrix='';
  if(!isCat){
    const rows=CAT_IDS.map(cid=>{
      const t=tallyTasks(allTasks.filter(x=>x.cat===cid));
      return `<tr onclick="setTeamFilter('${cid}')" style="cursor:pointer" title="Open ${hesc(TEAM_LABEL[cid])}">
        <td><strong>${hesc(TEAM_LABEL[cid])}</strong></td>
        <td style="text-align:right;font-family:var(--mono)">${t.total}</td>
        <td style="text-align:right;font-family:var(--mono);color:#1e7d34;font-weight:600">${t.rated}</td>
        <td style="text-align:right;font-family:var(--mono);color:${t.inProgress?'#9a6a07':'var(--t4)'}">${t.inProgress}</td>
        <td style="text-align:right;font-family:var(--mono);color:${t.notStarted?'#a82f1c':'var(--t4)'};font-weight:600">${t.notStarted}</td>
        <td style="text-align:right;font-family:var(--mono);color:#1e7d34">${t.approved}</td>
        <td style="text-align:right;font-family:var(--mono);color:${(t.pending+t.changed)?'#9a6a07':'var(--t4)'}">${t.pending+t.changed}</td>
        <td style="min-width:120px"><div class="tbar" style="margin:0"><div class="tbf" style="width:${t.pct}%;background:${t.pct>=100?'#1e7d34':t.pct>=60?'#0072bc':'#9a6a07'}"></div></div></td>
        <td style="text-align:right;font-family:var(--mono);color:var(--t2)">${t.pct}%</td>
      </tr>`;
    }).join('');
    teamMatrix=`
    <div class="pn" style="margin-bottom:16px">
      <div class="phd"><h3 class="pt">Progress by team</h3><span class="ch ch-b">click a team to drill in</span></div>
      <div class="tw"><table class="dt"><thead><tr><th>Team</th><th style="text-align:right">${unitLabel}s</th><th style="text-align:right">Rated</th><th style="text-align:right">In progress</th><th style="text-align:right">Not started</th><th style="text-align:right">Approved</th><th style="text-align:right">Appr. pending</th><th>Progress</th><th style="text-align:right">%</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }

  // ---- status filter chips ------------------------------------------------
  const chip=(k,label,n,c)=>`<button class="pgb" onclick="setTeamStatusFilter('${k}')" style="${F===k?`background:${c};color:#fff;border-color:${c};`:`color:${c};border-color:${c}66;`}font-weight:600">${label} · ${n}</button>`;
  const chips=`<div class="tc" style="gap:8px;flex-wrap:wrap;align-items:center">
      <span style="font-family:var(--hd);font-size:11px;letter-spacing:.8px;color:var(--t3);text-transform:uppercase">Show</span>
      <button class="pgb" onclick="setTeamStatusFilter('')" style="${!F?'background:var(--acc);color:#fff;border-color:var(--acc);':''}font-weight:600">All · ${grand.total}</button>
      ${chip('rated','Rated',grand.rated,'#1e7d34')}
      ${chip('inProgress','In progress',grand.inProgress,'#9a6a07')}
      ${chip('notStarted','Not started',grand.notStarted,'#a82f1c')}
      ${chip('pending','Awaiting approval',grand.pending,'#1a73e8')}
      ${chip('changed','Changed',grand.changed,'#9a6a07')}
      ${chip('approved','Approved',grand.approved,'#1e7d34')}
      ${chip('remark','Not applicable',grand.remark,'#6b7280')}
      <input class="sinp" style="margin-left:auto;min-width:220px" placeholder="Search PO, vendor, evaluator…" value="${hesc(teamSel.q||'')}" oninput="setTeamSearch(this.value)">
      <span id="tw-count" class="ch ch-b"></span>
    </div>`;

  // existing per-category vendor ranking panel
  let catRankHTML = '';
  if (isCat) {
    const vCatMap = {};
    all().forEach(i=>{
      const code=(i.vendor||'').trim(); if(code.length<2) return;
      const bag=itemRatings[stableKey(i)];
      const c = LNT_MATRIX.find(cat=>cat.id===catId);
      if(!c) return;
      const has = c.params.some((_,pi)=>{const v=bag&&bag[`${catId}_${pi}`];return v!=null&&v!=='';});
      if(has){
        if(!vCatMap[code]) vCatMap[code]={name:i.vendorName||'', s:[]};
        vCatMap[code].s.push(calcCategoryScore(catId, bag));
      }
    });
    const recs=Object.entries(vCatMap).map(([code,v])=>({code,name:v.name,score:v.s.reduce((x,y)=>x+y,0)/v.s.length}))
      .sort((a,b)=>b.score-a.score);
    const trTiers = recs.map(v=>{
      const t=tierForScore(v.score);
      return `<tr onclick="openVendorPage('${esc(v.code)}')" style="cursor:pointer"><td><strong>${hesc(v.name||v.code)}</strong></td><td><span style="font-family:var(--hd);font-weight:600;color:${t.c}">${v.score.toFixed(1)}%</span></td><td><span style="display:inline-block;font-family:var(--hd);font-weight:600;font-size:10px;letter-spacing:.5px;padding:2px 7px;border-radius:2px;background:${t.c}1a;color:${t.c};border:1px solid ${t.c}55">${t.label}</span></td></tr>`;
    }).join('');
    catRankHTML = `
    <div class="pn" style="margin-top:18px;">
      <div class="phd"><h3 class="pt">${hesc(TEAM_LABEL[catId])} Vendor Rankings</h3><span class="ch ch-b">ranked by ${hesc(TEAM_LABEL[catId])} score</span></div>
      <div class="tw"><table class="dt"><thead><tr><th>Vendor</th><th>${hesc(TEAM_LABEL[catId])} Score</th><th>Category Tier</th></tr></thead><tbody>${trTiers||'<tr><td colspan="3" style="text-align:center;color:var(--t3);padding:22px;">No vendors rated in this category yet.</td></tr>'}</tbody></table></div>
    </div>`;
  }

  setM(`
    <div class="shd"><h2 class="stitle">Team Workload</h2>
      <div class="chps"><span class="ch ch-a">${scopeLabel()}</span><span class="ch ch-b">${team.length} ${isCat?hesc(TEAM_LABEL[catId])+' ':''}evaluator(s)</span></div></div>
    ${teamControlsHTML(evalsAll,memberNames)}
    ${kpis}
    ${teamMatrix}
    <div class="g2">
      <div class="pn">
        <div class="phd"><h3 class="pt">Who has rated how many</h3><span class="ch ch-b">click a row to filter</span></div>
        <div class="tw" style="max-height:340px"><table class="dt"><thead><tr><th>${roleLabel}</th><th style="text-align:right">Assigned</th><th style="text-align:right">Rated</th><th style="text-align:right">In progress</th><th style="text-align:right">Not started</th><th style="text-align:right">Approved</th><th style="text-align:right">Appr. pending</th><th>Progress</th><th style="text-align:right">%</th></tr></thead><tbody>${evalRows||`<tr><td colspan="9" style="text-align:center;color:var(--t3);padding:22px;">${emptyMsg}</td></tr>`}</tbody></table></div>
      </div>
      <div class="pn">
        <div class="phd"><h3 class="pt">Approver queue</h3><span class="ch ch-b">${grand.pending} awaiting sign-off</span></div>
        <div class="tw" style="max-height:340px"><table class="dt"><thead><tr><th>Approver</th><th style="text-align:right">Total</th><th style="text-align:right">Approved</th><th style="text-align:right">Awaiting</th><th style="text-align:right">Changed</th><th style="text-align:right">N/A</th></tr></thead><tbody>${apprRows||'<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:22px;">No approvers named.</td></tr>'}</tbody></table></div>
      </div>
    </div>

    <div class="pn" style="margin-top:16px">
      <div class="phd"><h3 class="pt">Purchase orders</h3><span class="ch ch-b">${isCat?hesc(TEAM_LABEL[catId]):'all teams'}</span></div>
      <div class="pb" style="padding-bottom:8px">${chips}</div>
      <div class="tw" style="max-height:520px"><table class="dt"><thead><tr>${both?'<th>Half</th>':''}${!isCat?'<th>Team</th>':''}<th>PO Number</th><th>Vendor</th><th>Project</th><th>${roleLabel}</th><th>Approver</th><th>Rating</th><th>Approval</th><th style="text-align:right">Score</th></tr></thead><tbody id="tw-rows"></tbody></table></div>
    </div>
    ${catRankHTML}
  `);

  _teamShowTeamCol = !isCat;
  _teamTaskCache = shown;
  _teamRenderTable();
}


// Team Workload: filter controls + Evaluator→Team assignment modal
function teamControlsHTML(evalsAll, teamEvals){
  const teamOpts=`<option value="">All Teams</option>`+
    TEAMS.map(t=>`<option value="${t.id}"${teamSel.team===t.id?' selected':''}>${t.label}</option>`).join('')+
    `<option value="__none__"${teamSel.team==='__none__'?' selected':''}>Unassigned</option>`;
  const buyerOpts=`<option value="">${teamSel.team&&teamSel.team!=='__none__'?'All '+hesc(TEAM_LABEL[teamSel.team])+' evaluators':'All Evaluators'}</option>`+
    teamEvals.map(b=>`<option value="${hesc(b)}"${teamSel.buyer===b?' selected':''}>${hesc(b)}</option>`).join('');
  const unassigned=evalsAll.filter(b=>!buyerTeamOf(b)).length;
  return `<div class="pn" style="margin-bottom:14px"><div class="pb" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px">
    <span style="font-family:var(--hd);font-size:12.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--t2)">Team</span>
    <select class="sel" onchange="setTeamFilter(this.value)" style="min-width:150px">${teamOpts}</select>
    <span style="font-family:var(--hd);font-size:12.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--t2)">Evaluator</span>
    <select class="sel" onchange="setBuyerFilter(this.value)" style="min-width:200px">${buyerOpts}</select>
    ${(teamSel.team||teamSel.buyer)?`<button class="pgb" onclick="setTeamFilter('')">Clear</button>`:''}
    <button class="pgb" style="margin-left:auto;background:var(--btn-solid-bg);color:var(--btn-solid-fg);border-color:var(--btn-solid-bg)" onclick="openTeamAssign()">⚙ Assign evaluators to teams${unassigned?` · ${unassigned} unassigned`:''}</button>
  </div></div>`;
}
function teamAssignCounts(){ const bs=distinctEvaluators(); const asg=bs.filter(b=>buyerTeamOf(b)).length; return {total:bs.length, assigned:asg, un:bs.length-asg}; }
function updateTeamAssignSub(){ const c=teamAssignCounts(); const sub=document.getElementById('team-assign-sub'); if(sub) sub.textContent=`${c.total} evaluator(s) · ${c.assigned} assigned · ${c.un} unassigned`; }
function openTeamAssign(){ const s=document.getElementById('team-assign-search'); if(s)s.value=''; renderTeamAssignRows(''); document.getElementById('team-assign-modal').style.display='flex'; }
function closeTeamAssign(){ document.getElementById('team-assign-modal').style.display='none'; if(typeof rTeam==='function') rTeam(); }
function renderTeamAssignRows(q){
  q=(q||'').toLowerCase();
  _taBuyers=distinctEvaluators().filter(b=>!q||b.toLowerCase().includes(q));
  updateTeamAssignSub();
  const opt=b=>{const cur=buyerTeamOf(b);return `<option value="">— Unassigned —</option>`+TEAMS.map(t=>`<option value="${t.id}"${cur===t.id?' selected':''}>${t.label}</option>`).join('');};
  document.getElementById('team-assign-body').innerHTML=_taBuyers.length
    ? _taBuyers.map((b,idx)=>`<tr><td style="color:var(--acc2);white-space:nowrap;">${hesc(b)}</td><td><select class="sel" style="width:100%" onchange="onTeamAssignChange(${idx},this.value)">${opt(b)}</select></td></tr>`).join('')
    : `<tr><td colspan="2" style="text-align:center;color:var(--t3);padding:22px">No evaluators found.${distinctEvaluators().length?'':' Load the rating workbook first.'}</td></tr>`;
}
function onTeamAssignChange(idx, teamId){ const name=_taBuyers[idx]; if(name==null)return; assignBuyerTeam(normBuyerKey(name), teamId); updateTeamAssignSub(); }
(function injectTeamAssignModal(){
  if(document.getElementById('team-assign-modal'))return;
  const m=document.createElement('div'); m.id='team-assign-modal';
  m.style.cssText='display:none;position:fixed;inset:0;z-index:1003;background:rgba(16,24,40,.5);backdrop-filter:blur(3px);align-items:center;justify-content:center;padding:24px;';
  m.onclick=e=>{if(e.target.id==='team-assign-modal')closeTeamAssign()};
  m.innerHTML=`
    <div style="background:var(--s1,#fff);border:1px solid var(--brd2,#a3aab1);border-radius:2px;width:100%;max-width:640px;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 14px 30px -12px rgba(15,18,22,.42);overflow:hidden;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--brd2,#e4e7ec);">
        <div style="min-width:0">
          <div style="font-family:var(--hd);font-size:18px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--navy,#101828);">Assign Evaluators to Teams</div>
          <div id="team-assign-sub" style="font-size:11.5px;color:var(--t3,#98a2b3);font-family:var(--mono);margin-top:3px;"></div>
        </div>
        <button class="modal-x-close" onclick="closeTeamAssign()">×</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;padding:10px 20px;border-bottom:1px solid var(--brd2,#e4e7ec);">
        <input id="team-assign-search" class="sinp" placeholder="Filter evaluators…" oninput="renderTeamAssignRowsD(this.value)" style="flex:1;max-width:280px"/>
        <span style="margin-left:auto;font-size:11px;color:var(--t3,#98a2b3)">Changes save automatically</span>
      </div>
      <div class="tw" style="overflow:auto;flex:1;">
        <table class="dt"><thead><tr><th>Evaluator</th><th style="width:210px">Team</th></tr></thead><tbody id="team-assign-body"></tbody></table>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--brd2,#e4e7ec);display:flex;justify-content:flex-end;">
        <button class="pgb" style="background:var(--acc);color:#fff;border-color:var(--acc)" onclick="closeTeamAssign()">Done</button>
      </div>
    </div>`;
  document.body.appendChild(m);
})();

// VIEW: VENDORS

