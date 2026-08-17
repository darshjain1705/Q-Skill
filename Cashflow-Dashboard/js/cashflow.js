/* Chart.js global theming for the Cyanotype blueprint surface */
if (window.Chart) {
  Chart.defaults.color = '#8ba8c4';
  Chart.defaults.borderColor = 'rgba(125,180,224,0.10)';
  Chart.defaults.font.family = "'IBM Plex Mono', monospace";
  Chart.defaults.font.size = 11;
}


function toggleMode() {
  const container = document.querySelector('.dashboard-container');
  const enteringCompare = !document.body.classList.contains('split-mode');

  // ENTERING compare mode — snapshot current state so Exit can discard it
  if (enteringCompare) {
    savedState = JSON.parse(JSON.stringify(state));
    savedClientSupply = JSON.parse(JSON.stringify(CLIENT.supply));
    savedClientService = JSON.parse(JSON.stringify(CLIENT.service));
    const r = recompute();
    baselineNet = [...r.net];
  } else {
    // EXITING compare mode via header button — always DISCARD unsaved changes
    if (savedState) {
      state = JSON.parse(JSON.stringify(savedState));
      CLIENT.supply = JSON.parse(JSON.stringify(savedClientSupply));
      CLIENT.service = JSON.parse(JSON.stringify(savedClientService));
      savedState = null;
      buildVC();
      buildClientInputs();
    }
    isCompareMode = false;
    // Reset the inner Normal/Compare toggle UI
    const btnN = document.getElementById('btnNormalMode');
    const btnC = document.getElementById('btnCompareMode');
    if (btnN) { btnN.style.background = 'var(--blue)'; btnN.style.border = 'none'; btnN.style.color = 'white'; }
    if (btnC) { btnC.style.background = 'transparent'; btnC.style.border = '1px solid var(--border)'; btnC.style.color = 'var(--text)'; }
    const caBtns = document.getElementById('compareActionBtns');
    const naBtns = document.getElementById('normalActionBtns');
    if (caBtns) caBtns.style.display = 'none';
    if (naBtns) naBtns.style.display = 'flex';
  }

  // Use CSS class for transition
  container.classList.add('mode-switching');
  [chart, wfChart, costChart, revChart, outStackChart].forEach(c => { if(c) c.destroy(); });
  chart = wfChart = costChart = revChart = outStackChart = null;

  setTimeout(() => {
    document.body.classList.toggle('split-mode');

    const btn = document.getElementById('modeBtn');
    const inCompare = document.body.classList.contains('split-mode');
    if(inCompare) {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M8 17l-5-5 5-5"/><path d="M3 12h12"/></svg> Exit Compare Mode';
      btn.style.background = 'var(--surface-3)';
    } else {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg> Enter Compare Mode';
      btn.style.background = '';
    }
    // the "Save to dashboard" commit button is only relevant inside compare mode
    const sBtn = document.getElementById('saveToDashBtn');
    if(sBtn) sBtn.style.display = inCompare ? 'flex' : 'none';

    requestAnimationFrame(() => {
      container.classList.remove('mode-switching');
      render();
    });
  }, 160);
}

/* Commit the current Compare-Mode edits to the live dashboard and leave compare
   mode. By clearing the snapshot first, toggleMode's exit step keeps the edits
   instead of reverting them. Exiting via "Exit Compare Mode" (without this)
   still discards. The change is marked unsaved — click Save to persist it. */
function saveCompareToDashboard(){
  if(!document.body.classList.contains('split-mode')) return;
  savedState = null;                 // committing — exit must NOT revert
  savedClientSupply = null;
  savedClientService = null;
  toggleMode();                      // exit compare mode, keeping the current edits
  flushHistory();                    // record the commit as an undo step
  try{ localStorage.setItem('lt_cashflow_save', _serializeAll()); }catch(e){}  // explicit save
  _markDirty(false);
  showToast('save','Saved to Dashboard','Your compare-mode changes have been applied and saved.');
}

function switchTab(tab) {
  if(tab === 'vendor') {
    document.body.style.setProperty('--vendor-display', 'block');
    document.body.style.setProperty('--client-display', 'none');
    document.getElementById('tabBtnVendor').classList.add('active');
    document.getElementById('tabBtnClient').classList.remove('active');
  } else {
    document.body.style.setProperty('--vendor-display', 'none');
    document.body.style.setProperty('--client-display', 'block');
    document.getElementById('tabBtnVendor').classList.remove('active');
    document.getElementById('tabBtnClient').classList.add('active');
  }
}


/* GLOBALS & STATE */
let PROJECT_VALUE = 1000;   // Demo 300MW Solar Project — total sales / contract value (Cr)
let MARGIN = 10;
let FX_STRESS = 0;
// A37 equivalent: (1 + IDC_rate) / (1 - GM%) - 1
let SVC_MARKUP = 0;
let DC_CAPACITY = 400;       // Demo Site DC capacity (MWp)
let N=33; let MIN_N=33;
let PROJECT_MONTHS = 33;
let _skipCostRefresh = false;
let PROJECT = { startM: 8, startY: 2024 };
const M_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function minfo(m){
  const realM = (m-1) + PROJECT.startM;
  const yr = PROJECT.startY + Math.floor(realM/12);
  return { yr, name: M_NAMES[realM%12] };
}
function mlbl(m){ const x=minfo(m); return x.name+"'"+String(x.yr).slice(2); }

function setProjDate(val) {
  if(!val) return;
  const parts = val.split('-');
  PROJECT.startY = parseInt(parts[0], 10);
  PROJECT.startM = parseInt(parts[1], 10) - 1;
  render();
}

/* base vendor items */
const fxD = {currency:'INR', fcyAmt:0, baseRate:84.0, hedgeRatio:0, fwdRate:85.0, spotRate:85.0};
const BASE=[
  {key:'Cell',          cost:143.989899, credit:90,  lots:3, start:9, blMonth:9, useBlMonth:false, step:2, salesC:0,       di:null, adv:0, advStart:null, mode:'std', prMonths:3, prBasis:'lot', prPct:{}, ...fxD},
  {key:'BCD',           cost:78.247883,  credit:0,   lots:3, start:6, step:2, salesC:0,       di:null, adv:0, advStart:null, mode:'std', prMonths:3, prBasis:'lot', prPct:{}, ...fxD},
  {key:'Module',        cost:603.071258, credit:180, lots:7, start:14, step:1, salesC:839.026401, di:'Module',   adv:0, advStart:null, mode:'pr', prMonths:9, prBasis:'lot', prPct:{1:80, 2:100, 3:100, 4:100, 5:100, 6:100, 7:100, 8:15, 9:5}, ...fxD},
  {key:'Inverter',      cost:28.882777,  credit:90,  lots:5, start:10, step:1, salesC:53.701387,  di:'Inverter', adv:0, advStart:null, mode:'std', prMonths:5, prBasis:'lot', prPct:{}, ...fxD},
  {key:'BESS',          cost:0,   credit:90,  lots:2, start:8, blMonth:8, useBlMonth:false, step:2, salesC:0,       di:'BESS', adv:0, advStart:null, mode:'std', prMonths:2, prBasis:'lot', prPct:{}, ...fxD},
  {key:'BCD_BESS',      cost:0,   credit:0,   lots:2, start:8, blMonth:8, useBlMonth:false, step:2, salesC:0,       di:null, adv:0, advStart:null, mode:'std', prMonths:2, prBasis:'lot', prPct:{}, ...fxD},
  {key:'MMS',           cost:59.230652,  credit:60,  lots:6, start:7, step:1, salesC:38.490344,  di:'MMS', adv:0, advStart:null, mode:'std', prMonths:6, prBasis:'lot', prPct:{}, ...fxD},
  {key:'PowerTx',       cost:0,   credit:90,  lots:2, start:10,step:1, salesC:0,       di:'PowerTx', adv:0, advStart:null, mode:'std', prMonths:2, prBasis:'lot', prPct:{}, ...fxD},
  {key:'Cables',        cost:51.187313,  credit:90,  lots:7, start:9, step:1, salesC:59.791458,  di:'Cables', adv:0, advStart:null, mode:'std', prMonths:7, prBasis:'lot', prPct:{}, ...fxD},
  {key:'Floater',       cost:0,   credit:60,  lots:5, start:6, step:1, salesC:0,       di:'Floater', adv:0, advStart:null, mode:'std', prMonths:5, prBasis:'lot', prPct:{}, ...fxD},
  {key:'IDT',           cost:44.320913,  credit:90,  lots:5, start:10, step:1, salesC:54.850946,  di:'IDT', adv:0, advStart:null, mode:'std', prMonths:5, prBasis:'lot', prPct:{}, ...fxD},
  {key:'Other',         cost:95.197492,  credit:45,  lots:8, start:6, step:1, salesC:66.976607,  di:'Other',   adv:0, advStart:null, mode:'std', prMonths:8, prBasis:'lot', prPct:{}, ...fxD},
  {key:'Erection',      cost:11.722693,  credit:45,  lots:11,start:7, step:1, salesC:30.348205,  di:'Erection', svc:true, adv:0, advStart:null, mode:'pr', prMonths:12, prBasis:'total', prPct:{1:5,2:5,3:9,4:14,5:14,6:14,7:9,8:10,9:8,10:5,11:5,12:2}, ...fxD},
  {key:'Civil',         cost:67.615552,  credit:45,  lots:13,start:5, step:1, salesC:187.543128,    di:'Civil',    svc:true, adv:0, advStart:null, mode:'pr', prMonths:14, prBasis:'total', prPct:{1:2,2:6,3:8,4:12,5:13,6:13,7:13,8:9,9:9,10:5,11:5,12:2,13:2,14:1}, ...fxD},
  {key:'PowerEvac',     cost:0,   credit:45,  lots:7, start:14,step:1, salesC:0,       di:'PowerEvac', adv:0, advStart:null, mode:'std', prMonths:7, prBasis:'lot', prPct:{}, ...fxD},
  {key:'MandSpares',    cost:0,   credit:60,  lots:3, start:8, step:1, salesC:0,       di:'MandSpares', adv:0, advStart:null, mode:'std', prMonths:3, prBasis:'lot', prPct:{}, ...fxD},
  {key:'IDC',           cost:83.795836,  credit:0,   lots:20,start:1, step:1, salesC:0,       di:null, svc:true, adv:0, advStart:null, mode:'pr', prMonths:20, prBasis:'total', prPct:{1:1.0, 2:1.0, 3:1.0, 4:2.0, 5:3.0, 6:5.0, 7:7.0, 8:7.0, 9:7.0, 10:7.5, 11:7.5, 12:9.0, 13:9.0, 14:9.0, 15:8.5, 16:7.0, 17:2.0, 18:2.0, 19:2.5, 20:2.0}, ...fxD},
];
const IDC_FIXED={1:0.3,2:0.3,3:0.3,4:0.6,5:0.9,6:1.5,7:2.1,8:2.1,9:2.1,10:2.25,11:2.25,12:2.7,13:2.7,14:2.7,15:2.55,16:2.1,17:0.6,18:0.6,19:0.75,20:0.6};
const CIVIL_BASE={1:2,2:6,3:8,4:12,5:13,6:13,7:13,8:9,9:9,10:5,11:5,12:2,13:2,14:1};
const EREC_BASE={1:5,2:5,3:9,4:14,5:14,6:14,7:9,8:10,9:8,10:5,11:5,12:2};
BASE.find(x=>x.key==='Civil').curveBase = CIVIL_BASE;
BASE.find(x=>x.key==='Erection').curveBase = EREC_BASE;

/* Per-item credit-day negotiation bounds, derived from the credit periods actually
   recorded across the four reference project workbooks (Project-1 / Project-2 / Project-3 /
   Project-4). [min observed, max observed] — the optimiser may set an item's credit
   anywhere inside this band; it never invents terms the business hasn't seen.
   Items with no vendor-term note (customs duties, IDC financing, BESS) stay locked
   at their current value. Each item's own current credit is folded into the band so
   it is always reachable. All bounds are editable per-item in the Optimizer panel. */
const CREDIT_BOUNDS = {
  Cell:[90,90], Module:[180,180], Inverter:[90,90], MMS:[60,90], PowerTx:[90,90],
  Cables:[90,90], Floater:[90,90], IDT:[90,90], Other:[45,45], Erection:[30,45],
  Civil:[30,45], PowerEvac:[45,90], MandSpares:[60,60]
};
BASE.forEach(it=>{
  const b = CREDIT_BOUNDS[it.key];
  it.creditMin = b ? Math.min(b[0], it.credit) : it.credit;
  it.creditMax = b ? Math.max(b[1], it.credit) : it.credit;
});

const SVCS_CF=[{key:'Erection',salesC:12.51266,prog:EREC_BASE},{key:'Civil',salesC:78.928159,prog:CIVIL_BASE}];
let SVCS = SVCS_CF;

/* PROCUREMENT MODEL — detailed equipment breakdown (from procurement Excel) — Same engine as the cash-flow model; just a larger, category-grouped item set. — Terms are inherited from the matching cash-flow item; genuinely new items — start at ₹0 cost (a template for the procurement team to fill in). */
let MODEL = 'cashflow';        // 'cashflow' | 'procurement'
let ACTIVE_BASE = BASE;        // base item set for the active model
let modelStore = {};           // per-model snapshots so toggling preserves edits (reassigned on load)

const PROC_SECTIONS = [
  {section:'Module',            items:['P_Cell','P_BCD','P_Module']},
  {section:'BESS',              items:['P_BESS','P_BCDBESS']},
  {section:'Tracker',           items:['P_TrackerStruct','P_MMS']},
  {section:'Transformer',       items:['P_PowerTx','P_IDT','P_AuxDry','P_AuxOil']},
  {section:'Cables',            items:['P_LTCables','P_DCCables','P_StringCables','P_HTCables']},
  {section:'Panels',            items:['P_HTPanels','P_LTPanels']},
  {section:'Stand-Alone Items', items:['P_Inverter','P_ARCS','P_SCB','P_UPS','P_NIFPS','P_WMS','P_ESELA','P_SCADA','P_BattCharger','P_CCTV']},
  {section:'Services',          items:['P_Erection','P_Civil','P_PowerEvac','P_MandSpares','P_IDC']},
  {section:'Miscellaneous',     items:['P_Misc1','P_Misc2']},
];
const PROC_LABELS = {
  P_LTCables:'LT Cables', P_DCCables:'DC Cables', P_StringCables:'String Cables', P_HTCables:'HT Cables',
  P_BESS:'Battery Energy Storage System', P_BCDBESS:'BCD for BESS',
  P_Cell:'Cell', P_BCD:'BCD', P_Module:'Cell Tolling - Module',
  P_TrackerStruct:'Tracker structure', P_MMS:'MMS',
  P_PowerTx:'Power Transformer', P_IDT:'Inverter Duty Transformer', P_AuxDry:'Aux trafo - Dry', P_AuxOil:'Aux trafo - Oil',
  P_HTPanels:'HT Panels', P_LTPanels:'LT Panels',
  P_Inverter:'Inverters / PCS', P_ARCS:'ARCS', P_SCB:'SCB', P_UPS:'UPS with Battery', P_NIFPS:'NIFPS',
  P_WMS:'WMS', P_ESELA:'ESE LA', P_SCADA:'SCADA', P_BattCharger:'Battery charger', P_CCTV:'CCTV',
  P_Erection:'Erection', P_Civil:'Civil', P_PowerEvac:'Power Evacuation',
  P_MandSpares:'Mandatory Spares & Freight', P_IDC:'IDC and R&C',
  P_Misc1:'Miscellaneous 1', P_Misc2:'Miscellaneous 2',
};
// key -> category (for grouping the vendor controls)
const PROC_SECTION_OF = {};
PROC_SECTIONS.forEach(s => s.items.forEach(k => PROC_SECTION_OF[k] = s.section));

// Categories for the cashflow model vendor filter
const CF_CATEGORIES = [
  {cat:'Module',    keys:['Cell','BCD','Module']},
  {cat:'Inverter',  keys:['Inverter']},
  {cat:'BESS',      keys:['BESS','BCD_BESS']},
  {cat:'Tracker',   keys:['MMS']},
  {cat:'Transformer', keys:['PowerTx','IDT']},
  {cat:'Cables',    keys:['Cables']},
  {cat:'Floater',   keys:['Floater']},
  {cat:'Other Supply', keys:['Other']},
  {cat:'Civil & Erection', keys:['Erection','Civil']},
  {cat:'Power Evacuation', keys:['PowerEvac']},
  {cat:'Spares',    keys:['MandSpares']},
  {cat:'Finance',   keys:['IDC']},
];
// key -> category for cashflow model
const CF_CAT_OF = {};
CF_CATEGORIES.forEach(c => c.keys.forEach(k => CF_CAT_OF[k] = c.cat));

// Build a procurement item by inheriting terms (and optionally cost) from a cash-flow base item
function _mkProc(key, srcKey, carryCost){
  const s = BASE.find(x=>x.key===srcKey) || {};
  return { ...fxD, key,
    cost: carryCost ? (s.cost||0) : 0,
    credit: (s.credit!=null ? s.credit : 90),
    lots: s.lots || 4, start: s.start || 6, step: s.step || 1,
    blMonth: s.blMonth || s.start || 6, useBlMonth:false,
    mode: s.mode || 'std',
    prMonths: s.prMonths || s.lots || 4,
    prBasis: s.prBasis || 'lot',
    prPct: s.prPct ? {...s.prPct} : {},
    curveBase: s.curveBase || null,
    salesC:0, di: s.di !== undefined ? s.di : true, svc: s.svc || false, adv:0, advStart:null };
}
const PROC_MAP = [
  ['P_LTCables','Cables',false],['P_DCCables','Cables',false],['P_StringCables','Cables',false],['P_HTCables','Cables',false],
  ['P_BESS','BESS',true],['P_BCDBESS','BCD_BESS',true],
  ['P_Cell','Cell',true],['P_BCD','BCD',true],['P_Module','Module',true],
  ['P_TrackerStruct','MMS',false],['P_MMS','MMS',true],
  ['P_PowerTx','PowerTx',true],['P_IDT','IDT',true],['P_AuxDry','PowerTx',false],['P_AuxOil','PowerTx',false],
  ['P_HTPanels','Other',false],['P_LTPanels','Other',false],
  ['P_Inverter','Inverter',true],['P_ARCS','Other',false],['P_SCB','Other',false],['P_UPS','Other',false],
  ['P_NIFPS','Other',false],['P_WMS','Other',false],['P_ESELA','Other',false],['P_SCADA','Other',false],
  ['P_BattCharger','Other',false],['P_CCTV','Other',false],
  ['P_Erection','Erection',true],['P_Civil','Civil',true],['P_PowerEvac','PowerEvac',true],
  ['P_MandSpares','MandSpares',true],['P_IDC','IDC',true],
  ['P_Misc1','Other',false],['P_Misc2','Other',false],
];
const PROC_BASE = PROC_MAP.map(([k,src,carry]) => _mkProc(k,src,carry));
// Maps each procurement key -> its cashflow source key (for budget comparison)
const PROC_SRC_KEY = Object.fromEntries(PROC_MAP.map(([k,src]) => [k,src]));

/* ---- Backward-compatible state reconciliation ----
   A saved scenario stores a full snapshot of the item set as it existed when saved.
   When new items are later added to the code (e.g. the Miscellaneous placeholders),
   an old save would otherwise hide them — they'd be missing from the controls, the
   tables AND the exports, because everything reads from `state`. This merges a saved
   item list onto the canonical base set: every base item is kept (in canonical order),
   edited values from the save win, and items present in code but absent from the save
   are added with their default ₹0 terms. Items removed from the code are dropped. */
function reconcileState(savedState, baseSet){
  const savedByKey = {};
  (savedState||[]).forEach(it=>{ if(it && it.key) savedByKey[it.key]=it; });
  return baseSet.map(base=>{
    const sv = savedByKey[base.key];
    if(!sv) return {...base, prPct:{...base.prPct}};
    return {...base, ...sv, prPct:{...(sv.prPct || base.prPct || {})}};
  });
}

/* State variables */
let state = BASE.map(it=>({...it, prPct:{...it.prPct}}));
let isCompareMode = false;
let savedState = null;
let savedClientSupply = null;
let savedClientService = null;
let BASE_COSTS = Object.fromEntries(BASE.map(it=>[it.key, it.cost]));
let CLIENT={
  credit: 30,
  supply:{adv:15,disp:55,recv:15,erect:0,comm:2.5,compl:2.5,pg:10},
  service:{prog:85,comm:2.5,compl:2.5,pg:10},
  months:{comm:19,compl:20,pg:23}
};

// per-item overrides (for direct cell editing) — declared before the loader so a
// saved scenario can restore them, and so clearToZero() can reset them on a blank load.
let outOverrides={}, inOverrides={};

/* Swallow the benign Chart.js "Transition was aborted because of invalid state"
   rejection that fires when a chart re-renders before its 750ms entrance tween
   finishes (Reset, compare-toggle, live edits). Scoped to that exact message so
   genuine errors still surface in the console. */
window.addEventListener('unhandledrejection', function(e){
  var m = e && e.reason && (e.reason.message || e.reason);
  if(typeof m === 'string' && m.indexOf('Transition was aborted') !== -1) e.preventDefault();
});

/* Load saved scenario */
let hadSave = false;
try {
  const saved = localStorage.getItem('lt_cashflow_save');
  if(saved) {
    hadSave = true;
    const data = JSON.parse(saved);
    if(data.project) {
      PROJECT = data.project;
    }
    if(data.modelStore) {
      // New save format: full independent model store
      MODEL = data.model || 'cashflow';
      modelStore = data.modelStore;

      // Merge any items added to the code since this scenario was saved (keeps edits,
      // adds new items like the Miscellaneous placeholders at their ₹0 defaults).
      if(modelStore['cashflow'] && modelStore['cashflow'].state)
        modelStore['cashflow'].state = reconcileState(modelStore['cashflow'].state, BASE);
      if(modelStore['procurement'] && modelStore['procurement'].state)
        modelStore['procurement'].state = reconcileState(modelStore['procurement'].state, PROC_BASE);

      ACTIVE_BASE = (MODEL==='procurement') ? PROC_BASE : BASE;
      const snap = modelStore[MODEL];
      if(snap) {
        state = snap.state.map(it=>({...it, prPct:{...it.prPct}}));
        // deep-clone (not by reference) so later cell edits don't mutate the stored snapshot
        outOverrides = JSON.parse(JSON.stringify(snap.outOverrides || {}));
        inOverrides = JSON.parse(JSON.stringify(snap.inOverrides || {}));
        MARGIN = snap.margin;
        pruneOrphanOverrides();   // self-heal stale pro-rata overrides from older saves
      }
    } else if(data.state && (!data.model || data.model==='cashflow')) {
      // Legacy load format
      data.state.forEach((saved, i) => {
        if(!state[i]) return;
        const keep = ['cost','credit','adv','advStart','start','blMonth','useBlMonth','step','lots','mode','prBasis','prPct','prMonths','currency','fcyAmt','baseRate','hedgeRatio','fwdRate','spotRate'];
        keep.forEach(k => { if(saved[k] !== undefined) state[i][k] = saved[k]; });
      });
    }
    
    if(data.fxStress !== undefined) {
      FX_STRESS = data.fxStress;
    }
    if(data.client) {
      CLIENT = data.client;
      if(CLIENT.credit === undefined) CLIENT.credit = 30;
    }
    if(data.margin !== undefined) {
      MARGIN = data.margin;
    }
    if(data.projectValue !== undefined) {
      PROJECT_VALUE = data.projectValue;
    }
    if(data.projectMonths !== undefined) {
      PROJECT_MONTHS = data.projectMonths;
      MIN_N = PROJECT_MONTHS;
    }
    if(data.dcCapacity !== undefined) {
      DC_CAPACITY = data.dcCapacity;
    }

    // Batch all DOM sync into a single rAF — eliminates 8 separate setTimeout(0) calls
    // that each triggered separate style recalcs and layout passes
    requestAnimationFrame(() => {
      if(data.project) {
        const dInp = document.getElementById('projDate');
        if(dInp) {
          const mStr = (PROJECT.startM + 1).toString().padStart(2, '0');
          dInp.value = PROJECT.startY + '-' + mStr;
        }
      }
      if(data.fxStress !== undefined) {
        const el = document.getElementById('fx-stress-display');
        if(el) el.textContent = (FX_STRESS > 0 ? '+' : '') + FX_STRESS;
        const slider = document.querySelector('input[oninput*="setFxStress"]');
        if(slider) slider.value = FX_STRESS;
      }
      if(data.client) {
        const inp = document.querySelector('#ctInputs input');
        if(inp) inp.value = CLIENT.credit;
      }
      // syncKpiInputs() will handle margin, projectValue, projectMonths, dcCapacity
      syncKpiInputs();
    });
  }
} catch(e) {}

const DISP_OFF=0;

// No saved scenario → fall back to the BASE defaults (synthetic demo values).
// (Reset still zeroes everything on demand via resetAll().)
void hadSave;

// Strip any stale overrides accidentally captured on the computed Net rows (legacy
// bug where Net Inflow/Outflow/Cashflow cells were editable). These are derived rows.
['NETIN','NETOUT','NET2'].forEach(k=>{ delete outOverrides[k]; delete inOverrides[k]; });



/* Recalculate salesC only (called on every render — does NOT touch costs) */
function updateSalesC(){
  const weights = {};
  let totalWeight = 0;
  
  const K_IDC = MODEL === 'procurement' ? 'P_IDC' : 'IDC';
  const K_SPARES = MODEL === 'procurement' ? 'P_MandSpares' : 'MandSpares';
  
  const getBaseKey = (k) => {
    if (MODEL === 'cashflow') return k;
    const m = PROC_MAP.find(x => x[0] === k);
    return m ? m[1] : k;
  };
  
  const idcItem = state.find(x => x.key === K_IDC);
  const totalIdc = idcItem ? idcItem.cost:0;
  
  let totalCompCost = 0;
  state.forEach(it => {
    if (it.key !== K_IDC && it.key !== K_SPARES) totalCompCost += it.cost;
  });
  
  const idcRatio = totalCompCost > 0 ? (totalIdc / totalCompCost) : 0;

  SVC_MARKUP = MARGIN < 100 ? (1 + idcRatio) / (1 - MARGIN / 100) - 1 : 0;
  const svcMarkupEl = document.getElementById('svc-markup-val');
  if (svcMarkupEl) svcMarkupEl.textContent = (SVC_MARKUP * 100).toFixed(3) + '%';

  const sparesItem = state.find(x => x.key === K_SPARES);
  const totalSpares = sparesItem ? sparesItem.cost:0;
  const sparesTargets = ['Inverter', 'MMS', 'PowerTx', 'Cables', 'IDT', 'Other', 'PowerEvac'];
  let totalSparesBaseCost = 0;
  state.forEach(it => {
    if (sparesTargets.includes(getBaseKey(it.key))) totalSparesBaseCost += it.cost;
  });
  const sparesRatio = totalSparesBaseCost > 0 ? (totalSpares / totalSparesBaseCost) : 0;

  state.forEach(it => {
    if (it.key === K_IDC || it.key === K_SPARES) return;
    
    const bk = getBaseKey(it.key);
    const myIdc = (it.cost * idcRatio);
    const mySpares = sparesTargets.includes(bk) ? (it.cost * sparesRatio) : 0;
    let w = it.cost + myIdc + mySpares;
    
    if (bk === 'Module') {
      const cells = state.filter(x => getBaseKey(x.key) === 'Cell');
      const bcds = state.filter(x => getBaseKey(x.key) === 'BCD');
      const sumCost = arr => arr.reduce((s, c) => s + c.cost + (c.cost * idcRatio), 0);
      w += sumCost(cells) + sumCost(bcds);
    }
    
    if (bk === 'BESS') {
      const bcdBess = state.filter(x => getBaseKey(x.key) === 'BCD_BESS');
      w += bcdBess.reduce((s, c) => s + c.cost + (c.cost * idcRatio), 0);
    }
    
    if (it.di || it.svc) {
      weights[it.key] = w;
      totalWeight += w;
    }
  });

  state.forEach(it => {
    if(!it.di) return;
    if(it.key === K_SPARES) { it.salesC = 0; return; }
    it.salesC = totalWeight > 0 ? (weights[it.key] / totalWeight) * PROJECT_VALUE : 0;
  });
  

}

/* PV and Margin Logic */
function syncOtherInput(source){
  if(source==='pv' || source==='cost'){
    document.querySelectorAll('#k-gmp-input').forEach(el=>{
      if(document.activeElement !== el){ el.value = MARGIN.toFixed(2); autoSizeInput(el); }
    });
  }
}

function setMargin(v){
  let m = parseFloat(v); if(isNaN(m)) m = 0;
  MARGIN = Math.max(0, Math.min(100, m));   // margin is a 0–100% figure
  const targetTotalCost = PROJECT_VALUE * (1 - MARGIN / 100);
  const currentTotalCost = state.reduce((s,it) => s + it.cost, 0);

  // Margin proportionally scales the vendor costs you've already entered to hit the
  // target. With no costs entered yet there is nothing to scale — don't seed costs
  // from the sample template.
  if (currentTotalCost > 0) {
    const ratio = targetTotalCost / currentTotalCost;
    state.forEach(it => {
      it.cost *= ratio;
      if (it.currency === 'USD') it.fcyAmt *= ratio;
      BASE_COSTS[it.key] = it.cost;
    });
  }
  buildVC();
  render();
}

function setProjectValue(v){
  PROJECT_VALUE = Math.max(0, parseFloat(v) || 0);   // no negative contract value
  // Project Value drives total inflow only. It must NOT create or rescale vendor
  // costs — those are entered manually. Gross margin recomputes from the costs you
  // enter. (Previously this seeded sample-project costs onto a blank sheet.)
  buildVC();
  syncOtherInput('pv');
  render();
}

function setDcCapacity(v){
  let n = parseFloat(v);
  DC_CAPACITY = isNaN(n) ? 0 : Math.max(0, n);   // no negative capacity
  render();   // not auto-persisted — saved only via the Save button
}

/* Scale vendor schedule to new project duration */
function setProjectMonths(v){
  let n = parseInt(v);
  const newMonths = isNaN(n) ? 0 : Math.max(0, Math.min(120, n));
  const oldMonths = PROJECT_MONTHS || 33;
  PROJECT_MONTHS = newMonths;
  MIN_N = newMonths;
  
  rebuildSvcProg(1);
  rebuildIdcFixed(1);
  buildVC();
  render();
  
  if (N > newMonths) {
    showToast('warning', 'Timeline Clash', 'Some deliveries or payments extend to Month ' + N + ', exceeding your ' + newMonths + '-month timeline. Adjust vendor start dates manually.');
  }
}

function rebuildSvcProg(ratio){
  state.forEach(it => {
    if(it.curveBase) it.curve = it.curveBase;
    else it.curve = null;
  });
}

function rebuildIdcFixed(ratio){
  // IDC shape is now managed via pro-rata prPct directly
}

/* Compute outflow per item */
function outflowByItem(){
  const res={};
  state.forEach(it=>{
    const map={};
    if(it.mode==='pr'){
      const advCost=it.cost*(it.adv||0)/100;
      const remCost=it.cost-advCost;
      const advM = it.advStart || it.start;
      if(advCost>0 && advM>=1) map[advM]=(map[advM]||0)+advCost;
      const cm=Math.round((it.credit||0)/30);
      const n=it.prMonths||1;
      const targetSum = it.svc ? 100 : (it.lots * 100);
      for(let mo=1;mo<=n;mo++){
        const pct=targetSum>0 ? (it.prPct[mo]||0)/targetSum : 0;
        if(pct>0){
          const payM=it.start+(mo-1)*(it.step||1)+cm;
          if(payM>=1) map[payM]=(map[payM]||0)+remCost*pct;
        }
      }
    } else if(it.svc){
      const bk = it.key.startsWith('P_') ? it.key.substring(2) : it.key;
      const prog=it.curve || (bk==='Civil'?CIVIL_BASE:EREC_BASE);
      const progTot=Object.values(prog).reduce((a,b)=>a+b,0);
      const progScale=progTot>0?it.cost/progTot:1;
      const minM=Math.min(...Object.keys(prog).map(Number));
      const shift=it.start-minM;
      const cm=Math.round((it.credit||0)/30);
      for(const m in prog) {
        const newM = +m + shift + cm;
        if(newM>=1) map[newM]=(map[newM]||0)+prog[m]*progScale;
      }
    } else {
      const advCost=it.cost*(it.adv||0)/100;
      const remCost=it.cost-advCost;
      const advM2 = it.advStart || it.start;
      if(advM2>=1) map[advM2]=(map[advM2]||0)+advCost;
      const cm=Math.round((it.credit||0)/30);
      const paymentStart = (it.useBlMonth && it.blMonth) ? it.blMonth : it.start;
      if(it.curve) {
        const progTot=Object.values(it.curve).reduce((a,b)=>a+b,0);
        const progScale=progTot>0?remCost/progTot:1;
        const minM=Math.min(...Object.keys(it.curve).map(Number));
        const shift=paymentStart-minM;
        for(const m in it.curve) {
          const newM = +m + shift + cm;
          if(newM>=1) map[newM]=(map[newM]||0)+it.curve[m]*progScale;
        }
      } else if(it.vfs){
        const unit=it.lots>0 ? remCost/it.lots : 0, w=[0.8]; for(let k=0;k<it.lots-1;k++)w.push(1); w.push(0.15,0.05);
        w.forEach((wt,idx)=>{const m=paymentStart+idx*it.step+cm; if(m>=1)map[m]=(map[m]||0)+unit*wt;});
      } else {
        const pl=it.lots>0 ? remCost/it.lots : 0;
        for(let l=0;l<it.lots;l++){const m=paymentStart+l*it.step+cm; if(m>=1)map[m]=(map[m]||0)+pl;}
      }
    }
    const ov=outOverrides[it.key]||{};
    for(const m in ov) map[m]=ov[m];
    res[it.key]=map;
  });
  return res;
}

/* ---- Prune orphaned pro-rata overrides ----
   For a pro-rata item the % grid is the source of truth. An override parked in a month
   where the schedule produces NO payment (e.g. left behind after "Payment months" was
   shortened) keeps adding a phantom amount to the row total — invisible to edit because
   it sits outside the grid. Drop those on load / model-switch. In-window overrides
   (deliberate per-month fine-tuning) are kept; Standard-mode items are left untouched. */
function prPayMonths(it){
  const months=new Set();
  const pp=it.prPct||{};
  const advCost=it.cost*(it.adv||0)/100;
  if(advCost>0){ const advM=it.advStart||it.start; if(advM>=1) months.add(advM); }
  const cm=Math.round((it.credit||0)/30);
  const n=it.prMonths||1;
  for(let mo=1;mo<=n;mo++){
    if((pp[mo]||0)>0){
      const payM=it.start+(mo-1)*(it.step||1)+cm;
      if(payM>=1) months.add(payM);
    }
  }
  return months;
}
function pruneOrphanOverrides(){
  if(!Array.isArray(state)) return;
  state.forEach(it=>{
    if(!it || it.mode!=='pr') return;
    const ov=outOverrides[it.key];
    if(!ov) return;
    const valid=prPayMonths(it);
    Object.keys(ov).forEach(m=>{ if(!valid.has(+m)) delete ov[+m]; });
    if(Object.keys(ov).length===0) delete outOverrides[it.key];
  });
}

/* Delivery months per item (for shading) */
function deliveryMonthsByItem(){
  const res={};
  state.forEach(it=>{
    const months={};
    if (it.cost > 0) {
      if(it.mode==='pr'){
        // Shade DELIVERY months (no credit offset) — payments land in later columns
        const prN=it.prMonths||1;
        for(let mo=1;mo<=prN;mo++){
          if((it.prPct[mo]||0)>0){
            const newM=it.start+(mo-1)*(it.step||1);
            if(newM>=1) months[newM]=true;
          }
        }
      } else {
        for(let l=0;l<it.lots;l++){const m=it.start+l*it.step; if(m>=1)months[m]=true;}
      }
    }
    res[it.key]=months;
  });
  return res;
}

/* Compute inflow per item */
function inflowByItem(){
  const res={}, s=CLIENT.supply, mo=CLIENT.months;
  const cm=Math.round((CLIENT.credit||0)/30) + ((CLIENT.supply.erect||0)>0 ? 1 : 0);
  const svcCm=Math.round((CLIENT.credit||0)/30);
  state.forEach(it=>{
    if(!it.di) return;
    if(it.svc) {
      const C=it.salesC, sv=CLIENT.service, map={};
      const bk = it.key.startsWith('P_') ? it.key.substring(2) : it.key;
      const prog = it.curve ? it.curve : (bk==='Civil'?CIVIL_BASE:EREC_BASE);
      const progTot = Object.values(prog).reduce((a,b)=>a+b,0);
      const minM = Math.min(...Object.keys(prog).map(Number));
      const shift = it.start - minM;
      for(const m in prog) {
        const newM = +m + shift + svcCm;
        if(newM>=1) map[newM] = (map[newM]||0) + C * (sv.prog/100) * (prog[m]/progTot);
      }
      [['comm',sv.comm],['compl',sv.compl],['pg',sv.pg]].forEach(([k,p])=>{
        const mm = (mo[k]||mo.comm) + svcCm;
        if(mm>=1) map[mm] = (map[mm]||0) + C * (p/100);
      });
      const ov=inOverrides[it.key]||{};
      for(const m in ov) map[m]=ov[m];
      res[it.key]=map;
      return;
    }
    const C=it.salesC, map={};
    map[1]=(map[1]||0)+C*(s.adv/100); 
    const dr=C*((s.disp+s.recv)/100);
    const ds=it.start;
    if(it.mode==='pr'){
      const prN=it.prMonths||1;
      const targetSum = it.svc ? 100 : (it.lots * 100);
      for(let mo=1;mo<=prN;mo++){
        const pct=targetSum>0 ? (it.prPct[mo]||0)/targetSum : 0;
        if(pct>0){
          const newM=ds+(mo-1)*(it.step||1)+cm;
          if(newM>=1) map[newM]=(map[newM]||0)+dr*pct;
        }
      }
    } else if(it.curve) {
      const progTot=Object.values(it.curve).reduce((a,b)=>a+b,0);
      const minM=Math.min(...Object.keys(it.curve).map(Number));
      const shift=ds-minM;
      for(const m in it.curve) {
        const newM = +m + shift + cm;
        if(newM>=1) map[newM]=(map[newM]||0)+dr*(it.curve[m]/progTot);
      }
    } else {
      let w; if(it.vfs){w=[0.8];for(let k=0;k<it.lots-1;k++)w.push(1);w.push(0.15,0.05);}else{w=Array(it.lots).fill(1);}
      const sw=w.reduce((a,b)=>a+b,0), unit=sw>0 ? dr/sw : 0;
      w.forEach((wt,k)=>{const m=ds+k+cm; if(m>=1)map[m]=(map[m]||0)+unit*wt;});
    }
    [['erect',s.erect||0],['comm',s.comm],['compl',s.compl],['pg',s.pg]].forEach(([k,p])=>{const mm=(mo[k]||mo.comm)+cm;if(mm>=1)map[mm]=(map[mm]||0)+C*(p/100);});
    const ov=inOverrides[it.key]||{};
    for(const m in ov) map[m]=ov[m];
    res[it.key]=map;
  });


  return res;
}

/* Monthly totals */
function totals(byItem){
  const t={};
  Object.values(byItem).forEach(map=>{for(const m in map){const v=+m; t[v]=(t[v]||0)+map[m];}});
  return t;
}

/* Recompute */
function recompute(){
  updateSalesC();
  const obi=outflowByItem(), ibi=inflowByItem();

  let maxM = MIN_N;
  [obi, ibi].forEach(byItem => Object.values(byItem).forEach(map => {
    for(const m in map) {
      if(+m > maxM && Math.abs(map[m]) > 0.001) maxM = +m;
    }
  }));
  N = maxM;

  let style = document.getElementById('dyn-grid');
  if(!style) { style=document.createElement('style'); style.id='dyn-grid'; document.head.appendChild(style); }
  style.innerHTML = '.tbl { grid-template-columns: minmax(110px, 1.5fr) 45px repeat('+N+', minmax(0, 1fr)) !important; }';

  const dm=deliveryMonthsByItem();
  // Build BL months map: key -> { month -> true } for items with useBlMonth=true
  const blMonthsMap={};
  state.forEach(it=>{
    // Bill of Lading is a single event — mark only the BL month once, not every lot
    if(it.useBlMonth && it.blMonth && it.blMonth>=1){
      blMonthsMap[it.key]={[it.blMonth]:true};
    }
  });
  const ot=totals(obi), it=totals(ibi);
  let cumIn=0,cumOut=0,net=[],minNet=Infinity,minM=1; const neg=[];
  for(let m=1;m<=N;m++){
    cumIn+=it[m]||0; cumOut+=ot[m]||0; const n=cumIn-cumOut;
    net.push(n); if(n<minNet){minNet=n;minM=m;} if(n<0)neg.push({m,n});
  }
  if(!net.length) minNet=0; // empty/zeroed state — avoid Infinity leaking into KPIs
  const totalIn=Object.values(it).reduce((a,b)=>a+b,0);
  const totalOut=Object.values(ot).reduce((a,b)=>a+b,0);
  return {obi,ibi,ot,it,net,minNet,minM,neg,totalIn,totalOut,dm,blMonthsMap};
}

/* Month header row */
function headerRows(tpl){
  let yr='<div class="row">';
  yr+='<div class="hd lbl-cell hd yr">Item</div>';
  yr+='<div class="hd hd yr" style="justify-content:center">Total</div>';
  let prevYr=null;
  for(let m=1;m<=N;m++){
    const x=minfo(m);
    if(x.yr!==prevYr){
      let span=0; for(let k=m;k<=N&&minfo(k).yr===x.yr;k++) span++;
      yr+='<div class="hd hd yr" style="grid-column:span '+span+';justify-content:center">'+x.yr+'</div>';
      m+=span-1; prevYr=x.yr;
    }
  }
  yr+='</div>';
  let mr='<div class="row">';
  mr+='<div class="hd lbl-cell">—</div>';
  mr+='<div class="hd">₹ Cr</div>';
  const moComm=CLIENT.months.comm, moComp=CLIENT.months.compl, moPg=CLIENT.months.pg;
  for(let m=1;m<=N;m++){
    let tag='';
    if(m===moComm) tag='<span style="display:block;font-size:8px;font-weight:800;color:var(--blue);line-height:1;margin-bottom:1px;">COMM</span>';
    else if(m===moComp) tag='<span style="display:block;font-size:8px;font-weight:800;color:var(--blue);line-height:1;margin-bottom:1px;">COMP</span>';
    else if(m===moPg) tag='<span style="display:block;font-size:8px;font-weight:800;color:var(--blue);line-height:1;margin-bottom:1px;">PG/OAT</span>';
    const highlight = (m===moComm||m===moComp||m===moPg) ? ';background:rgba(59,130,246,.08);border-bottom:2px solid var(--blue)' : '';
    mr+='<div class="hd" style="'+highlight+'">'+tag+mlbl(m)+'</div>';
  }
  mr+='</div>';
  return yr+mr;
}

/* Render a table */
function fmt(v){ return v!=null&&isFinite(v)&&v!==0 ? v.toFixed(2) : ''; }

function round2(v) {
  if (v == null || !isFinite(v) || v === 0) return '';
  return (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);
}
function kpiFmt(v) {
  if (v == null || !isFinite(v)) return '0.00';
  return (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);
}

function renderTable(elId, rows, cellClass, allowEdit, overrides, deliveryData, blMonthsData){
  const el=document.getElementById(elId);
  let html=headerRows();

  let colSumContract = 0;

  rows.forEach(r=>{
    if(r.type==='spacer'){
      html+='<div class="row spacer-row"><div class="lbl-cell"></div><div class="cell"></div>';
      for(let m=1;m<=N;m++) html+='<div class="cell"></div>';
      html+='</div>'; return;
    }
    if(r.type==='sectionhd'){
      html+='<div class="row section-hd"><div class="lbl-cell">'+r.label+'</div>';
      html+='<div class="cell" style="justify-content:center;font-weight:700;">' + (r.contract != null && r.contract !== 0 ? fmt(r.contract) : '') + '</div>';
      for(let m=1;m<=N;m++) {
         html+='<div class="cell" style="font-weight:700;">' + (r.data && r.data[m] ? fmt(r.data[m]) : '') + '</div>';
      }
      html+='</div>'; return;
    }

    // Skip rows where all values are zero (only for normal data rows)
    const isSkippable = !r.type || (r.type !== 'total' && r.type !== 'net' && r.type !== 'gm');
    if(isSkippable && r.data) {
      const rowTotal = Object.values(r.data).reduce((s,v)=>s+(v||0), 0);
      const contractIsZero = !r.contract || r.contract === 0;
      // Also check overrides
      const hasOverride = overrides && overrides[r.key] && Object.values(overrides[r.key]).some(v => v !== 0);
      if(rowTotal === 0 && contractIsZero && !hasOverride) return;
    }


    const isTotal=r.type==='total';
    const isGM=r.type==='gm';
    const rowCls=isTotal?'tot-cell':isGM?'gm-cell':'cell';
    let contractVal = 0;
    if (r.type === 'net') {
      contractVal = r.contract || 0;
    } else if (r.data) {
      for(let m=1;m<=N;m++) contractVal += (r.data[m]||0);
    } else {
      contractVal = r.contract || 0;
    }

    if (!isTotal && r.type !== 'net' && r.key !== 'IDCIn' && !r.italic) {
      colSumContract += contractVal;
    }
    if (isTotal) {
      contractVal = colSumContract;
    }

    let cStyle = '';
    if (!isGM && r.type !== 'net' && !isTotal && r.contract !== undefined && r.data) {
      if (Math.abs(contractVal - r.contract) > 0.05) {
        cStyle = 'color:var(--red-text);font-weight:700;';
      }
    }

    html+='<div class="row'+(allowEdit&&!isTotal?' editrow':'')+(r.italic?' italic':'')+'">';
    html+='<div class="lbl-cell'+(r.italic?' italic':'')+'">'+(r.label||'')+'</div>';
    html+='<div class="'+rowCls+' contract" style="'+cStyle+'">'+(isTotal||r.type==='net'?kpiFmt(contractVal):round2(contractVal))+'</div>';

    for(let m=1;m<=N;m++){
      const raw=r.data?r.data[m]||0:0;
      // Net rows (Net Inflow/Outflow/Cashflow) are computed aggregates — never apply
      // cell overrides to them, or a stray edit corrupts a single cumulative cell.
      const v=(r.type!=='net' && overrides[r.key]&&overrides[r.key][m]!=null)?overrides[r.key][m]:raw;
      const hasVal=v>0;
      const isDelivery=deliveryData&&deliveryData[r.key]&&deliveryData[r.key][m];
      let cls=rowCls+((deliveryData?isDelivery:hasVal)&&!isTotal&&!isGM?' '+cellClass:'');
      if(isTotal) cls=(v>0?'tot-cell':'tot-cell');
      if(r.type==='net') {
        if(r.key==='NETIN') cls='cell cell-net-pos';
        else if(r.key==='NETOUT') cls='cell cell-net-neg';
        else cls=v>0?'cell cell-net-pos':'cell cell-net-neg';
      }
      const edAttr=(allowEdit&&!isTotal&&!isGM&&r.type!=='net')?'contenteditable="true" data-key="'+r.key+'" data-m="'+m+'"':'';
      const isBL = blMonthsData && blMonthsData[r.key] && blMonthsData[r.key][m];
      const blBadge = isBL ? '<span style="display:block;font-size:7px;font-weight:900;color:var(--amber);line-height:1;letter-spacing:.05em">BL</span>' : '';
      html+='<div class="'+cls+'" '+edAttr+'>'+blBadge+round2(v||0===v?v:raw)+'</div>';
    }
    html+='</div>';
  });
  el.innerHTML=html;
  if(allowEdit){
    el.querySelectorAll('[contenteditable]').forEach(cell=>{
      cell.addEventListener('blur',()=>{
        const key=cell.dataset.key, m=+cell.dataset.m;
        const val=parseFloat(cell.textContent.trim());
        if(!isNaN(val)){
          if(!overrides[key]) overrides[key]={};
          overrides[key][m]=val;
        } else if(overrides[key]){
          // Empty/invalid input clears any existing override so the computed value shows
          delete overrides[key][m];
        }
        render();
      });
      cell.addEventListener('keydown',e=>{
        if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();cell.blur();}
        if(e.key==='ArrowRight'||e.key==='Tab'){
          e.preventDefault();
          const next=cell.nextElementSibling;
          if(next&&next.hasAttribute('contenteditable')){next.focus();}
          else cell.blur();
        }
        if(e.key==='ArrowLeft'||(e.key==='Tab'&&e.shiftKey)){
          e.preventDefault();
          const prev=cell.previousElementSibling;
          if(prev&&prev.hasAttribute('contenteditable')){prev.focus();}
        }
      });
    });
  }
}

function stCost(k){ const it=state.find(x=>x.key===k); return it?it.cost:0; }
function buildOutTable(r){
  if(MODEL==='procurement') return buildOutTableProc(r);
  const {obi,ot}=r;
  const totalCost=state.reduce((s,it)=>s+it.cost,0);
  const rows=[
    {type:'sectionhd',label:'SUPPLY'},
    {key:'Cell',      label:'Cell',                    data:obi['Cell'],     contract:stCost('Cell')},
    {key:'BCD',       label:'BCD',                     data:obi['BCD'],      contract:stCost('BCD')},
    {key:'Module',    label:'Cell Tolling - Module',   data:obi['Module'],   contract:stCost('Module')},
    {key:'Inverter',  label:'Inverter',                data:obi['Inverter'], contract:stCost('Inverter')},
    {key:'BESS',      label:'BESS',                    data:obi['BESS']||{}, contract:stCost('BESS')},
    {key:'BCD_BESS',  label:'BCD for BESS',            data:obi['BCD_BESS']||{}, contract:stCost('BCD_BESS')},
    {key:'MMS',       label:'MMS - Tracker',           data:obi['MMS'],      contract:stCost('MMS')},
    {key:'PowerTx',   label:'Power Transformer',       data:obi['PowerTx']||{},  contract:stCost('PowerTx')},
    {key:'Cables',    label:'Cables',                  data:obi['Cables'],   contract:stCost('Cables')},
    {key:'Floater',   label:'Floater',                 data:obi['Floater']||{}, contract:stCost('Floater')},
    {key:'IDT',       label:'IDT',                     data:obi['IDT'],      contract:stCost('IDT')},
    {type:'spacer'},
    {key:'Other',     label:'Other Supply',            data:obi['Other'],    contract:stCost('Other')},
    {type:'spacer'},
    {type:'sectionhd',label:'SERVICES'},
    {key:'Erection',  label:'Erection',                data:obi['Erection'], contract:stCost('Erection')},
    {key:'Civil',     label:'Civil',                   data:obi['Civil'],    contract:stCost('Civil')},
    {key:'PowerEvac', label:'Power Evacuation',        data:obi['PowerEvac']||{}, contract:stCost('PowerEvac')},
    {key:'MandSpares',label:'Mandatory Spares & Freight',data:obi['MandSpares']||{}, contract:stCost('MandSpares')},
    {key:'IDC',       label:'IDC and R&C',             data:obi['IDC'],      contract:stCost('IDC')},
    {type:'total',    label:'Total',key:'TOTAL',       data:ot,              contract:totalCost},
  ];
  renderTable('tblOut', rows, 'cell-out', true, outOverrides, r.dm, r.blMonthsMap);
}

function buildInTable(r){
  if(MODEL==='procurement') return buildInTableProc(r);
  const {ibi,it}=r;
  const sc=k=>{const x=state.find(z=>z.key===k);return x?x.salesC:0;};
  const rows=[
    {type:'sectionhd',label:'SUPPLY'},
    {key:'Cell',      label:'Cell',                   data:{},              contract:0, italic:true},
    {key:'BCD',       label:'BCD',                    data:{},              contract:0, italic:true},
    {key:'Module',    label:'Cell Tolling - Module',  data:ibi['Module'],   contract:sc('Module')},
    {key:'Inverter',  label:'Inverter',               data:ibi['Inverter'], contract:sc('Inverter')},
    {key:'BESS',      label:'BESS',                   data:ibi['BESS']||{}, contract:sc('BESS')},
    {key:'BCD_BESS',  label:'BCD for BESS',           data:{},              contract:0, italic:true},
    {key:'MMS',       label:'MMS - Tracker',          data:ibi['MMS'],      contract:sc('MMS')},
    {key:'PowerTx',   label:'Power Transformer',      data:ibi['PowerTx']||{},  contract:sc('PowerTx')},
    {key:'Cables',    label:'Cables',                 data:ibi['Cables'],   contract:sc('Cables')},
    {key:'Floater',   label:'Floater',                data:ibi['Floater']||{}, contract:sc('Floater')},
    {key:'IDT',       label:'IDT',                    data:ibi['IDT'],      contract:sc('IDT')},
    {type:'spacer'},
    {key:'Other',     label:'Other Supply',           data:ibi['Other'],    contract:sc('Other')},
    {type:'spacer'},
    {type:'sectionhd',label:'SERVICES'},
    {key:'Erection',  label:'Erection',               data:ibi['Erection'], contract:sc('Erection')},
    {key:'Civil',     label:'Civil',                  data:ibi['Civil'],    contract:sc('Civil')},
    {key:'PowerEvac', label:'Power Evacuation',       data:ibi['PowerEvac']||{}, contract:sc('PowerEvac')},
    {key:'MandSpares',label:'Mandatory Spares & Freight',data:ibi['MandSpares']||{}, contract:sc('MandSpares')},
    {key:'IDCIn',     label:'IDC and R&C',            data:{},              contract:0},
    {type:'total',    label:'Total',key:'TOTALin',    data:it,              contract:r.totalIn},
    {type:'spacer'},
    {type:'net',      label:'Net Inflow',  key:'NETIN',  data:it,                       contract:r.totalIn},
    {type:'net',      label:'Net Outflow', key:'NETOUT', data:r.ot,                     contract:r.totalOut},
    {type:'net',      label:'Net Cashflow',key:'NET2',   data:buildNetRow(it, r.ot),     contract:r.totalIn-r.totalOut},
  ];
  renderTable('tblIn', rows, 'cell-in', true, inOverrides, r.dm);
}

function buildNetRow(it,ot){
  const net={};
  let ci=0,co=0;
  for(let m=1;m<=N;m++){ci+=it[m]||0;co+=ot[m]||0;net[m]=ci-co;}
  return net;
}

/* Procurement-model tables (category-grouped from PROC_SECTIONS) */
function buildOutTableProc(r){
  const {obi,ot}=r;
  const totalCost=state.reduce((s,it)=>s+it.cost,0);
  const rows=[];
  
  const supData = {}, svcData = {};
  let supContract = 0, svcContract = 0;
  
  PROC_SECTIONS.forEach(sec=>{
    sec.items.forEach(k=>{
      const cost = stCost(k);
      const data = obi[k]||{};
      if(sec.section === 'Services') {
        svcContract += cost;
        for(const m in data) svcData[m] = (svcData[m]||0) + data[m];
      } else {
        supContract += cost;
        for(const m in data) supData[m] = (supData[m]||0) + data[m];
      }
    });
  });

  rows.push({type:'sectionhd', label:'SUPPLY', data:supData, contract:supContract});
  PROC_SECTIONS.forEach(sec=>{
    if (sec.section === 'Services') {
      rows.push({type:'spacer'});
      rows.push({type:'sectionhd', label:'SERVICES', data:svcData, contract:svcContract});
    }
    sec.items.forEach(k=>rows.push({key:k, label:LABELS[k]||k, data:obi[k]||{}, contract:stCost(k)}));
  });
  rows.push({type:'total', label:'Total', key:'TOTAL', data:ot, contract:totalCost});
  renderTable('tblOut', rows, 'cell-out', true, outOverrides, r.dm, r.blMonthsMap);
}

function buildInTableProc(r){
  const {ibi,it}=r;
  const sc=k=>{const x=state.find(z=>z.key===k);return x?x.salesC:0;};
  const rows=[];
  
  const supData = {}, svcData = {};
  let supContract = 0, svcContract = 0;
  
  PROC_SECTIONS.forEach(sec=>{
    sec.items.forEach(k=>{
      const sales = sc(k);
      const data = ibi[k]||{};
      if(sec.section === 'Services') {
        svcContract += sales;
        for(const m in data) svcData[m] = (svcData[m]||0) + data[m];
      } else {
        supContract += sales;
        for(const m in data) supData[m] = (supData[m]||0) + data[m];
      }
    });
  });

  rows.push({type:'sectionhd', label:'SUPPLY', data:supData, contract:supContract});
  PROC_SECTIONS.forEach(sec=>{
    if (sec.section === 'Services') {
      rows.push({type:'spacer'});
      rows.push({type:'sectionhd', label:'SERVICES', data:svcData, contract:svcContract});
    }
    sec.items.forEach(k=>rows.push({key:k, label:LABELS[k]||k, data:ibi[k]||{}, contract:sc(k)}));
  });
  
  rows.push({type:'total', label:'Total', key:'TOTALin', data:it, contract:r.totalIn});
  rows.push({type:'spacer'});
  rows.push({type:'net', label:'Net Inflow',  key:'NETIN',  data:it,   contract:r.totalIn});
  rows.push({type:'net', label:'Net Outflow', key:'NETOUT', data:r.ot, contract:r.totalOut});
  rows.push({type:'net', label:'Net Cashflow',key:'NET2',   data:buildNetRow(it, r.ot), contract:r.totalIn-r.totalOut});
  renderTable('tblIn', rows, 'cell-in', true, inOverrides, r.dm);
}

/* ---- Cashflow ↔ Procurement budget reconciliation ----
   The Cashflow model holds one cost per category (e.g. Cables ₹53.63 Cr). The
   Procurement model splits some of those into sub-types (Cables → LT/DC/String/HT).
   This panel shows, per cashflow category, the cashflow budget (target) vs the sum
   the SCM team has allocated across its sub-items, and flags any drift. */
const CF_KEY_LABEL = {
  Cell:'Cell', BCD:'BCD', Module:'Cell Tolling - Module', Inverter:'Inverter',
  BESS:'BESS', BCD_BESS:'BCD for BESS', MMS:'MMS / Tracker', PowerTx:'Power Transformer',
  Cables:'Cables', Floater:'Floater', IDT:'Inverter Duty Transformer', Other:'Other Supply',
  Erection:'Erection', Civil:'Civil', PowerEvac:'Power Evacuation',
  MandSpares:'Mandatory Spares & Freight', IDC:'IDC and R&C',
};
// Cashflow cost per key — from the live cashflow state, the snapshot, or BASE.
function _cfCostMap(){
  let src;
  if(MODEL==='cashflow') src=state;
  else if(modelStore['cashflow'] && modelStore['cashflow'].state) src=modelStore['cashflow'].state;
  else src=BASE;
  const m={}; src.forEach(it=>{ m[it.key]=(it.cost||0); }); return m;
}
function renderProcRecon(){
  const host=document.getElementById('procRecon');
  if(!host) return;
  if(MODEL!=='procurement'){ host.style.display='none'; host.innerHTML=''; return; }

  const cf=_cfCostMap();
  // group procurement items by their cashflow source key, preserving PROC_MAP order
  const order=[], groups={};
  PROC_MAP.forEach(([pk,src])=>{ if(!groups[src]){ groups[src]=[]; order.push(src); } groups[src].push(pk); });

  const f=v=>v.toFixed(2);
  let totTarget=0, totAlloc=0, anyDrift=false;
  let body='';
  order.forEach(src=>{
    const pks=groups[src];
    const target=cf[src]||0;
    const allocated=pks.reduce((s,pk)=>s+stCost(pk),0);
    totTarget+=target; totAlloc+=allocated;
    if(Math.abs(target)<0.005 && Math.abs(allocated)<0.005) return; // skip empty categories
    const diff=allocated-target;
    const ok=Math.abs(diff)<0.05;
    if(!ok) anyDrift=true;
    const isSplit=pks.length>1;
    const status = ok
      ? '<span style="color:var(--green-text);font-weight:700">✓ matched</span>'
      : '<span style="color:var(--red-text);font-weight:700">'+(diff>0?'▲ over by ':'▼ under by ')+f(Math.abs(diff))+'</span>';
    const subLine = isSplit
      ? '<div style="font-size:10px;color:var(--muted);margin-top:2px">'+pks.map(pk=>(PROC_LABELS[pk]||pk)).join(' · ')+'</div>'
      : '';
    body+='<tr style="border-top:1px solid var(--border)">'+
      '<td style="padding:6px 10px">'+(CF_KEY_LABEL[src]||src)+(isSplit?' <span style="font-size:10px;color:var(--blue);font-weight:700">('+pks.length+' types)</span>':'')+subLine+'</td>'+
      '<td style="padding:6px 10px;text-align:right;font-family:monospace">'+f(target)+'</td>'+
      '<td style="padding:6px 10px;text-align:right;font-family:monospace;font-weight:700">'+f(allocated)+'</td>'+
      '<td style="padding:6px 10px;text-align:right;font-family:monospace;color:'+(ok?'var(--muted)':(diff>0?'var(--red-text)':'var(--amber)'))+'">'+(diff>=0?'+':'')+f(diff)+'</td>'+
      '<td style="padding:6px 10px;text-align:right">'+status+'</td>'+
    '</tr>';
  });
  const gOk=Math.abs(totAlloc-totTarget)<0.05;
  // Hide the panel entirely when everything reconciles — only show when action is needed
  if(!anyDrift){ host.style.display='none'; host.innerHTML=''; return; }
  host.style.display='';
  const banner = '<span style="color:var(--red-text)">⚠ Some categories don\'t reconcile to the cashflow budget — adjust the highlighted sub-items.</span>';

  host.innerHTML =
    '<div class="card" style="margin-bottom:16px">'+
      '<div class="card-title">Cashflow ↔ Procurement budget reconciliation</div>'+
      '<div class="card-note">'+banner+'</div>'+
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'+
        '<thead><tr style="color:var(--muted);text-transform:uppercase;font-size:10px;letter-spacing:.05em">'+
          '<th style="padding:6px 10px;text-align:left">Category</th>'+
          '<th style="padding:6px 10px;text-align:right">Cashflow budget (₹ Cr)</th>'+
          '<th style="padding:6px 10px;text-align:right">Allocated in SCM (₹ Cr)</th>'+
          '<th style="padding:6px 10px;text-align:right">Δ</th>'+
          '<th style="padding:6px 10px;text-align:right">Status</th>'+
        '</tr></thead><tbody>'+body+'</tbody>'+
        '<tfoot><tr style="border-top:2px solid var(--border);font-weight:800">'+
          '<td style="padding:8px 10px">Total</td>'+
          '<td style="padding:8px 10px;text-align:right;font-family:monospace">'+f(totTarget)+'</td>'+
          '<td style="padding:8px 10px;text-align:right;font-family:monospace">'+f(totAlloc)+'</td>'+
          '<td style="padding:8px 10px;text-align:right;font-family:monospace;color:'+(gOk?'var(--muted)':'var(--red-text)')+'">'+((totAlloc-totTarget)>=0?'+':'')+f(totAlloc-totTarget)+'</td>'+
          '<td style="padding:8px 10px;text-align:right">'+(gOk?'<span style="color:var(--green-text)">✓</span>':'<span style="color:var(--red-text)">⚠</span>')+'</td>'+
        '</tr></tfoot>'+
      '</table></div>'+
    '</div>';
  host.style.display='block';
}

/* Chart */
let chart, wfChart, costChart, revChart, outStackChart;
let baselineNet = null;
const PALETTE_DARK = ['#3d8bff', '#2fd6a6', '#f6a93b', '#ff6b63', '#9f8fff', '#38c6e0', '#ffd166', '#f78fb3', '#8ad36b', '#5ad0c0', '#9bb6d0'];
const PALETTE_LIGHT = ['#1f6fe0', '#0f9b73', '#d2860f', '#d23b36', '#6d4fd6', '#1597b8', '#b8881a', '#cf5b8a', '#5a9e35', '#1f9e8e', '#5d7691'];
let PALETTE = PALETTE_DARK;

function themeIsLight(){ return document.body.classList.contains('light'); }
function themeColors(){
  if(themeIsLight()){
    return {tick:'#5d7691', grid:'rgba(20,60,100,0.10)',
      netLine:'#0f7f5e', netFill:'rgba(18,168,122,0.12)', baseline:'rgba(15,127,94,0.40)',
      inflowBar:'rgba(31,111,224,0.45)', outflowBar:'rgba(200,119,17,0.50)',
      pos:'#0f7f5e', neg:'#d23b36', zeroLine:'rgba(226,59,54,0.50)',
      // semantic flows: revenue/inflow=blue, cost/outflow=amber, margin=green
      wfRev:'rgba(31,111,224,0.82)', wfCost:'rgba(200,119,17,0.82)', wfMargin:'rgba(15,127,94,0.85)',
      costBar:'rgba(200,119,17,0.85)', revBar:'rgba(31,111,224,0.82)', markerLine:'#0f7f5e',
      sliceBorder:'#ffffff'};
  }
  return {tick:'#8ba8c4', grid:'rgba(125,180,224,0.10)',
    netLine:'#2fd6a6', netFill:'rgba(47,214,166,0.10)', baseline:'rgba(47,214,166,0.35)',
    inflowBar:'rgba(61,139,255,0.50)', outflowBar:'rgba(246,169,59,0.50)',
    pos:'#2fd6a6', neg:'#ff5e57', zeroLine:'rgba(255,94,87,0.50)',
    // semantic flows: revenue/inflow=blue, cost/outflow=amber, margin=green
    wfRev:'rgba(61,139,255,0.82)', wfCost:'rgba(246,169,59,0.82)', wfMargin:'rgba(47,214,166,0.82)',
    costBar:'rgba(246,169,59,0.85)', revBar:'rgba(61,139,255,0.82)', markerLine:'#2fd6a6',
    sliceBorder:'#0e2335'};
}

function applyTheme(light){
  document.body.classList.toggle('light', light);
  PALETTE = light ? PALETTE_LIGHT : PALETTE_DARK;
  const btn = document.getElementById('themeBtn');
  if(btn){
    const lab = btn.querySelector('.theme-label'); if(lab) lab.textContent = light ? 'Dark mode' : 'Light mode';
    const sun = btn.querySelector('.theme-ico-sun'); if(sun) sun.style.display = light ? 'none' : '';
    const moon = btn.querySelector('.theme-ico-moon'); if(moon) moon.style.display = light ? '' : 'none';
  }
}

function toggleTheme(){
  const light = !document.body.classList.contains('light');
  [chart, wfChart, costChart, revChart, outStackChart].forEach(c=>{ if(c) c.destroy(); });
  chart = wfChart = costChart = revChart = outStackChart = null;
  applyTheme(light);
  /* bridge to the shared suite theme (syncs launcher + sibling tools) */
  try{ if(window.LTTheme) LTTheme.set(light ? 'light' : 'dark'); else localStorage.setItem('lt_theme', light ? 'light' : 'dark'); }catch(e){}
  render();
}

/* keep cashflow in lock-step when the theme is toggled elsewhere
   (launcher or a sibling tool, via the shared localStorage key) */
window.addEventListener('storage', function(e){
  if(e.key !== 'lt-suite-theme' || !window.LTTheme) return;
  var light = (LTTheme.current() === 'light');
  if(light === document.body.classList.contains('light')) return;
  try{ [chart, wfChart, costChart, revChart, outStackChart].forEach(function(c){ if(c) c.destroy(); });
       chart = wfChart = costChart = revChart = outStackChart = null; }catch(_){}
  applyTheme(light);
  try{ render(); }catch(_){}
});

/* Direct annotation of the funding trough on the cumulative-balance line.
   Clones the proven zero-line afterDraw pattern; reads live min off chart.$minMarker. */
const _cfMinMarker = {
  id:'cfMinMarker',
  afterDatasetsDraw(c){
    const m = c.$minMarker; if(!m) return;
    const a = c.scales && c.scales.x && c.scales.y; if(!a) return;
    const px = c.scales.x.getPixelForValue(m.m - 1);
    const py = c.scales.y.getPixelForValue(m.net);
    if(!isFinite(px) || !isFinite(py)) return;
    const T2 = themeColors();
    const col = m.net < 0 ? T2.neg : T2.pos;
    const ctx = c.ctx, top = c.chartArea.top;
    ctx.save();
    ctx.strokeStyle = col; ctx.globalAlpha = .30; ctx.setLineDash([3,3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, py); ctx.stroke();
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.shadowColor = col; ctx.shadowBlur = 14;   // soft glow draws the eye to the trough
    ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI*2); ctx.fillStyle = col; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2; ctx.strokeStyle = T2.sliceBorder; ctx.stroke();
    const txt = (m.net < 0 ? 'Peak funding ₹' : 'Min ₹') + Math.abs(m.net).toFixed(1) + ' Cr';
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    const tw = ctx.measureText(txt).width;
    let lx = px + 9, ly = py - 12;
    if(lx + tw + 8 > c.chartArea.right) lx = px - tw - 11;
    if(ly < top + 12) ly = py + 20;
    ctx.fillStyle = col; ctx.textBaseline = 'middle';
    ctx.fillText(txt, lx, ly);
    ctx.restore();
  }
};

function _hexToRgb(h){
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h||'');
  return m ? (parseInt(m[1],16)+','+parseInt(m[2],16)+','+parseInt(m[3],16)) : '47,214,166';
}
// Soft vertical area gradient under a line: colour → transparent. Falls back to a
// flat fill until Chart.js has measured the plot area (first frame before layout).
function _areaGradient(c, hex, topAlpha){
  const rgb = _hexToRgb(hex); const area = c.chartArea; const ctx = c.ctx;
  if(!area) return 'rgba('+rgb+','+(topAlpha*0.5)+')';
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, 'rgba('+rgb+','+topAlpha+')');
  g.addColorStop(1, 'rgba('+rgb+',0)');
  return g;
}
// Faint vertical guide that tracks the hovered month across the cash-flow chart.
const _crosshair = {
  id:'crosshair',
  afterDraw(c){
    const act = c.tooltip && c.tooltip.getActiveElements && c.tooltip.getActiveElements();
    if(!act || !act.length) return;
    const x = act[0].element.x; const {top,bottom} = c.chartArea;
    const ctx = c.ctx, T2 = themeColors();
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom);
    ctx.lineWidth = 1; ctx.strokeStyle = T2.tick; ctx.globalAlpha = .35; ctx.setLineDash([3,4]);
    ctx.stroke(); ctx.restore();
  }
};
function _reducedMotion(){ try{ return matchMedia('(prefers-reduced-motion:reduce)').matches; }catch(e){ return false; } }

function renderChart(r){
  const T = themeColors();
  if(window.Chart){ Chart.defaults.color = T.tick; Chart.defaults.borderColor = T.grid; }
  const labels=Array.from({length:N},(_,i)=>mlbl(i+1));
  const net=r.net;
  if(baselineNet === null) baselineNet = [...net];

  const colors=net.map(n=>n<0?T.neg:T.pos);
  const inArr=Array.from({length:N},(_,i)=>r.it[i+1]||0);
  const outArr=Array.from({length:N},(_,i)=>r.ot[i+1]||0);
  
  if(!chart){
    const zl={id:'zl',afterDraw(c){const{ctx,chartArea:{left,right},scales:{y}}=c;
      const py=y.getPixelForValue(0);ctx.save();ctx.strokeStyle=T.zeroLine;
      ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(right,py);ctx.stroke();ctx.restore();}};
    chart=new Chart(document.getElementById('cfChart'),{
      type:'bar',
      data:{labels,datasets:[
        {type:'line',label:'Cumulative Balance',data:net,borderColor:T.netLine,
         backgroundColor:(ctx)=>_areaGradient(ctx.chart, themeColors().netLine, 0.30),
         fill:true,tension:.2,borderWidth:3,pointRadius:net.map(n=>n<0?4:0),pointBackgroundColor:colors,order:0},
        {type:'line',label:'Baseline',data:baselineNet,borderColor:T.baseline,borderDash:[5,5],
         fill:false,tension:.2,borderWidth:2,pointRadius:0,hidden:!(isCompareMode||_scenarioGhost),order:1},
        {type:'bar',label:'Inflow',data:inArr,backgroundColor:T.inflowBar,order:2},
        {type:'bar',label:'Outflow',data:outArr,backgroundColor:T.outflowBar,order:2},
      ]},
      options:{responsive:true,maintainAspectRatio:false,
        animation:{duration:_reducedMotion()?0:750,easing:'easeOutQuart'},
        plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:12,font:{size:11}}},tooltip:{mode:'index',intersect:false,callbacks:{label:c=>c.dataset.label+': ₹'+c.parsed.y.toFixed(2)+' Cr'}}},
        scales:{y:{title:{display:true,text:'₹ Cr'},grid:{color:'rgba(128,128,128,.1)'}},
          x:{ticks:{autoSkip:true,maxTicksLimit:12},grid:{display:false}}}},
      plugins:[zl, _cfMinMarker, _crosshair]
    });
  } else {
    chart.data.labels=labels;
    chart.data.datasets[0].data=net; chart.data.datasets[0].pointRadius=net.map(n=>n<0?4:0);
    chart.data.datasets[0].pointBackgroundColor=colors;
    chart.data.datasets[1].data=baselineNet;
    chart.data.datasets[1].hidden = !(isCompareMode||_scenarioGhost); // Toggle baseline visibility
    chart.data.datasets[1].label = _scenarioGhost ? ('vs '+_ghostLabel) : 'Baseline';
    chart.data.datasets[2].data=inArr; chart.data.datasets[3].data=outArr;
    chart.update('none');   // live edits stay instant; the entrance tween only plays on (re)create
  }
  // feed the live trough to the annotation plugin + keep the SR label current
  chart.$minMarker = { m:r.minM, net:r.minNet };
  const cfCanvas = document.getElementById('cfChart');
  if(cfCanvas) cfCanvas.setAttribute('aria-label',
    'Net cash flow by month. The cumulative cash balance line reaches its lowest point of ₹'
    + r.minNet.toFixed(1) + ' crore' + (r.minNet < 0 ? ' (a funding shortfall)' : '')
    + ' in ' + mlbl(r.minM) + '. Monthly inflow and outflow are shown as bars.');

  const wfLabels = ['Revenue', 'Costs', 'Margin'];
  const wfData = [ r.totalIn, r.totalOut, r.totalIn - r.totalOut ];
  const wfBg = [T.wfRev, T.wfCost, T.wfMargin];
  if(!wfChart){
    wfChart=new Chart(document.getElementById('wfChart'),{
      type:'bar',
      data:{labels:wfLabels,datasets:[{data:wfData,backgroundColor:wfBg}]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'₹'+c.raw.toFixed(2)+' Cr'}}},
        scales:{y:{title:{display:true,text:'₹ Cr'},grid:{color:'rgba(128,128,128,.1)'}},x:{grid:{display:false}}}}
    });
  } else {
    wfChart.data.datasets[0].data=wfData;
    wfChart.update('none');
  }

  const costItems = state.filter(it=>it.cost>0).sort((a,b)=>b.cost-a.cost);
  const costLabels = costItems.map(it=>LABELS[it.key]||it.key);
  const costData = costItems.map(it=>it.cost);
  // Cost breakdown as a sorted horizontal bar: common baseline + length beats ranking 17 pie wedges.
  // Build SEPARATE capped arrays — costItems/costData are shared with the outflow stack below.
  let costBarLabels = costLabels, costBarData = costData;
  if(costLabels.length > 9){
    costBarLabels = costLabels.slice(0,8).concat(['Other ('+(costLabels.length-8)+')']);
    costBarData = costData.slice(0,8).concat([costData.slice(8).reduce((a,b)=>a+b,0)]);
  }
  const catBarScales = {x:{grid:{color:'rgba(128,128,128,.1)'},title:{display:true,text:'₹ Cr'}},
    y:{grid:{display:false},ticks:{font:{size:10},autoSkip:false}}};
  if(!costChart){
    costChart=new Chart(document.getElementById('costChart'),{
      type:'bar',
      data:{labels:costBarLabels,datasets:[{label:'Cost',data:costBarData,backgroundColor:T.costBar,borderRadius:3,borderWidth:0,maxBarThickness:20}]},
      options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' ₹'+c.raw.toFixed(2)+' Cr'}}},
        scales:catBarScales}
    });
  } else {
    costChart.data.labels=costBarLabels;
    costChart.data.datasets[0].data=costBarData;
    costChart.data.datasets[0].backgroundColor=T.costBar;
    costChart.update('none');
  }

  const supTotal = state.filter(x=>x.cost>0 && !x.svc).reduce((s,x)=>s+(x.salesC||0),0);
  const svcTotal = state.filter(x=>x.di && x.svc && x.key !== (MODEL==='procurement'?'P_IDC':'IDC')).reduce((s,x)=>s+(x.salesC||0),0);
  const cs = CLIENT.supply;
  const revLabels = ['Advance', 'Dispatch', 'Receipt', 'Erection', 'Milestones', 'Services'];
  const revData = [ supTotal*(cs.adv/100), supTotal*(cs.disp/100), supTotal*(cs.recv/100), supTotal*((cs.erect||0)/100), supTotal*((cs.comm+cs.compl+cs.pg)/100), svcTotal ];
  if(!revChart){
    revChart=new Chart(document.getElementById('revChart'),{
      type:'bar',
      data:{labels:revLabels,datasets:[{label:'Revenue',data:revData,backgroundColor:T.revBar,borderRadius:3,borderWidth:0,maxBarThickness:20}]},
      options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' ₹'+c.raw.toFixed(2)+' Cr'}}},
        scales:catBarScales}
    });
  } else {
    revChart.data.datasets[0].data=revData;
    revChart.data.datasets[0].backgroundColor=T.revBar;
    revChart.update('none');
  }

  let startIdx = 0; let endIdx = N;
  const sEl = document.getElementById('outMonthFilter');
  if(sEl){
    if(sEl.options.length - 1 !== N) {
       const curVal = sEl.value;
       sEl.innerHTML = '<option value="all">All Months</option>';
       for(let m=1; m<=N; m++) {
         const opt = document.createElement('option');
         opt.value = m;
         opt.textContent = 'Month ' + m + ' (' + mlbl(m) + ')';
         sEl.appendChild(opt);
       }
       sEl.value = curVal;
       if(!sEl.value) sEl.value = 'all';
    }
    if(sEl.value !== 'all') {
      const mNum = parseInt(sEl.value);
      if(mNum >= 1 && mNum <= N) {
        startIdx = mNum - 1;
        endIdx = mNum;
      }
    }
  }
  const outLabels = labels.slice(startIdx, endIdx);

  const stackDatasets = costItems.map((it, i) => {
    return {
      label: LABELS[it.key]||it.key,
      data: Array.from({length:N}, (_,m) => r.obi[it.key] ? (r.obi[it.key][m+1]||0) : 0).slice(startIdx, endIdx),
      backgroundColor: PALETTE[i%PALETTE.length],
      stack: 'Stack 0'
    };
  });
  if(!outStackChart){
    outStackChart=new Chart(document.getElementById('outStackChart'),{
      type:'bar',
      data:{labels:outLabels,datasets:stackDatasets},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:12,font:{size:10}}},tooltip:{mode:'index',intersect:false,callbacks:{label:function(c){if(c.raw>0) return c.dataset.label+': ₹'+c.raw.toFixed(2)+' Cr';}}}},
        scales:{y:{stacked:true,title:{display:true,text:'₹ Cr'},grid:{color:'rgba(128,128,128,.1)'}},x:{stacked:true,grid:{display:false}}}}
    });
  } else {
    outStackChart.data.labels=outLabels;
    outStackChart.data.datasets=stackDatasets;
    outStackChart.update('none');
  }
}

/* KPIs + banners */
function animateNumber(id, newValue, prefix='', suffix='', duration=600) {
  const el = document.getElementById(id);
  if (!el) return;
  const oldValAttr = el.getAttribute('data-val');
  const start = oldValAttr ? parseFloat(oldValAttr) : 0;
  el.setAttribute('data-val', newValue);
  
  if (start === newValue) {
    el.textContent = prefix + kpiFmt(newValue) + suffix;
    return;
  }
  
  const startTime = performance.now();
  function update(time) {
    const elapsed = time - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = progress * (2 - progress); // ease-out quad
    const current = start + (newValue - start) * ease;
    el.textContent = prefix + kpiFmt(current) + suffix;
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = prefix + kpiFmt(newValue) + suffix;
    }
  }
  requestAnimationFrame(update);
}

function renderKPIs(r){
  syncKpiInputs();
  const gm=r.totalIn-r.totalOut;
  animateNumber('k-in', r.totalIn, '₹');
  animateNumber('k-out', r.totalOut, '₹');
  animateNumber('k-gm', gm, '₹');
  const lo=document.getElementById('k-low');
  lo.className='val '+(r.minNet<0?'neg':'pos');
  animateNumber('k-low', r.minNet, '₹');
  document.getElementById('k-tight').textContent=mlbl(r.minM);
  animateNumber('vendor-margin-display', MARGIN);
  const warn=document.getElementById('warn'), ok=document.getElementById('okmsg');
  if(r.neg.length){
    warn.style.display='block'; ok.style.display='none';
    const worst=r.neg.reduce((a,b)=>b.n<a.n?b:a);
    // Group consecutive negative months into ranges so non-contiguous gaps read correctly
    // e.g. "Sep'24–Oct'24, Mar'25" instead of a misleading "Sep'24 – Mar'25" span.
    const months=r.neg.map(x=>x.m).sort((a,b)=>a-b);
    const ranges=[]; let s=months[0], p=months[0];
    for(let k=1;k<months.length;k++){
      if(months[k]===p+1){ p=months[k]; }
      else { ranges.push([s,p]); s=p=months[k]; }
    }
    ranges.push([s,p]);
    const rangeStr=ranges.map(([a,b])=>a===b?mlbl(a):mlbl(a)+'–'+mlbl(b)).join(', ');
    warn.textContent='⚠ Net cash negative in '+r.neg.length+' month'+(r.neg.length>1?'s':'')+
      ' ('+rangeStr+'). Worst: ₹'+Math.abs(worst.n).toFixed(2)+' Cr shortfall in '+mlbl(worst.m)+'.';
  } else {
    warn.style.display='none'; ok.style.display='block';
    ok.textContent='✓ Net cash positive across all '+N+' months. Lowest ₹'+r.minNet.toFixed(2)+' Cr in '+mlbl(r.minM)+'.';
  }
  // Single screen-reader announcement per recompute (the visible tiles tween every frame,
  // which would otherwise spam assistive tech — so we announce only the settled summary here).
  const ann=document.getElementById('kpiAnnounce');
  if(ann){
    const verdict = r.neg.length
      ? ('Warning: net cash negative in '+r.neg.length+' month'+(r.neg.length>1?'s':'')+'.')
      : ('Net cash positive across all '+N+' months.');
    ann.textContent = 'Inflow ₹'+r.totalIn.toFixed(1)+' crore, outflow ₹'+r.totalOut.toFixed(1)
      +' crore, gross margin ₹'+gm.toFixed(1)+' crore. Lowest net cash ₹'+r.minNet.toFixed(1)
      +' crore in '+mlbl(r.minM)+'. '+verdict;
  }
}

function _doRender(){
  const r=recompute();
  renderKPIs(r); renderChart(r); buildOutTable(r); buildInTable(r); renderProcRecon();
  updateModelButton();   // keep the Cashflow/Procurement toggle in sync (incl. on initial load)
  // Keep milestone month calendar labels in sync
  ['comm','compl','pg'].forEach(k=>{
    const lbl=document.getElementById('lbl-mo-'+k);
    if(lbl) lbl.textContent=mlbl(CLIENT.months[k]);
  });
  // Update milestone KPI bar
  const kComm=document.getElementById('k-comm-lbl');
  const kComp=document.getElementById('k-comp-lbl');
  const kPg=document.getElementById('k-pg-lbl');
  if(kComm) kComm.textContent=mlbl(CLIENT.months.comm);
  if(kComp) kComp.textContent=mlbl(CLIENT.months.compl);
  if(kPg)   kPg.textContent=mlbl(CLIENT.months.pg);
  if(!_skipCostRefresh){
    state.forEach((it,i)=>{
      const inp=document.getElementById('vc-p'+i);
      if(inp && document.activeElement !== inp) inp.value=it.cost.toFixed(2);
      const lbl=document.getElementById('vc-cost-lbl'+i);
      if(lbl) lbl.textContent='₹'+it.cost.toFixed(2)+' Cr';
    });
  }
  if(typeof captureHistory==='function') captureHistory();   // debounced undo checkpoint
}

let _vtInteracting = false;
function render(){
  // Use the View Transitions crossfade only for discrete actions (button clicks,
  // mode / theme / tab switches). While the user is actively dragging a slider or
  // typing into a field, render directly so feedback stays instant — wrapping every
  // 120ms input tick in a 0.35s page-wide crossfade is what made it feel laggy.
  const ae = document.activeElement;
  const editing = _vtInteracting ||
    (ae && ae.matches && ae.matches('input[type=range],input[type=number],[contenteditable="true"]'));
  if (document.startViewTransition && !editing) {
    document.startViewTransition(() => _doRender());
  } else {
    _doRender();
  }
}
// Suppress the crossfade for the whole duration of a slider drag (pointer held down).
document.addEventListener('pointerdown', e=>{
  if(e.target && e.target.matches && e.target.matches('input[type=range]')) _vtInteracting=true;
}, true);
document.addEventListener('pointerup', ()=>{ _vtInteracting=false; }, true);
document.addEventListener('pointercancel', ()=>{ _vtInteracting=false; }, true);

/* Client term inputs */
function buildClientInputs(){
  const s=CLIENT.supply, sv=CLIENT.service, mo=CLIENT.months;
  const sFields=[['adv','Advance (M1)'],['disp','Against dispatch'],['recv','Receipt at site'],['erect','Erection & Testing'],['comm','Commissioning'],['compl','Completion'],['pg','PG/OAT Test']];
  const svFields=[['prog','Progress billed'],['comm','Commissioning'],['compl','Completion'],['pg','PG/OAT Test']];
  
  document.getElementById('ctInputs').innerHTML=
    '<div class="ct-item"><label>Credit period</label><div class="row2"><input type="number" min="0" max="180" step="15" value="'+(CLIENT.credit||0)+'" oninput="setCCredit(this.value)"> days</div></div>'+
    '<div style="grid-column:1/-1;font-weight:600;font-size:12px;color:var(--text);margin-bottom:-5px;border-top:1px solid var(--border);padding-top:15px">Supply terms (%)</div>'+
    sFields.map(([k,l])=>
      '<div class="ct-item"><label>'+l+'</label><div class="row2">'+
      '<input type="number" min="0" max="100" step="0.5" value="'+s[k]+'" oninput="setC(\'supply\',\''+k+'\',this.value)">%</div></div>'
    ).join('') +
    '<div style="grid-column:1/-1;font-weight:600;font-size:12px;color:var(--text);margin:10px 0 -5px;border-top:1px solid var(--border);padding-top:15px">Service terms (%)</div>'+
    svFields.map(([k,l])=>
      '<div class="ct-item"><label>'+l+'</label><div class="row2">'+
      '<input type="number" min="0" max="100" step="0.5" value="'+sv[k]+'" oninput="setC(\'service\',\''+k+'\',this.value)">%</div></div>'
    ).join('');

  document.getElementById('ctInputs2').innerHTML=
    '<div class="ct-item"><label>Commissioning month</label><div class="row2"><input type="number" min="1" value="'+mo.comm+'" oninput="setMo(\'comm\',this.value)" style="width:56px"><span style="margin-left:6px;font-size:12px;font-weight:600;color:var(--blue)" id="lbl-mo-comm">'+mlbl(mo.comm)+'</span></div></div>'+
    '<div class="ct-item"><label>Completion month</label><div class="row2"><input type="number" min="1" value="'+mo.compl+'" oninput="setMo(\'compl\',this.value)" style="width:56px"><span style="margin-left:6px;font-size:12px;font-weight:600;color:var(--blue)" id="lbl-mo-compl">'+mlbl(mo.compl)+'</span></div></div>'+
    '<div class="ct-item"><label>PG/OAT Test month</label><div class="row2"><input type="number" min="1" value="'+mo.pg+'" oninput="setMo(\'pg\',this.value)" style="width:56px"><span style="margin-left:6px;font-size:12px;font-weight:600;color:var(--blue)" id="lbl-mo-pg">'+mlbl(mo.pg)+'</span></div></div>';
  updateCSum();
}
function updateCSum(){
  const s=CLIENT.supply, ts=s.adv+s.disp+s.recv+(s.erect||0)+s.comm+s.compl+s.pg;
  const sv=CLIENT.service, tsv=sv.prog+sv.comm+sv.compl+sv.pg;
  const el=document.getElementById('csum');
  let txt='Supply: '+ts.toFixed(1)+'% '+(Math.abs(ts-100)<0.05?'✓':'⚠');
  txt+=' &nbsp;|&nbsp; Service: '+tsv.toFixed(1)+'% '+(Math.abs(tsv-100)<0.05?'✓':'⚠');
  el.innerHTML=txt;
  el.style.color=(Math.abs(ts-100)<0.05 && Math.abs(tsv-100)<0.05)?'var(--green-text)':'var(--red-text)';
}
function setC(g,k,v){CLIENT[g][k]=parseFloat(v)||0;updateCSum();render();}
function setAdvStart(i,v){
  const it=state[i];
  const m=parseInt(v)||it.start;
  it.advStart=m;
  // Update the calendar label immediately
  const lbl=document.getElementById('adv-mlbl-'+i);
  if(lbl) lbl.textContent=mlbl(m);
  // Update the advance popup too
  const popup=document.getElementById('adv-popup-'+i);
  if(popup && (it.adv||0)>0){
    popup.textContent='\u20b9'+(it.cost*(it.adv||0)/100).toFixed(2)+' Cr at '+mlbl(m)+' (M'+m+')';
  }
  delete outOverrides[it.key];
  render();
}
function setMo(k,v){
  CLIENT.months[k]=parseInt(v)||1;
  const lbl=document.getElementById('lbl-mo-'+k);
  if(lbl) lbl.textContent=mlbl(CLIENT.months[k]);
  render();
}
function setCCredit(v){CLIENT.credit=parseInt(v)||0;render();}

/* Vendor controls */
const LABELS={Cell:'Cell',BCD:'BCD',Module:'Cell Tolling - Module',Inverter:'Inverter',MMS:'MMS - Tracker',
  PowerTx:'Power Transformer',Cables:'Cables',Floater:'Floater',IDT:'IDT',Other:'Other Supply',BESS:'BESS',BCD_BESS:'BCD for BESS',
  Erection:'Erection',Civil:'Civil',PowerEvac:'Power Evacuation',MandSpares:'Mandatory Spares & Freight',IDC:'IDC and R&C'};
Object.assign(LABELS, PROC_LABELS);   // procurement item labels share the same map

/* Update filled-left gradient for a range slider */
function updateSliderFill(inp){
  const min=+inp.min||0, max=+inp.max||100, val=+inp.value;
  const pct=((val-min)/(max-min)*100).toFixed(1)+'%';
  inp.style.setProperty('--slider-fill',pct);
}
/* Attach fill + popup events to all range inputs inside an element */
function wireSliders(root){
  root.querySelectorAll('input[type=range]').forEach(inp=>{
    updateSliderFill(inp);
    inp.addEventListener('input',()=>updateSliderFill(inp));
    // Derive an accessible name from the slider's own row label + its vendor card.
    if(!inp.getAttribute('aria-label')){
      const row=inp.closest('.vc-row'), item=inp.closest('.vc-item');
      const lbl=row && row.querySelector('.lbl');
      const name=item && item.querySelector('.vc-name');
      const lblTxt=lbl ? lbl.textContent.replace(/\s+/g,' ').trim() : 'Value';
      // vendor name is the first text node of .vc-name's first span (rest is cost + a mode badge)
      const nameSpan=name && name.firstElementChild;
      const nameTxt=nameSpan && nameSpan.firstChild ? nameSpan.firstChild.textContent.replace(/\s+/g,' ').trim() : '';
      inp.setAttribute('aria-label',(nameTxt?nameTxt+' — ':'')+lblTxt);
    }
  });
  root.querySelectorAll('.vc-adv-wrap').forEach(wrap=>{
    const show=()=>wrap.classList.add('show-popup');
    const hide=()=>wrap.classList.remove('show-popup');
    wrap.addEventListener('mouseenter',show);
    wrap.addEventListener('mouseleave',hide);
    wrap.addEventListener('focusin',show);
    wrap.addEventListener('focusout',hide);
  });
}

function buildVC(){
  if(!window.setVendorFilter) {
    window.setVendorFilter = function(val, label) {
      window.activeVendorFilter = val;
      document.getElementById('vd-selected-text').textContent = label;
      document.getElementById('vendorDropdown').classList.remove('open');
      const box = document.getElementById('vendorItemFilter');
      if(box) {
        Array.from(box.children).forEach(el => el.classList.remove('active'));
        const target = Array.from(box.children).find(el =>
          el.dataset.val === val || el.dataset.key === val
        );
        if(target) target.classList.add('active');
      }
      buildVC();
    };
  }

  const filterSel = document.getElementById('vendorItemFilter');
  let visibleKeys = null;

  if(MODEL === 'procurement') {
    if(!window.activeVendorFilter || window._lastFilterModel !== MODEL) {
      window.activeVendorFilter = 'Module';
      window._lastFilterModel = MODEL;
    }
    const activeFilter = window.activeVendorFilter;
    const cats = [{cat:'All', keys:null}, ...PROC_SECTIONS.map(s=>({cat:s.section, keys:s.items}))];
    filterSel.innerHTML = cats.map(c => {
      const isActive = activeFilter === c.cat ? 'active' : '';
      const safeLabel = c.cat.replace(/'/g, "\\'");
      return '<div class="dropdown-option ' + isActive + '" data-val="' + c.cat + '" onclick="setVendorFilter(\'' + c.cat + '\', \'' + safeLabel + '\')">' + c.cat + '</div>';
    }).join('');
    if(activeFilter !== 'All') {
      const found = cats.find(c => c.cat === activeFilter);
      if(found && found.keys) visibleKeys = new Set(found.keys);
    }
    document.getElementById('vd-selected-text').textContent = activeFilter;
  } else {
    if(!window.activeVendorFilter || window._lastFilterModel !== MODEL) {
      window.activeVendorFilter = 'Cell';
      window._lastFilterModel = MODEL;
    }
    const activeFilter = window.activeVendorFilter;
    const opts = [{key:'all', label:'All Items'}];
    state.forEach(it => opts.push({key: it.key, label: LABELS[it.key] || it.key}));
    filterSel.innerHTML = opts.map(o => {
      const isActive = activeFilter === o.key ? 'active' : '';
      const safeLabel = o.label.replace(/'/g, "\\'");
      return '<div class="dropdown-option ' + isActive + '" data-val="' + o.key + '" onclick="setVendorFilter(\'' + o.key + '\', \'' + safeLabel + '\')">' + o.label + '</div>';
    }).join('');
    if(activeFilter !== 'all') visibleKeys = new Set([activeFilter]);
    document.getElementById('vd-selected-text').textContent =
      activeFilter === 'all' ? 'All Items' : (LABELS[activeFilter] || activeFilter);
  }

  const el=document.getElementById('vcItems');
  el.innerHTML='';
  state.forEach((it,i)=>{
    const d=document.createElement('div');
    const modeColor=it.mode==='pr'?'#9f8fff':'var(--muted)';
    const modeLabel=it.mode==='pr'?'Pro-rata':'Standard';
    d.className='vc-item'+(it.mode==='pr'?' prorata-mode':'');
    d.id='vc-item-'+i;
    if(visibleKeys && !visibleKeys.has(it.key)) { d.style.display='none'; }

    let html='<div class="vc-name" style="display:flex;justify-content:space-between;align-items:center;">'
      +'<span>'+LABELS[it.key]+' <span style="color:var(--muted);font-weight:400;font-size:12px" id="vc-cost-lbl'+i+'">\u20b9'+it.cost.toFixed(2)+' Cr</span></span>'
      +'<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;background:'+modeColor+';color:#fff;letter-spacing:.04em;">'+modeLabel+'</span>'
      +'</div>';

    html+='<div class="vc-mode-toggle">'
      +'<button class="vc-mode-btn'+(it.mode==='std'?' active-std':'')+'" onclick="setVcMode('+i+',\'std\')">Standard</button>'
      +'<button class="vc-mode-btn'+(it.mode==='pr'?' active-pr':'')+'" onclick="setVcMode('+i+',\'pr\')">Pro-rata</button>'
      +'</div>';

    const wp = DC_CAPACITY > 0 ? (it.cost / DC_CAPACITY).toFixed(4) : 0;
    
    html += '<div class="vc-row"><span class="lbl">Currency</span>'
      + '<select onchange="setSt('+i+',\'currency\',this.value)" style="width:80px;font-family:inherit;font-size:12px;padding:3px;border:0.5px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);">'
      + '<option value="INR"'+(it.currency==='INR'?' selected':'')+'>INR</option>'
      + '<option value="USD"'+(it.currency==='USD'?' selected':'')+'>USD</option>'
      + '</select></div>';

    if(it.currency === 'USD') {
      html += '<div class="vc-row"><span class="lbl">USD Amount ($M)</span>'
        + '<input type="number" min="0" step="0.1" value="'+(it.fcyAmt||0).toFixed(3)+'" oninput="setSt('+i+',\'fcyAmt\',this.value)" onfocus="this.select()" onkeydown="if(event.key===\'Enter\')this.blur()" style="width:80px;font-family:inherit;font-size:13px;padding:5px 7px;border:0.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);">'
        + '</div>';
      html += '<div class="vc-row"><span class="lbl">Base Rate (₹/$)</span>'
        + '<input type="number" min="0" step="0.1" value="'+it.baseRate+'" oninput="setSt('+i+',\'baseRate\',this.value)" style="width:80px;font-family:inherit;font-size:13px;padding:5px 7px;border:0.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);">'
        + '</div>';
      html += '<div class="vc-row"><span class="lbl">Hedge Ratio (%)</span>'
        + '<input type="range" min="0" max="100" step="5" value="'+it.hedgeRatio+'" oninput="setSt('+i+',\'hedgeRatio\',this.value)">'
        + '<span class="vval" id="vc-hr'+i+'" style="width:30px;">'+it.hedgeRatio+'%</span></div>';
      html += '<div class="vc-row"><span class="lbl">Fwd Rate (₹/$)</span>'
        + '<input type="number" min="0" step="0.1" value="'+it.fwdRate+'" oninput="setSt('+i+',\'fwdRate\',this.value)" style="width:80px;font-family:inherit;font-size:13px;padding:5px 7px;border:0.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);">'
        + '</div>';
      html += '<div class="vc-row"><span class="lbl">Spot Rate (₹/$)</span>'
        + '<input type="number" min="0" step="0.1" value="'+it.spotRate+'" oninput="setSt('+i+',\'spotRate\',this.value)" style="width:80px;font-family:inherit;font-size:13px;padding:5px 7px;border:0.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);">'
        + '</div>';
        
      html+=`<div class="vc-row" style="margin-top:6px;border-top:1px dashed var(--border);padding-top:6px;"><span class="lbl" style="color:var(--amber);">Effective Cost</span>`
        +`<span id="vc-eff-cost${i}" style="font-size:13px;font-family:var(--font-mono);font-weight:600;color:var(--text);">&#8377;${it.cost.toFixed(2)} Cr</span>`
        +`<span id="vc-eff-wp${i}" style="font-size:11px;color:var(--muted);margin-left:8px;">${wp} Cr/MWp</span>`
        +`</div>`;
    } else {
      html += '<div class="vc-row"><span class="lbl">Cost (₹ Cr)</span>'
        + '<input type="number" min="0" max="2000" step="0.5" value="' + it.cost.toFixed(2) + '" id="vc-p' + i + '"'
        + ' oninput="setSt(' + i + ',\'cost\',this.value)"'
        + ' onfocus="this.select()"'
        + ' onkeydown="if(event.key===\'Enter\')this.blur()"'
        + ' style="width:80px;font-family:inherit;font-size:13px;padding:5px 7px;border:0.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);">'
        + '<span style="font-size:11px;color:var(--muted);margin-left:8px;">' + wp + ' Cr/MWp</span>'
        + '</div>';
    }

    if(it.mode==='pr'){
      html+=buildPrHtml(it,i);
    } else {
      const advMStd = it.advStart||it.start;
      html+='<div class="vc-row"><span class="lbl">Advance (%)</span>'
        +'<div class="vc-adv-wrap" id="adv-wrap-'+i+'">'
        +'<input type="range" min="0" max="100" step="5" value="'+(it.adv||0)+'" oninput="setSt('+i+',\'adv\',this.value)" style="flex:1">'
        +'<div class="adv-popup" id="adv-popup-'+i+'">'
        +((it.adv||0)>0 ? '\u20b9'+(it.cost*(it.adv||0)/100).toFixed(2)+' Cr at '+mlbl(advMStd)+' (M'+advMStd+')' : 'No advance')
        +'</div>'
        +'</div>'
        +'<span class="vval" id="vc-a'+i+'">'+(it.adv||0)+'%</span></div>';
      if((it.adv||0)>0){
        html+='<div class="vc-row"><span class="lbl">Advance month</span>'
          +'<input type="number" min="1" max="60" step="1" value="'+advMStd+'"'
          +' oninput="setAdvStart('+i+',this.value)"'
          +' style="width:52px;padding:3px 6px;font-size:12px;border:0.5px solid var(--border);border-radius:4px;background:var(--surface);font-family:inherit;">'
          +'<span style="margin-left:8px;font-size:13px;font-weight:600;color:var(--amber)" id="adv-mlbl-'+i+'">'+mlbl(advMStd)+'</span>'
        +'</div>';
      }
      html+='<div class="vc-row"><span class="lbl">Credit period</span>'
        +'<input type="range" min="0" max="270" step="15" value="'+it.credit+'" oninput="setSt('+i+',\'credit\',this.value)">'
        +'<span class="vval" id="vc-c'+i+'">'+it.credit+'d</span></div>'
        +'<div class="vc-row"><span class="lbl">Delivery start</span>'
        +'<input type="range" min="1" max="20" step="1" value="'+it.start+'" oninput="setSt('+i+',\'start\',this.value)">'
        +'<span class="vval" id="vc-s'+i+'">'+mlbl(it.start)+'</span></div>';

      if(it.key.includes('Cell') || it.key.includes('BESS')){
        const blOn = it.useBlMonth || false;
        html+='<div class="vc-row" style="margin-top:4px;"><span class="lbl">Bill of Lading</span>'
          +'<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">'
          +'<input type="checkbox" '+(blOn?'checked ':'')+' oninput="setSt('+i+',\'useBlMonth\',this.checked)" style="width:14px;height:14px;cursor:pointer;">'
          +'<span style="font-size:11px;color:var(--muted);">Use BL month for payment</span></label></div>';
        if(blOn){
          html+='<div class="vc-row"><span class="lbl" style="color:var(--amber);">BL month</span>'
            +'<input type="range" min="1" max="20" step="1" value="'+(it.blMonth||it.start)+'" oninput="setSt('+i+',\'blMonth\',this.value)">'
            +'<span class="vval" id="vc-bm'+i+'">'+mlbl(it.blMonth||it.start)+'</span></div>';
        }
      }

      if(it.curveBase){
        html+='<div class="vc-row"><span class="lbl" style="color:var(--blue);">Custom Curve</span><span class="vval" style="font-size:10px;">Via Curve Manager</span></div>';
      } else if(!it.svc){
        html+='<div class="vc-row"><span class="lbl">No. of lots</span>'
          +'<input type="range" min="1" max="20" step="1" value="'+it.lots+'" oninput="setSt('+i+',\'lots\',this.value)">'
          +'<span class="vval" id="vc-l'+i+'">'+it.lots+'</span></div>'
          +'<div class="vc-row"><span class="lbl">Delivery gap</span>'
          +'<input type="range" min="1" max="6" step="1" value="'+it.step+'" oninput="setSt('+i+',\'step\',this.value)">'
          +'<span class="vval" id="vc-g'+i+'">'+it.step+'mo</span></div>';
      }
    }
    d.innerHTML=html;
    el.appendChild(d);
  });
  wireSliders(el);
}

function buildPrHtml(it,i){
  const n=it.prMonths||1;
  const cm=Math.round((it.credit||0)/30);
  const adv=it.adv||0;
  const remCost=it.cost*(1-adv/100);
  let html='';
  const advMPr=it.advStart||it.start;
  html+='<div class="vc-row"><span class="lbl">Advance (%)</span>'
    +'<div class="vc-adv-wrap" id="adv-wrap-'+i+'">'
    +'<input type="range" min="0" max="100" step="5" value="'+adv+'" oninput="setSt('+i+',\'adv\',this.value)" style="flex:1">'
    +'<div class="adv-popup" id="adv-popup-'+i+'">'
    +(adv>0 ? '\u20b9'+(it.cost*adv/100).toFixed(2)+' Cr at '+mlbl(advMPr)+' (M'+advMPr+')' : 'No advance')
    +'</div>'
    +'</div>'
    +'<span class="vval" id="vc-a'+i+'">'+adv+'%</span></div>';
  if(adv>0){
    html+='<div class="vc-row"><span class="lbl">Advance month</span>'
      +'<input type="number" min="1" max="60" step="1" value="'+advMPr+'"'
      +' oninput="setAdvStart('+i+',this.value)"'
      +' style="width:52px;padding:3px 6px;font-size:12px;border:0.5px solid var(--border);border-radius:4px;background:var(--surface);font-family:inherit;">'
      +'<span style="margin-left:8px;font-size:13px;font-weight:600;color:var(--amber)" id="adv-mlbl-'+i+'">'+mlbl(advMPr)+'</span>'
    +'</div>';
  }
  html+='<div class="vc-row"><span class="lbl">Credit period</span>'
    +'<input type="range" min="0" max="270" step="15" value="'+it.credit+'" oninput="setSt('+i+',\'credit\',this.value)">'
    +'<span class="vval" id="vc-c'+i+'">'+it.credit+'d</span></div>';
  html+='<div class="vc-row"><span class="lbl">Delivery start</span>'
    +'<input type="range" min="1" max="20" step="1" value="'+it.start+'" oninput="setSt('+i+',\'start\',this.value)">'
    +'<span class="vval" id="vc-s'+i+'">'+mlbl(it.start)+'</span></div>';

  if(it.key.includes('Cell') || it.key.includes('BESS')){
    const blOn = it.useBlMonth || false;
    html+='<div class="vc-row" style="margin-top:4px;"><span class="lbl">Bill of Lading</span>'
      +'<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">'
      +'<input type="checkbox" '+(blOn?'checked ':'')+' oninput="setSt('+i+',\'useBlMonth\',this.checked)">'
      +'<span style="font-size:11px;color:var(--muted);">Use BL month for payment</span></label></div>';
    if(blOn){
      html+='<div class="vc-row"><span class="lbl" style="color:var(--amber);">BL month</span>'
        +'<input type="range" min="1" max="20" step="1" value="'+(it.blMonth||it.start)+'" oninput="setSt('+i+',\'blMonth\',this.value)">'
        +'<span class="vval" id="vc-bm'+i+'">'+mlbl(it.blMonth||it.start)+'</span></div>';
    }
  }

  html+='<div class="vc-row"><span class="lbl">No. of lots</span>'
    +'<input type="range" min="1" max="36" step="1" value="'+it.lots+'" oninput="setSt('+i+',\'lots\',this.value)">'
    +'<span class="vval" id="vc-l'+i+'">'+it.lots+'</span></div>';
  html+='<div class="vc-row"><span class="lbl">Delivery gap</span>'
    +'<input type="range" min="1" max="6" step="1" value="'+(it.step||1)+'" oninput="setSt('+i+',\'step\',this.value)">'
    +'<span class="vval" id="vc-g'+i+'">'+(it.step||1)+'mo</span></div>';
  if(adv>0){
    const advMpr=it.advStart||it.start;
    html+='<div class="vc-row" style="margin-top:4px;">'
      +'<span class="lbl">Advance month</span>'
      +'<input type="number" min="1" max="60" step="1" value="'+advMpr+'"'
      +' oninput="setAdvStart('+i+',this.value)"'
      +' style="width:52px;padding:3px 6px;font-size:12px;border:0.5px solid var(--border);border-radius:4px;background:var(--surface);font-family:inherit">'
      +'<span style="margin-left:6px;font-size:12px;font-weight:600;color:var(--amber)" id="adv-mlbl-'+i+'">'+mlbl(advMpr)+'</span>'
      +'<span style="margin-left:6px;font-size:11px;color:var(--muted)">(₹'+(it.cost*adv/100).toFixed(2)+' Cr)</span>'
    +'</div>';
  }
  html+='<div class="pr-months-row" style="margin-top:8px;">'
    +'<span style="flex:1;font-weight:600;color:var(--text);font-size:12px;">Payment months</span>'
    +'<input type="number" min="1" max="36" step="1" value="'+n+'" oninput="setPrMonths('+i+',this.value)" style="width:52px;padding:3px 6px;font-size:12px;border:0.5px solid var(--border);border-radius:4px;background:var(--surface);font-family:inherit">'
    +'</div>';
  const targetSum = it.svc ? 100 : (it.lots * 100);
  const targetLabel = it.svc ? '100%' : (it.lots + ' lots (' + targetSum + '%)');
  html+='<div style="font-size:10px;color:var(--muted);margin-bottom:6px;">Enter % per payment month. Total must equal ' + targetLabel + '.</div>';
  html+='<div class="pr-grid" id="pr-grid-'+i+'">';
  let sum=0;

  for(let mo=1;mo<=n;mo++){
    const pct=it.prPct[mo]||0;
    sum+=pct;
    const payM=it.start+(mo-1)*(it.step||1)+cm;
    const amt=(remCost * pct / targetSum).toFixed(2);
    html+='<div class="pr-cell">'
      +'<label>M'+mo+' \u2192 '+mlbl(payM)+'</label>'
      +'<input type="number" min="0" max="1000" step="0.1" value="'+pct+'"'
      +' data-pr-idx="'+i+'" data-pr-mo="'+mo+'" data-pr-total="'+n+'"'
      +' oninput="setPrPct('+i+','+mo+',this.value)"'
      +' onfocus="this.select()"'
      +' onkeydown="prKeyNav(event,this)"'
      +'>'
      +'<span style="font-size:9px;color:var(--muted);text-align:right;">\u20b9'+amt+' Cr</span>'
      +'</div>';
  }
  html+='</div>';
  const diff0=parseFloat((sum-targetSum).toFixed(1));
  const over0=diff0>0.05, exact0=Math.abs(diff0)<=0.05;
  let sumLbl0;
  if(exact0){ sumLbl0='\u2713 '+sum.toFixed(1)+'% \u2014 fully allocated'; }
  else if(over0){ sumLbl0='\u26a0 '+sum.toFixed(1)+'% \u2014 '+diff0.toFixed(1)+'% over target ('+targetSum+'%)'; }
  else { sumLbl0='\u26a0 '+sum.toFixed(1)+'% \u2014 '+Math.abs(diff0).toFixed(1)+'% remaining to allocate'; }
  html+='<div class="pr-sum '+(over0?'over':exact0?'ok':'under')+'" id="pr-sum-'+i+'">'+sumLbl0+'</div>';
  html+='<div style="display:flex;gap:6px;margin-top:4px;">'
    +'<button class="pr-fill-btn" onclick="prFillRemaining('+i+')">Fill remaining</button>'
    +'<button class="pr-fill-btn" onclick="prDistributeEvenly('+i+')">Distribute evenly</button>'
    +'</div>';
  return html;
}

function setVcMode(i,mode){
  const it=state[i];
  it.mode=mode;
  // Clear any manual overrides for this item so computed values take effect
  delete outOverrides[it.key];
  delete inOverrides[it.key];
  if(mode==='pr'){
    const n=it.prMonths||it.lots||3;
    it.prMonths=n;
    if(Object.keys(it.prPct||{}).length===0){
      const targetSum = it.svc ? 100 : (it.lots * 100);
      const even=parseFloat((targetSum/n).toFixed(1));
      it.prPct={};
      for(let m=1;m<n;m++) it.prPct[m]=even;
      it.prPct[n]=parseFloat((targetSum-(even*(n-1))).toFixed(1));
    }
  }
  buildVC();
  render();
}

function setPrMonths(i,val){
  const it=state[i];
  const parsed=parseInt(val);
  if(isNaN(parsed)||parsed<1) return;
  const n=Math.min(36,parsed);
  it.prMonths=n;
  // Rebuilding the schedule shape: clear manual table overrides for this item (like setVcMode/setPrPct).
  // Otherwise an override parked in a now-removed tail month is orphaned — it keeps adding to the row
  // total even though it sits outside the visible pro-rata window (caused the phantom "+1.29" on IDC).
  delete outOverrides[it.key]; delete inOverrides[it.key];
  const targetSum = it.svc ? 100 : (it.lots * 100);
  const even=parseFloat((targetSum/n).toFixed(1));
  it.prPct={};
  for(let m=1;m<n;m++) it.prPct[m]=even;
  it.prPct[n]=parseFloat((targetSum-(even*(n-1))).toFixed(1));
  const grid=document.getElementById('pr-grid-'+i);
  if(grid){
    const cm=Math.round((it.credit||0)/30);
    const remCost=it.cost*(1-(it.adv||0)/100);
    let inner='';
    for(let mo=1;mo<=n;mo++){
      const pct=it.prPct[mo];
      const payM=it.start+(mo-1)*(it.step||1)+cm;
      const amt=(remCost*pct/targetSum).toFixed(2);
      inner+='<div class="pr-cell">'
        +'<label>M'+mo+' \u2192 '+mlbl(payM)+'</label>'
        +'<input type="number" min="0" max="1000" step="0.1" value="'+pct+'"'
        +' data-pr-idx="'+i+'" data-pr-mo="'+mo+'" data-pr-total="'+n+'"'
        +' oninput="setPrPct('+i+','+mo+',this.value)"'
        +' onfocus="this.select()"'
        +' onkeydown="prKeyNav(event,this)"'
        +'>'
        +'<span style="font-size:9px;color:var(--muted);text-align:right;">\u20b9'+amt+' Cr</span>'
        +'</div>';
    }
    grid.innerHTML=inner;
  }
  updatePrSum(i);
  refreshPrCrLabels(i);
  render();
}

function setPrPct(i,mo,val){
  const it=state[i];
  if(!it.prPct) it.prPct={};
  it.prPct[mo] = parseFloat(val)||0;
  // No auto-fill — just update labels and show red if total doesn't match target
  // Clear table overrides so pr-mode computation shows through
  delete outOverrides[it.key];
  refreshPrCrLabels(i);
  updatePrSum(i);
  render();
}

// Update all ₹ Cr labels in a pro-rata grid to reflect current prPct values
function refreshPrCrLabels(i){
  const it = state[i];
  const remCost = it.cost * (1-(it.adv||0)/100);
  const targetSum = it.svc ? 100 : (it.lots * 100);
  const grid = document.getElementById('pr-grid-'+i);
  if(!grid) return;
  grid.querySelectorAll('.pr-cell').forEach((cell, idx) => {
    const mo = idx + 1;
    const pct = (it.prPct && it.prPct[mo]) || 0;
    const lbl = cell.querySelector('span');
    if(lbl) lbl.textContent = '\u20b9' + (remCost * pct / targetSum).toFixed(2) + ' Cr';
  });
}

/* Pro-rata keyboard navigation */
function prKeyNav(e, el){
  const i=+el.dataset.prIdx, mo=+el.dataset.prMo, n=+el.dataset.prTotal;
  if(e.key==='Enter' || e.key==='ArrowRight' || e.key==='Tab'){
    e.preventDefault();
    if(mo<n){
      const next=document.querySelector('[data-pr-idx="'+i+'"][data-pr-mo="'+(mo+1)+'"]');
      if(next){ next.focus(); next.select(); }
    } else {
      el.blur();
    }
  } else if(e.key==='ArrowLeft' || (e.key==='Tab' && e.shiftKey)){
    e.preventDefault();
    if(mo>1){
      const prev=document.querySelector('[data-pr-idx="'+i+'"][data-pr-mo="'+(mo-1)+'"]');
      if(prev){ prev.focus(); prev.select(); }
    }
  } else if(e.key==='Escape'){
    e.preventDefault();
    el.blur();
  }
}

/* Pro-rata helper buttons */
function prFillRemaining(i){
  const it=state[i];
  const n=it.prMonths||1;
  const filled=Object.values(it.prPct||{}).reduce((a,b)=>a+b,0);
  const empties=[];
  for(let m=1;m<=n;m++) if(!it.prPct[m] || it.prPct[m]===0) empties.push(m);
  if(empties.length===0) return;
  
  const targetSum = it.svc ? 100 : (it.lots * 100);
  const remaining=Math.max(0, targetSum-filled);
  const each=parseFloat((remaining/empties.length).toFixed(1));
  empties.forEach((m,idx)=>{
    it.prPct[m] = idx<empties.length-1 ? each : parseFloat((remaining - each*(empties.length-1)).toFixed(1));
  });
  buildVC(); refreshPrCrLabels(i); render();
}
function prDistributeEvenly(i){
  const it=state[i];
  const n=it.prMonths||1;
  const targetSum = it.svc ? 100 : (it.lots * 100);
  const even=parseFloat((targetSum/n).toFixed(1));
  it.prPct={};
  for(let m=1;m<n;m++) it.prPct[m]=even;
  it.prPct[n]=parseFloat((targetSum-(even*(n-1))).toFixed(1));
  buildVC(); refreshPrCrLabels(i); render();
}

function updatePrSum(i){
  const it=state[i];
  const sum=Object.values(it.prPct||{}).reduce((a,b)=>a+b,0);
  const el=document.getElementById('pr-sum-'+i);
  if(!el) return;
  const targetSum = it.svc ? 100 : (it.lots * 100);
  const diff = parseFloat((sum - targetSum).toFixed(1));
  const over = diff > 0.05, exact = Math.abs(diff) <= 0.05;
  let sumLbl;
  if(exact){
    sumLbl = '\u2713 ' + sum.toFixed(1) + '% — fully allocated';
  } else if(over){
    sumLbl = '\u26a0 ' + sum.toFixed(1) + '% — ' + diff.toFixed(1) + '% over target (' + targetSum + '%)';
  } else {
    const short = Math.abs(diff).toFixed(1);
    sumLbl = '\u26a0 ' + sum.toFixed(1) + '% — ' + short + '% remaining to allocate';
  }
  el.className='pr-sum '+(over?'over':exact?'ok':'under');
  el.textContent=sumLbl;
}

function updatePrLabels(i){
  const it=state[i];
  const cm=Math.round((it.credit||0)/30);
  const grid=document.getElementById('pr-grid-'+i);
  if(!grid) return;
  grid.querySelectorAll('.pr-cell label').forEach((lbl,idx)=>{
    const m=idx+1;
    const payM=it.start+(m-1)*(it.step||1)+cm;
    lbl.textContent='M'+m+' \u2192 '+mlbl(payM);
  });
}

let _renderTimer = null;
let _buildVcNeeded = false;
function deferRender(needsBuildVC){
  if(needsBuildVC) _buildVcNeeded = true;
  clearTimeout(_renderTimer);
  // 16ms ≈ one animation frame — enough to batch rapid sequential calls without perceptible delay
  _renderTimer = setTimeout(()=>{
    if(_buildVcNeeded){ _buildVcNeeded=false; buildVC(); }
    render();
  }, 16);
}

function setFxStress(val) {
  FX_STRESS = parseFloat(val) || 0;
  const el = document.getElementById('fx-stress-display');
  if(el) el.textContent = (FX_STRESS > 0 ? '+' : '') + FX_STRESS;
  
  // Recalculate cost for all USD items
  state.forEach((it, i) => {
    if (it.currency === 'USD') {
      updateFcyCost(i);
      BASE_COSTS[it.key] = it.cost;
    }
  });
  
  // Recalculate overall margin
  const totalCost = state.reduce((s,it) => s + it.cost, 0);
  MARGIN = PROJECT_VALUE > 0 ? ((1 - totalCost / PROJECT_VALUE) * 100) : 0;
  
  // Update UI and re-render
  syncOtherInput('cost');
  buildVC();
  render();
}

function updateFcyCost(i) {
  const it = state[i];
  if (it.currency === 'USD') {
    const stressMultiplier = 1 + (FX_STRESS / 100);
    const hr = (it.hedgeRatio || 0) / 100;
    const effectiveRate = (hr * (it.fwdRate || 0)) + ((1 - hr) * (it.spotRate || 0) * stressMultiplier);
    it.cost = (it.fcyAmt || 0) * effectiveRate;
  }
}

/* Single global procurement budget delta badge (shown near Target Margin) */
function updateProcBudgetBadge(){
  const badge = document.getElementById('proc-budget-delta');
  if(!badge) return;
  if(MODEL !== 'procurement'){ badge.style.display='none'; return; }

  const cfMap = _cfCostMap();
  // Sum all unique CF source keys used in this procurement model
  const srcKeys = [...new Set(PROC_MAP.map(([,src])=>src))];
  let totCF = 0, totAlloc = 0;
  srcKeys.forEach(src => {
    totCF += cfMap[src] || 0;
    totAlloc += PROC_MAP.filter(([,s])=>s===src).reduce((sum,[pk])=>sum+stCost(pk),0);
  });
  const delta = totAlloc - totCF;
  const allOk = Math.abs(delta) < 0.05;
  if(allOk){ badge.style.display='none'; return; }

  const sign  = delta > 0 ? '▲' : '▼';
  const color = delta > 0 ? 'var(--red-text,#ff5e57)' : 'var(--green-text,#27cd9b)';
  const bg    = delta > 0 ? 'rgba(255,94,87,0.12)' : 'rgba(39,205,155,0.12)';
  const pct   = totCF > 0 ? ((delta/totCF)*100).toFixed(1) : null;
  const label = (delta > 0 ? '+' : '') + delta.toFixed(2) + ' Cr' + (pct !== null ? ' (' + pct + '%)' : '') + ' vs CF budget';
  badge.textContent = sign + ' ' + label;
  badge.title = 'Total procurement allocated: ₹' + totAlloc.toFixed(2) + ' Cr  |  CF budget: ₹' + totCF.toFixed(2) + ' Cr';
  badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:' + color + ';background:' + bg + ';padding:3px 10px;border-radius:12px;white-space:nowrap;cursor:default;';
}

function setSt(i,k,v){
  if(k === 'currency') {
    state[i][k] = v;
    if(v === 'USD' && state[i].fcyAmt === 0) {
       state[i].fcyAmt = state[i].cost / (state[i].baseRate || 1);
    }
    updateFcyCost(i);
    buildVC();
    render();
    return;
  }

  if(k === 'useBlMonth') {
    state[i][k] = !!v;
    buildVC();
    render();
    return;
  }
  
  const prevHadAdv = (k === 'adv') ? ((state[i].adv||0)!==0) : false;
  state[i][k]=+v;
  
  if(['fcyAmt', 'baseRate', 'hedgeRatio', 'fwdRate', 'spotRate'].includes(k)){
    if(k === 'hedgeRatio') {
      const el = document.getElementById('vc-hr'+i);
      if(el) el.textContent = v + '%';
    }
    updateFcyCost(i);
    
    // Update labels directly without rebuilding DOM to keep focus
    const wp = DC_CAPACITY > 0 ? (state[i].cost / DC_CAPACITY).toFixed(4) : 0;
    const lblCost = document.getElementById('vc-eff-cost'+i);
    if(lblCost) lblCost.textContent = '₹' + state[i].cost.toFixed(2) + ' Cr';
    const lblWp = document.getElementById('vc-eff-wp'+i);
    if(lblWp) lblWp.textContent = wp + ' Cr/MWp';

    k = 'cost'; 
    v = state[i].cost;
    deferRender(false); // Only render charts, don't rebuild VC
  }

  if(k==='cost'){
    BASE_COSTS[state[i].key] = state[i].cost;
    const totalCost = state.reduce((s,it) => s + it.cost, 0);
    MARGIN = PROJECT_VALUE > 0 ? ((1 - totalCost / PROJECT_VALUE) * 100) : 0;
    syncOtherInput('cost');
    const lbl=document.getElementById('vc-cost-lbl'+i);
    if(lbl) lbl.textContent='₹'+(+v).toFixed(2)+' Cr';
    updateProcBudgetBadge();
    _skipCostRefresh = true;
    deferRender(false);
    _skipCostRefresh = false;
  } else {
    if(k==='adv'){
      // Only rebuild card if the zero↔nonzero boundary is crossed (shows/hides advance-month row)
      // Otherwise just update the label — defer the full rebuild
      const nowHasAdv = (+v!==0);
      const el=document.getElementById('vc-a'+i); if(el) el.textContent=v+'%';
      if(prevHadAdv!==nowHasAdv){
        deferRender(true); // needs buildVC to show/hide the advance month row
      } else {
        // update popup text immediately without rebuild
        const popup=document.getElementById('adv-popup-'+i);
        if(popup) popup.textContent = +v>0 ? '₹'+(state[i].cost*(+v)/100).toFixed(2)+' Cr at '+mlbl(state[i].advStart||state[i].start)+' (M'+(state[i].advStart||state[i].start)+')' : 'No advance';
        deferRender(false);
      }
    }
    else if(k==='credit'){
      const el=document.getElementById('vc-c'+i); if(el) el.textContent=v+'d';
      if(state[i].mode==='pr') updatePrLabels(i);
      deferRender(false);
    }
    else if(k==='start'){
      const el=document.getElementById('vc-s'+i); if(el) el.textContent=mlbl(+v);
      if(state[i].mode==='pr') updatePrLabels(i);
      deferRender(false);
    }
    else if(k==='blMonth'){
      const el=document.getElementById('vc-bm'+i); if(el) el.textContent=mlbl(+v);
      deferRender(false);
    }
    else if(k==='lots'){
      document.getElementById('vc-l'+i) && (document.getElementById('vc-l'+i).textContent=v);
      if(state[i].mode==='pr'){
        const it=state[i];
        const n=it.prMonths||it.lots;
        const targetSum = it.svc ? 100 : (it.lots * 100);
        const even=parseFloat((targetSum/n).toFixed(1));
        it.prPct={};
        for(let m=1;m<n;m++) it.prPct[m]=even;
        it.prPct[n]=parseFloat((targetSum-(even*(n-1))).toFixed(1));
        deferRender(true);
      } else {
        deferRender(false);
      }
    }
    else if(k==='step'){
      document.getElementById('vc-g'+i) && (document.getElementById('vc-g'+i).textContent=v+'mo');
      if(state[i].mode==='pr') updatePrLabels(i);
      deferRender(false);
    }
    else {
      deferRender(false);
    }
  }
}

function updatePrLabels(i){
  const it=state[i];
  const cm=Math.round((it.credit||0)/30);
  const grid=document.getElementById('pr-grid-'+i);
  if(!grid) return;
  grid.querySelectorAll('.pr-cell label').forEach((lbl,idx)=>{
    const m=idx+1;
    const payM=it.start+(m-1)*(it.step||1)+cm;
    lbl.textContent='M'+m+' \u2192 '+mlbl(payM);
  });
}
/* Zero out all data (state, KPIs, client terms, overrides) WITHOUT touching the
   DOM/render — shared by resetAll() and the blank first-load default. */
function clearToZero(){
  state=ACTIVE_BASE.map(it=>({
    ...it,
    cost:0, credit: 0, adv: 0, advStart: null,
    start: 0, blMonth: 0, useBlMonth: false,
    lots: 0, step: 0,
    fcyAmt: 0, baseRate: 0, hedgeRatio: 0, fwdRate: 0, spotRate: 0,
    prPct:{...it.prPct}, prMonths: it.prMonths||it.lots||3
  }));
  MARGIN=0;
  FX_STRESS=0;
  PROJECT_VALUE=0;
  PROJECT_MONTHS=0;
  MIN_N=0;
  DC_CAPACITY=0;
  CLIENT={credit:0,supply:{adv:0,disp:0,recv:0,erect:0,comm:0,compl:0,pg:0},service:{prog:0,comm:0,compl:0,pg:0},months:{comm:0,compl:0,pg:0}};
  outOverrides={}; inOverrides={};
}
/* Restore the built-in demo dataset (the original BASE default values).
   Clears the saved working scenario and reloads, which re-runs the no-save
   init path that seeds the model from BASE. Named "Save as…" scenarios are
   kept. */
function restoreDefaults(){
  if(!confirm('Discard the current scenario and reload the built-in default (demo) values?')) return;
  try{ localStorage.removeItem('lt_cashflow_save'); }catch(e){}
  location.reload();
}
function resetAll(){
  localStorage.removeItem('lt_cashflow_save');
  clearToZero();
  syncKpiInputs();
  rebuildSvcProg(1);
  rebuildIdcFixed(1);
  buildVC(); buildClientInputs(); render();
  showToast('reset', 'Reset Complete', 'All values have been cleared to zero.');
}
function showToast(type, title, message) {
  const toast = document.getElementById('actionToast');
  const icon  = document.getElementById('toastIcon');
  const ttl   = document.getElementById('toastTitle');
  const msg   = document.getElementById('toastMsg');
  const bar   = document.getElementById('toastBar');
  // config by type
  const cfg = {
    save:    { color:'#22c55e', bg:'rgba(34,197,94,.15)',  emoji:'\u2713', label: title, sub: message },
    reset:   { color:'#f59e0b', bg:'rgba(245,158,11,.15)', emoji:'\u21ba', label: title, sub: message },
    warning: { color:'#f59e0b', bg:'rgba(245,158,11,.15)', emoji:'\u26a0', label: title, sub: message },
    undo:    { color:'#60a5fa', bg:'rgba(96,165,250,.15)', emoji:'\u21b6', label: title, sub: message },
  }[type] || { color:'var(--blue)', bg:'rgba(96,165,250,.15)', emoji:'\u2713', label: title, sub: message };
  // reset animation by forcing reflow
  toast.style.display = 'none';
  void toast.offsetWidth;
  icon.style.background = cfg.bg;
  icon.style.color = cfg.color;
  icon.textContent = cfg.emoji;
  ttl.textContent  = cfg.label;
  msg.textContent  = cfg.sub;
  bar.style.background  = cfg.color;
  bar.style.transition  = 'none';
  bar.style.width = '100%';
  toast.style.display = 'flex';
  // animate progress bar shrinking over 3s
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bar.style.transition = 'width 3s linear';
      bar.style.width = '0%';
    });
  });
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3200);
}
function saveScenario() {
  _snapshotModel(); // Ensure current active state is committed to modelStore
  const data = { 
    modelStore: modelStore, 
    client: CLIENT, 
    project: PROJECT, 
    projectValue: PROJECT_VALUE, 
    projectMonths: PROJECT_MONTHS, 
    fxStress: FX_STRESS, 
    dcCapacity: DC_CAPACITY, 
    model: MODEL 
  };
  localStorage.setItem('lt_cashflow_save', JSON.stringify(data));
  showToast('save', 'Scenario Saved', 'All settings have been saved successfully.');
}
function autoFix(){
  flushHistory();   // commit the pre-fix state so Auto-fix is one clean undo step
  const base = recompute();
  if(!base.neg.length){
    showToast('save','Already Healthy','No negative cash months — nothing to fix.');
    return;
  }
  // Greedy minimal-lever fix: repeatedly extend the ONE vendor credit period that most
  // lifts the funding trough (minNet), so the suggestion is explainable, not a blanket bump.
  const labelOf = it => it.name || it.label || it.key;
  const applied = {};
  let guard = 0, r = base;
  while(r.neg.length && guard < 400){
    let best = -Infinity, bestIdx = -1;
    for(let i=0;i<state.length;i++){
      const it = state[i];
      if(it.credit >= 270) continue;          // lever exhausted
      const save = it.credit;
      it.credit = Math.min(270, it.credit + 15);
      const tryMin = recompute().minNet;
      it.credit = save;                        // restore before trying the next lever
      if(tryMin > best){ best = tryMin; bestIdx = i; }
    }
    if(bestIdx < 0) break;                      // every lever maxed out
    const it = state[bestIdx];
    it.credit = Math.min(270, it.credit + 15);
    applied[labelOf(it)] = (applied[labelOf(it)] || 0) + 15;
    guard++;
    r = recompute();
  }
  buildVC(); render();
  const parts = Object.entries(applied).map(([k,d]) => k + ' +' + d + 'd');
  const fixed = r.neg.length === 0;
  showToast(fixed ? 'save' : 'warning',
    fixed ? 'Funding Gap Closed' : 'Partial Fix',
    (fixed ? 'Extended credit on: ' : 'Shortfall reduced but still negative. Adjusted: ')
      + (parts.join(', ') || 'no available levers'));
}

/* CASHFLOW OPTIMIZER — constrained credit-term search ("the agent") — Not an ML model: a deterministic optimiser. It extends vendor credit periods — (each kept inside its [min,max] band, in 15-day steps) to clear negative cash — months with the SMALLEST total extension, then prunes any overshoot. Because — paying later never hurts cash, it only ever extends — never shortens below the — item's current term. Pure: runs on a working copy, restores live state, returns — a plan the user reviews before applying. */
function _creditBand(it){
  const d = CREDIT_BOUNDS[it.key];
  let lo = (it.creditMin!=null) ? it.creditMin : (d ? d[0] : it.credit);
  let hi = (it.creditMax!=null) ? it.creditMax : (d ? d[1] : it.credit);
  lo = Math.min(lo, it.credit); hi = Math.max(hi, it.credit);   // current term is always reachable
  return { lo, hi };
}
function planCreditOptimization(){
  const STEP = 15;
  const orig = state.map(it=>it.credit);
  const band = state.map(_creditBand);
  const evalWith = (cr)=>{ state.forEach((it,i)=>{ it.credit=cr[i]; }); const r=recompute(); return {neg:r.neg.length, minNet:r.minNet, minM:r.minM}; };
  const before = evalWith(orig);
  const cur = orig.slice();
  let now = { neg:before.neg, minNet:before.minNet };
  // Greedy: each round, for every item find the SMALLEST extension that strictly improves
  // on the current state, then take the best such move. We scan past no-op steps because
  // credit→month is round(days/30): a +15d bump (e.g. 75→90) can land on the same month and
  // do nothing, so a naive +15 greedy would stall before reaching the next real threshold.
  const better = (e,ref) => e.neg<ref.neg || (e.neg===ref.neg && e.minNet>ref.minNet+1e-6);
  let guard = 0;
  while(now.neg>0 && guard<800){
    let best = null;
    for(let i=0;i<state.length;i++){
      for(let v=cur[i]+STEP; v<=band[i].hi; v+=STEP){      // smallest improving step for item i
        const trial = cur.slice(); trial[i] = v;
        const e = evalWith(trial);
        if(better(e, now)){
          const cand = { i, v, e, delta:v-cur[i] };
          if(!best || cand.e.neg<best.e.neg
             || (cand.e.neg===best.e.neg && cand.e.minNet>best.e.minNet)
             || (cand.e.neg===best.e.neg && cand.e.minNet===best.e.minNet && cand.delta<best.delta)) best = cand;
          break;                                           // stop at this item's first improving value
        }
      }
    }
    if(!best) break;                                       // no remaining move helps anywhere
    cur[best.i] = best.v; now = { neg:best.e.neg, minNet:best.e.minNet }; guard++;
  }
  // Prune overshoot: walk every extension back toward its original while the fix holds.
  if(now.neg===0){
    let changed = true;
    while(changed){ changed=false;
      for(let i=0;i<state.length;i++){
        if(cur[i]-STEP < orig[i]) continue;            // never below the current term
        const trial = cur.slice(); trial[i] = cur[i]-STEP;
        if(evalWith(trial).neg===0){ cur[i]=trial[i]; changed=true; }
      }
    }
  }
  const after = evalWith(cur);
  state.forEach((it,i)=>{ it.credit=orig[i]; });       // restore live state exactly…
  recompute();                                         // …and reset global N / dyn-grid
  const changes = [];
  state.forEach((it,i)=>{ if(cur[i]!==orig[i]) changes.push({ i, key:it.key, name:(LABELS[it.key]||it.key), from:orig[i], to:cur[i], delta:cur[i]-orig[i] }); });
  return { before, after, changes, totalDelta:changes.reduce((s,c)=>s+c.delta,0),
           recommend:cur, orig, cleared:after.neg===0,
           improved:(after.neg<before.neg || after.minNet>before.minNet+1e-6) };
}

function openOptimizer(){
  renderOptimizerBounds();
  document.getElementById('optResults').innerHTML =
    '<div style="text-align:center;padding:28px 10px;color:var(--muted);font-size:13px;line-height:1.5;">'
    +'Each item is constrained to its <strong style="color:var(--text)">Min–Max credit band</strong> '
    +'(seeded from your four reference projects, editable above). '
    +'Run the optimizer to find the smallest set of credit extensions that turns cash positive.</div>';
  window._lastOptPlan = null;
  document.getElementById('optimizerModal').style.display = 'flex';
}
function closeOptimizer(){ document.getElementById('optimizerModal').style.display = 'none'; }

function setCreditBound(i, which, val){
  const it = state[i]; if(!it) return;
  let v = parseInt(val); if(isNaN(v)) v = 0;
  v = Math.max(0, Math.min(270, Math.round(v/15)*15));
  if(which==='min'){ it.creditMin = v; if(it.creditMax!=null && it.creditMax<v) it.creditMax=v; }
  else            { it.creditMax = v; if(it.creditMin!=null && it.creditMin>v) it.creditMin=v; }
  renderOptimizerBounds();
}
function renderOptimizerBounds(){
  const host = document.getElementById('optBounds'); if(!host) return;
  // Show items that are part of the model (cost entered) or that have any negotiating headroom.
  const rows = state.map((it,i)=>({it,i})).filter(o=>{ const b=_creditBand(o.it); return o.it.cost>0 || b.hi>b.lo; });
  if(!rows.length){ host.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px;">No priced items yet — enter vendor costs first.</div>'; return; }
  let h = '<div style="display:grid;grid-template-columns:1.4fr 64px 70px 70px 60px;gap:6px 10px;align-items:center;font-size:11px;">'
    + '<div style="font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Item</div>'
    + '<div style="font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:right;">Current</div>'
    + '<div style="font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:center;">Min&nbsp;d</div>'
    + '<div style="font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:center;">Max&nbsp;d</div>'
    + '<div style="font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:right;">Room</div>';
  rows.forEach(({it,i})=>{
    const b = _creditBand(it);
    const room = b.hi - it.credit;
    const lever = room>0;
    const inp = (which,val)=>'<input type="number" min="0" max="270" step="15" value="'+val+'" onchange="setCreditBound('+i+',\''+which+'\',this.value)" style="width:100%;font-family:var(--font-mono);font-size:12px;padding:4px 5px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text);text-align:right;">';
    h += '<div style="font-size:12px;color:var(--text);'+(lever?'font-weight:600;':'')+'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(LABELS[it.key]||it.key)+'</div>'
      + '<div style="text-align:right;font-family:var(--font-mono);color:var(--muted);">'+it.credit+'d</div>'
      + '<div>'+inp('min', b.lo)+'</div>'
      + '<div>'+inp('max', b.hi)+'</div>'
      + '<div style="text-align:right;font-family:var(--font-mono);font-weight:700;color:'+(lever?'var(--green-text)':'var(--muted)')+';">'+(lever?'+'+room+'d':'—')+'</div>';
  });
  h += '</div>';
  host.innerHTML = h;
}
function runOptimizer(){
  const host = document.getElementById('optResults');
  host.innerHTML = '<div style="text-align:center;padding:28px;color:var(--muted);font-size:13px;">Searching credit combinations…</div>';
  setTimeout(()=>{                                  // defer so the "searching" line paints
    const plan = planCreditOptimization();
    window._lastOptPlan = plan;
    host.innerHTML = renderOptPlan(plan);
  }, 30);
}
function renderOptPlan(p){
  const f = n => (n<0?'−':'')+'₹'+Math.abs(n).toFixed(1)+' Cr';
  const pill = (label,val,col)=>'<div style="flex:1;min-width:120px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;">'
    +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">'+label+'</div>'
    +'<div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:'+col+';">'+val+'</div></div>';
  const negCol = n => n>0 ? 'var(--red-text)' : 'var(--green-text)';
  let h = '';
  // verdict banner
  if(!p.changes.length){
    h += '<div style="background:var(--green-bg);border:1px solid var(--green);border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:13px;color:var(--green-text);font-weight:600;">'
      + (p.before.neg===0 ? '✓ Cash is already positive across every month — no credit changes needed.'
                          : '⚠ No credit headroom within the current Min–Max bands. Raise the Max credit on the items you can negotiate, then run again.')
      + '</div>';
  } else {
    h += '<div style="background:'+(p.cleared?'var(--green-bg)':'rgba(246,169,59,0.12)')+';border:1px solid '+(p.cleared?'var(--green)':'var(--amber)')+';border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:13px;color:'+(p.cleared?'var(--green-text)':'var(--amber)')+';font-weight:600;">'
      + (p.cleared ? '✓ Found a fix: cash turns positive across all months with '+p.changes.length+' credit change'+(p.changes.length>1?'s':'')+' (+'+p.totalDelta+' days total).'
                   : '◐ Best achievable within the bands: shortfall cut to '+p.after.neg+' month'+(p.after.neg>1?'s':'')+'. Widen a Max credit to push further.')
      + '</div>';
  }
  // before / after pills
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">'
    + pill('Neg. months — now', p.before.neg, negCol(p.before.neg))
    + pill('Neg. months — after', p.after.neg, negCol(p.after.neg))
    + pill('Lowest cash — now', f(p.before.minNet), p.before.minNet<0?'var(--red-text)':'var(--green-text)')
    + pill('Lowest cash — after', f(p.after.minNet), p.after.minNet<0?'var(--red-text)':'var(--green-text)')
    + '</div>';
  // change list
  if(p.changes.length){
    h += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--blue);margin-bottom:8px;">Recommended credit changes</div>';
    h += '<div style="display:flex;flex-direction:column;gap:6px;">';
    p.changes.forEach(c=>{
      h += '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:13px;">'
        + '<span style="color:var(--text);font-weight:600;">'+c.name+'</span>'
        + '<span style="font-family:var(--font-mono);color:var(--muted);">'+c.from+'d <span style="color:var(--blue);">→</span> <span style="color:var(--green-text);font-weight:700;">'+c.to+'d</span> <span style="color:var(--green-text);">(+'+c.delta+')</span></span>'
        + '</div>';
    });
    h += '</div>';
    h += '<div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px;">'
      + '<button onclick="closeOptimizer()">Cancel</button>'
      + '<button class="primary" onclick="applyOptimizer()">Apply recommendation</button></div>';
  }
  return h;
}
function applyOptimizer(){
  const p = window._lastOptPlan;
  if(!p || !p.changes.length){ closeOptimizer(); return; }
  flushHistory();                                   // one undoable step
  state.forEach((it,i)=>{ it.credit = p.recommend[i]; });
  buildVC(); render();
  closeOptimizer();
  showToast(p.cleared?'save':'warning',
    p.cleared?'Cashflow Optimized':'Best Effort Applied',
    p.cleared ? ('Cleared all negative months with +'+p.totalDelta+' credit-days across '+p.changes.length+' item'+(p.changes.length>1?'s':'')+'.')
              : ('Shortfall reduced to '+p.after.neg+' month'+(p.after.neg>1?'s':'')+'. Widen a Max credit bound to improve further.'));
}

/* HISTORY (undo / redo)  +  NAMED SCENARIOS — One serializer drives both. captureHistory() runs debounced off every render, — so we don't have to instrument each individual setter. */
let _undoStack = [], _redoStack = [], _histBase = null, _histTimer = null;
let _restoringHistory = false, _dirty = false, _scenarioGhost = false, _ghostLabel = 'Baseline';

// Full app state → JSON string. Reuses _snapshotModel() to fold the live model in.
function _serializeAll(){
  _snapshotModel();
  return JSON.stringify({
    modelStore, client:CLIENT, project:PROJECT, projectValue:PROJECT_VALUE,
    projectMonths:PROJECT_MONTHS, fxStress:FX_STRESS, dcCapacity:DC_CAPACITY,
    margin:MARGIN, model:MODEL
  });
}

// Assign a parsed blob back into the live globals. withUI=false → no DOM rebuild
// (used for silent scenario-vs comparison); withUI=true → full visual restore.
function _applyBlob(d, withUI){
  if(d.modelStore) modelStore = JSON.parse(JSON.stringify(d.modelStore));
  MODEL = d.model || 'cashflow';
  ACTIVE_BASE = (MODEL==='procurement') ? PROC_BASE : BASE;
  SVCS = (MODEL==='procurement') ? [] : SVCS_CF;
  const snap = modelStore[MODEL];
  if(snap){
    state = snap.state.map(it=>({...it, prPct:{...it.prPct}}));
    outOverrides = JSON.parse(JSON.stringify(snap.outOverrides || {}));
    inOverrides  = JSON.parse(JSON.stringify(snap.inOverrides  || {}));
    MARGIN = snap.margin;
  }
  if(d.client) CLIENT = JSON.parse(JSON.stringify(d.client));
  if(d.project) PROJECT = d.project;
  if(d.projectValue  !== undefined) PROJECT_VALUE  = d.projectValue;
  if(d.projectMonths !== undefined){ PROJECT_MONTHS = d.projectMonths; MIN_N = PROJECT_MONTHS; }
  if(d.fxStress      !== undefined) FX_STRESS  = d.fxStress;
  if(d.dcCapacity    !== undefined) DC_CAPACITY = d.dcCapacity;
  if(d.margin        !== undefined) MARGIN = d.margin;
  BASE_COSTS = Object.fromEntries(state.map(it=>[it.key, it.cost]));
  if(withUI){
    baselineNet = null;
    updateModelButton();
    rebuildSvcProg(1); rebuildIdcFixed(1);
    buildVC(); buildClientInputs(); syncKpiInputs();
    // keep the toolbar inputs that syncKpiInputs doesn't own in sync
    const fxD=document.getElementById('fx-stress-display'); if(fxD) fxD.textContent=(FX_STRESS>0?'+':'')+FX_STRESS;
    const fxS=document.querySelector('input[oninput*="setFxStress"]'); if(fxS) fxS.value=FX_STRESS;
    const dInp=document.getElementById('projDate');
    if(dInp){ const mStr=(PROJECT.startM+1).toString().padStart(2,'0'); dInp.value=PROJECT.startY+'-'+mStr; }
    render();
  }
}

// Restore a serialized string into the live app (full visual restore).
function _restoreAll(serial){
  _restoringHistory = true;
  try { _applyBlob(JSON.parse(serial), true); }
  finally { _restoringHistory = false; }
}

// Set the "current committed" snapshot and auto-persist it as the working session
// (restored on next boot — supersedes the old manual "Save Scenario" button).
/* In-memory commit only — used by the undo/redo history. Persisting to
   localStorage is intentionally NOT done here: the working scenario is saved
   only when the user clicks the Save button (see saveWork). */
function _setBase(serial){ _histBase = serial; }

/* Explicit manual save of the current working scenario to this browser. */
function saveWork(){
  try{ localStorage.setItem('lt_cashflow_save', _serializeAll()); }catch(e){}
  _markDirty(false);
  showToast('save','Saved','Your changes have been saved to this browser.');
}

// Force any pending debounced edit to commit as its own undo step, right now.
function flushHistory(){
  clearTimeout(_histTimer);
  const cur = _serializeAll();
  if(_histBase === null){ _setBase(cur); return; }
  if(cur === _histBase) return;
  _undoStack.push(_histBase);
  if(_undoStack.length > 80) _undoStack.shift();
  _redoStack.length = 0;
  _setBase(cur);
  _markDirty(true);
}

// Debounced: called at the tail of every _doRender(). Coalesces slider drags into one step.
function captureHistory(){
  if(_restoringHistory) return;
  clearTimeout(_histTimer);
  _histTimer = setTimeout(()=>{ flushHistory(); _updateHistoryUI(); }, 420);
}

// Apply a serialized snapshot to the live app and adopt it as the new committed base
// (used by undo/redo/scenario-load — these manage the stacks themselves).
function _applyAndSetBase(serial){
  _restoringHistory = true;
  try { _applyBlob(JSON.parse(serial), true); _setBase(_serializeAll()); }
  finally { _restoringHistory = false; }
}

function undoAction(){
  flushHistory();                 // capture any in-flight edit before stepping back
  if(!_undoStack.length){ _updateHistoryUI(); return; }
  _redoStack.push(_histBase);
  const prev = _undoStack.pop();
  _applyAndSetBase(prev);
  _markDirty(true);
  _updateHistoryUI();
  showToast('undo','Undid Change','Reverted to the previous state.');
}
function redoAction(){
  flushHistory();                 // a fresh edit after undo correctly invalidates redo
  if(!_redoStack.length){ _updateHistoryUI(); return; }
  _undoStack.push(_histBase);
  const next = _redoStack.pop();
  _applyAndSetBase(next);
  _markDirty(true);
  _updateHistoryUI();
  showToast('undo','Redid Change','Re-applied the change.');
}

function _updateHistoryUI(){
  const u=document.getElementById('btnUndo'), rd=document.getElementById('btnRedo');
  if(u){ u.disabled=!_undoStack.length; u.style.opacity=_undoStack.length?'1':'.4'; u.style.cursor=_undoStack.length?'pointer':'not-allowed'; }
  if(rd){ rd.disabled=!_redoStack.length; rd.style.opacity=_redoStack.length?'1':'.4'; rd.style.cursor=_redoStack.length?'pointer':'not-allowed'; }
}

function _markDirty(on){
  _dirty = on;
  const dot=document.getElementById('saveDirtyDot');
  if(dot) dot.style.display = on ? 'inline-block' : 'none';
}

// Ctrl/⌘+Z = undo, Ctrl/⌘+Y or Ctrl/⌘+Shift+Z = redo.
// Skip when typing in a text/number field so the field's own native undo still works
// (sliders have no native undo, so model-undo is allowed while one is focused).
function _isTextEditing(el){
  if(!el) return false;
  if(el.isContentEditable) return true;
  if(el.tagName==='TEXTAREA') return true;
  if(el.tagName==='INPUT'){ return el.type!=='range' && el.type!=='checkbox' && el.type!=='radio'; }
  return false;
}
document.addEventListener('keydown', e=>{
  if(!(e.ctrlKey||e.metaKey) || e.altKey) return;
  const k=(e.key||'').toLowerCase();
  if(document.querySelector('.modal') && Array.from(document.querySelectorAll('.modal')).some(m=>getComputedStyle(m).display!=='none')) return; // let modals own the keyboard
  if(k==='z' && !e.shiftKey){ if(_isTextEditing(document.activeElement)) return; e.preventDefault(); undoAction(); }
  else if(k==='y' || (k==='z' && e.shiftKey)){ if(_isTextEditing(document.activeElement)) return; e.preventDefault(); redoAction(); }
});

/* Named scenarios (multi-slot) */
function _loadScenarioMap(){ try{ return JSON.parse(localStorage.getItem('lt_cashflow_scenarios')||'{}'); }catch(e){ return {}; } }
function _saveScenarioMap(m){ try{ localStorage.setItem('lt_cashflow_scenarios', JSON.stringify(m)); }catch(e){} }

function saveScenarioAs(){
  const name = (prompt('Name this scenario (e.g. Base, Lender Case, Stress Case):','')||'').trim();
  if(!name) return;
  const map = _loadScenarioMap();
  const exists = !!map[name];
  if(exists && !confirm('A scenario named "'+name+'" already exists. Overwrite it?')) return;
  map[name] = { data: JSON.parse(_serializeAll()), ts: Date.now() };
  _saveScenarioMap(map);
  _markDirty(false);
  refreshScenarioUI(name);
  showToast('save','Scenario Saved', '"'+name+'" '+(exists?'updated':'saved')+'.');
}

function loadSelectedScenario(){
  const sel=document.getElementById('scenarioSelect'); if(!sel||!sel.value) return;
  const map=_loadScenarioMap(); const entry=map[sel.value]; if(!entry) return;
  flushHistory();                              // commit current edits…
  if(_histBase!==null){ _undoStack.push(_histBase); if(_undoStack.length>80) _undoStack.shift(); }
  _redoStack.length=0;                         // …then make the load itself undoable
  _scenarioGhost=false;                        // a fresh load clears any comparison overlay
  const cmp=document.getElementById('scenarioCompare'); if(cmp) cmp.value='';
  _applyAndSetBase(JSON.stringify(entry.data));
  _markDirty(false);
  _updateHistoryUI();
  showToast('save','Scenario Loaded','Now showing "'+sel.value+'".');
}

function deleteSelectedScenario(){
  const sel=document.getElementById('scenarioSelect'); if(!sel||!sel.value) return;
  const name=sel.value;
  if(!confirm('Delete scenario "'+name+'"? This cannot be undone.')) return;
  const map=_loadScenarioMap(); delete map[name]; _saveScenarioMap(map);
  const cmp=document.getElementById('scenarioCompare');
  if(cmp && cmp.value===name){ _scenarioGhost=false; render(); }
  refreshScenarioUI();
  showToast('reset','Scenario Deleted','"'+name+'" removed.');
}

// Overlay a saved scenario's cumulative-balance line as the ghost/baseline — without
// disturbing the live model. Computes its net via a silent swap, then restores.
function compareAgainstScenario(){
  const cmp=document.getElementById('scenarioCompare'); if(!cmp) return;
  const name=cmp.value;
  if(!name){ _scenarioGhost=false; _ghostLabel='Baseline'; render(); return; }
  const map=_loadScenarioMap(); const entry=map[name]; if(!entry) return;
  const backup=_serializeAll();
  let ghostNet;
  _restoringHistory=true;
  try{
    _applyBlob(entry.data, false);
    ghostNet=[...recompute().net];
  } finally {
    _applyBlob(JSON.parse(backup), false);
    recompute();                  // reset global N / dyn-grid back to the live model
    _restoringHistory=false;
  }
  baselineNet = ghostNet;
  _scenarioGhost = true;
  _ghostLabel = name;
  render();
}

function refreshScenarioUI(selectName){
  const map=_loadScenarioMap();
  const names=Object.keys(map).sort((a,b)=>(map[b].ts||0)-(map[a].ts||0));
  const esc=n=>n.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const sel=document.getElementById('scenarioSelect');
  const cmp=document.getElementById('scenarioCompare');
  if(sel){
    const keep=selectName||sel.value;
    sel.innerHTML = names.length
      ? names.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('')
      : '<option value="">No saved scenarios</option>';
    if(keep && map[keep]) sel.value=keep;
  }
  if(cmp){
    const keepC=cmp.value;
    cmp.innerHTML='<option value="">Compare vs… (none)</option>'+
      names.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
    if(keepC && map[keepC]) cmp.value=keepC; else { _scenarioGhost=false; }
  }
  const hasAny=names.length>0;
  ['btnLoadScenario','btnDeleteScenario'].forEach(id=>{
    const b=document.getElementById(id); if(b){ b.disabled=!hasAny; b.style.opacity=hasAny?'1':'.4'; b.style.cursor=hasAny?'pointer':'not-allowed'; }
  });
}

/* MODEL SWITCH — Cash Flow  ⇄  Procurement — Same engine; swaps the active item set. Each model keeps its own edits. */
function _snapshotModel(){
  modelStore[MODEL] = {
    state: JSON.parse(JSON.stringify(state)),
    outOverrides: JSON.parse(JSON.stringify(outOverrides)),
    inOverrides: JSON.parse(JSON.stringify(inOverrides)),
    margin: MARGIN,
  };
}
function toggleModel(){ switchModel(MODEL==='procurement' ? 'cashflow' : 'procurement'); }
function switchModel(target){
  if(target===MODEL) return;
  if(isCompareMode) toggleCompareMode(false);   // leave compare mode cleanly before snapshot
  _snapshotModel();
  MODEL = target;
  ACTIVE_BASE = (target==='procurement') ? PROC_BASE : BASE;
  SVCS = (target==='procurement') ? [] : SVCS_CF;
  if(modelStore[target]){
    const snap = modelStore[target];
    state = snap.state.map(it=>({...it, prPct:{...it.prPct}}));
    // deep-clone so later cell edits don't mutate the stored snapshot (state is cloned above; these must be too)
    outOverrides = JSON.parse(JSON.stringify(snap.outOverrides || {}));
    inOverrides = JSON.parse(JSON.stringify(snap.inOverrides || {}));
    MARGIN = snap.margin;
    pruneOrphanOverrides();   // self-heal stale pro-rata overrides on model switch
  } else {
    state = ACTIVE_BASE.map(it=>({...it, prPct:{...it.prPct}}));
    outOverrides = {}; inOverrides = {};
    const totalCost = state.reduce((s,it)=>s+it.cost,0);
    MARGIN = PROJECT_VALUE>0 ? (1 - totalCost/PROJECT_VALUE)*100 : MARGIN;
  }
  BASE_COSTS = Object.fromEntries(state.map(it=>[it.key, it.cost]));
  baselineNet = null;
  // Reset the vendor filter dropdown so it rebuilds for the new item set
  window.activeVendorFilter = 'all';
  const fs=document.getElementById('vendorItemFilter'); if(fs) fs.innerHTML='';
  const vt=document.getElementById('vd-selected-text'); if(vt) vt.textContent='All Items';
  updateModelButton();
  buildVC(); render();
}
function updateModelButton(){
  const proc = MODEL==='procurement';
  const btnCf = document.getElementById('btn-model-cashflow');
  const btnProc = document.getElementById('btn-model-procurement');
  
  if(btnCf && btnProc) {
    if(proc) {
      btnProc.style.background = 'var(--blue)';
      btnProc.style.color = '#fff';
      btnCf.style.background = 'transparent';
      btnCf.style.color = 'var(--muted)';
    } else {
      btnCf.style.background = 'var(--blue)';
      btnCf.style.color = '#fff';
      btnProc.style.background = 'transparent';
      btnProc.style.color = 'var(--muted)';
    }
  }
}


function runSensitivity() {
  const baseNet = recompute().minNet;
  if(baseNet >= 0) {
    renderSensitivityModal([], [], { achieved: true, text: 'Your Peak Funding Requirement is already positive (₹' + baseNet.toFixed(2) + ' Cr). No immediate negotiations are required.' });
    return;
  }

  const singleMoves = [];
  const pairMoves = [];
  
  // 1. Single Moves (Vendor +30 and +1 mo)
  state.forEach((vendor, i) => {
    // +30 Days Credit
    const originalCredit = vendor.credit;
    vendor.credit += 30;
    const testCalc = recompute();
    const imp1 = testCalc.minNet - baseNet;
    singleMoves.push({ type: 'credit', name: (LABELS[vendor.key] || vendor.key) + ' (+30 Days Credit)', impact: imp1 });
    vendor.credit = originalCredit;
    
    // +1 Month Delay
    const originalStart = vendor.start;
    vendor.start += 1;
    const testCalc2 = recompute();
    const imp2 = testCalc2.minNet - baseNet;
    singleMoves.push({ type: 'start', name: (LABELS[vendor.key] || vendor.key) + ' (+1 Month Delay)', impact: imp2 });
    vendor.start = originalStart;
  });

  // 2. Pair Moves (+30 days on Vendor A AND Vendor B)
  for(let i=0; i<state.length; i++) {
    for(let j=i+1; j<state.length; j++) {
      const v1 = state[i];
      const v2 = state[j];
      const oc1 = v1.credit;
      const oc2 = v2.credit;
      
      // Get individual impacts first
      v1.credit = oc1 + 30;
      v2.credit = oc2;
      const imp1 = recompute().minNet - baseNet;
      
      v1.credit = oc1;
      v2.credit = oc2 + 30;
      const imp2 = recompute().minNet - baseNet;
      
      // Get pair impact
      v1.credit = oc1 + 30;
      v2.credit = oc2 + 30;
      const impPair = recompute().minNet - baseNet;
      
      // Only add if synergy is strictly greater than both individual moves
      if(impPair > 0.01 && impPair > Math.max(imp1, imp2) + 0.01) {
        pairMoves.push({ 
          name: (LABELS[v1.key] || v1.key) + ' & ' + (LABELS[v2.key] || v2.key) + ' (+30 Days Both)', 
          impact: impPair 
        });
      }
      v1.credit = oc1;
      v2.credit = oc2;
    }
  }

  // 3. Goal Seek (Break-even on highest cost vendor)
  let highestVendor = state.reduce((prev, current) => (prev.cost > current.cost) ? prev : current);
  let goalSeek = null;
  const ocGoal = highestVendor.credit;
  
  for(let c=ocGoal; c<=360; c+=15) {
    highestVendor.credit = c;
    if(recompute().minNet >= 0) {
      goalSeek = { vendor: LABELS[highestVendor.key] || highestVendor.key, target: c };
      break;
    }
  }
  highestVendor.credit = ocGoal; // restore

  // Sort and filter
  const topSingles = singleMoves.sort((a,b) => b.impact - a.impact).slice(0, 5);
  const topPairs = pairMoves.sort((a,b) => b.impact - a.impact).slice(0, 3);
  
  renderSensitivityModal(topSingles, topPairs, goalSeek);
}

function renderSensitivityModal(singles, pairs, goalSeek) {
  const container = document.getElementById('sensitivityResults');
  if(!container) return;
  
  if(goalSeek && goalSeek.achieved) {
    container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--green-text); font-size:16px; font-weight:600;">' + goalSeek.text + '</div>';
    document.getElementById('sensitivityModal').style.display = 'flex';
    return;
  }

  let html = '';
  
  // Section 1: Break-even Goal Seek
  if(goalSeek) {
    html += '<div style="background:rgba(40,167,69,0.1); border:1px solid var(--green); border-radius:8px; padding:16px; margin-bottom:24px;">' +
        '<div style="font-size:12px; font-weight:700; color:var(--green); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;">Target Goal (Break-Even)</div>' +
        '<div style="font-size:14px; color:var(--text);">To completely eliminate the peak funding deficit (Net Cash &#8377;0.00), you must negotiate a minimum of <span style="font-weight:800; color:var(--green-text);">' + goalSeek.target + ' days</span> of credit for <b>' + goalSeek.vendor + '</b>.</div>' +
      '</div>';
  } else {
    html += '<div style="background:rgba(220,53,69,0.1); border:1px solid var(--red); border-radius:8px; padding:16px; margin-bottom:24px;">' +
        '<div style="font-size:12px; font-weight:700; color:var(--red); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;">Break-Even Not Reachable</div>' +
        '<div style="font-size:14px; color:var(--text);">Even if you push your largest vendor to 360 days of credit, you cannot self-fund this project purely on vendor terms.</div>' +
      '</div>';
  }

  // Section 2: Combinations
  if(pairs.length > 0) {
    html += '<h3 style="font-size:14px; font-weight:700; color:var(--text); margin-bottom:12px; border-bottom:1px solid var(--border); padding-bottom:8px;">Top Combined Strategies</h3>';
    const maxImpP = Math.max(0.1, pairs[0].impact);
    pairs.forEach((item, index) => {
      const pct = Math.max(2, (item.impact / maxImpP) * 100);
      html += '<div style="margin-bottom: 16px;">' +
          '<div style="display:flex; justify-content:space-between; margin-bottom:6px;">' +
            '<span style="font-size:13px; font-weight:600; color:var(--text);">' + item.name + '</span>' +
            '<span style="font-size:13px; font-weight:700; color:var(--green-text);">+&#8377;' + item.impact.toFixed(2) + ' Cr</span>' +
          '</div>' +
          '<div style="height: 8px; background:var(--surface-2); border-radius:4px; overflow:hidden;">' +
            '<div style="height:100%; width:' + pct + '%; background:var(--green); border-radius:4px;"></div>' +
          '</div>' +
        '</div>';
    });
  }

  // Section 3: Singles
  if(singles.length > 0) {
    html += '<h3 style="font-size:14px; font-weight:700; color:var(--text); margin-bottom:12px; margin-top:24px; border-bottom:1px solid var(--border); padding-bottom:8px;">Top Isolated Moves</h3>';
    const maxImpS = Math.max(0.1, singles[0].impact);
    singles.forEach((item, index) => {
      const isZero = item.impact <= 0.01;
      const pct = isZero ? 0 : Math.max(2, (item.impact / maxImpS) * 100);
      const color = isZero ? 'var(--muted)' : 'var(--green-text)';
      const barColor = isZero ? 'var(--border)' : 'var(--blue)';
      const impactText = isZero ? 'No Impact' : '+&#8377;' + item.impact.toFixed(2) + ' Cr';
      html += '<div style="margin-bottom: 16px;">' +
          '<div style="display:flex; justify-content:space-between; margin-bottom:6px;">' +
            '<span style="font-size:13px; font-weight:600; color:var(--text);">' + item.name + '</span>' +
            '<span style="font-size:13px; font-weight:700; color:' + color + ';">' + impactText + '</span>' +
          '</div>' +
          '<div style="height: 8px; background:var(--surface-2); border-radius:4px; overflow:hidden;">' +
            '<div style="height:100%; width:' + pct + '%; background:' + barColor + '; border-radius:4px;"></div>' +
          '</div>' +
        '</div>';
    });
  }

  container.innerHTML = html;
  document.getElementById('sensitivityModal').style.display = 'flex';
}

function closeSensitivityModal() {
  document.getElementById('sensitivityModal').style.display = 'none';
}






function autoSizeInput(el){
  // Let flexbox handle sizing — no fixed width needed
  el.style.width = '';
}
function syncKpiInputs(){
  const pv=document.getElementById('k-pv-input');
  const gm=document.querySelectorAll('#k-gmp-input');
  const pm=document.getElementById('k-pm-input');
  const dc=document.getElementById('k-dc-input');
  const active=document.activeElement;
  if(pv && pv!==active){ pv.value=parseFloat(PROJECT_VALUE.toFixed(2)); autoSizeInput(pv); }
  gm.forEach(el=>{ if(el!==active){ el.value=+MARGIN.toFixed(2); autoSizeInput(el); } });
  if(pm && pm!==active){ pm.value=PROJECT_MONTHS; autoSizeInput(pm); }
  if(dc && dc!==active){ dc.value=parseFloat(DC_CAPACITY.toFixed(2)); autoSizeInput(dc); }
}

try{ applyTheme( window.LTTheme ? (LTTheme.current()==='light') : (localStorage.getItem('lt_theme')==='light') ); }catch(e){}

/* ---- Boot sequence ----------------------------------------------------------
   Paint the splash first, THEN run the heavy synchronous build, THEN reveal the
   dashboard so the user never watches it assemble itself. ----------------------*/
(function(){
  const loader   = document.getElementById('bootLoader');
  const statusEl = document.getElementById('blStatus');
  const t0       = (window.performance && performance.now) ? performance.now() : 0;
  const MIN_SHOW = 650;                       // hold the splash long enough to read (premium feel)
  let   cycle, revealed = false, built = false;

  if (statusEl){
    const steps = ['Initializing model…','Loading vendor terms…','Computing cash-flow…','Rendering charts…'];
    let i = 0;
    cycle = setInterval(()=>{ i = (i+1) % steps.length; statusEl.textContent = steps[i]; }, 320);
  }

  function reveal(){
    if (revealed) return; revealed = true;
    if (cycle) clearInterval(cycle);
    document.body.classList.add('booted');    // triggers the rise-in reveal
    if (loader){
      if (statusEl) statusEl.textContent = 'Ready';
      loader.classList.add('done');
      setTimeout(()=>{ if (loader && loader.parentNode) loader.remove(); }, 650);
    }
  }

  function build(){
    if (built) return;                        // idempotent — only ever build once
    try{
      _vtInteracting = true;                  // suppress the page-wide crossfade for the boot render
      rebuildSvcProg(PROJECT_MONTHS / 33); buildClientInputs(); buildVC(); render();
      built = true;                           // mark done only AFTER a successful build, so a throwing first render lets the fallback retry
      requestAnimationFrame(() => syncKpiInputs());
      // History + scenario UI: establish the baseline snapshot and populate the dropdowns.
      try{
        flushHistory();                       // adopt the freshly-built state as the undo base
        refreshScenarioUI();
        _updateHistoryUI();
        _markDirty(false);
      }catch(e){}
    } finally {
      _vtInteracting = false;
      const elapsed = ((window.performance && performance.now) ? performance.now() : MIN_SHOW) - t0;
      setTimeout(reveal, Math.max(0, MIN_SHOW - elapsed));
    }
  }

  // Defer one paint so the splash is on screen before the heavy build blocks the thread.
  requestAnimationFrame(() => requestAnimationFrame(build));
  // Fallback: rAF is throttled in background tabs, so guarantee the build runs anyway.
  setTimeout(build, 250);
  // Safety nets so the splash can never get stuck
  window.addEventListener('load', () => setTimeout(reveal, 1500));
  setTimeout(reveal, 8000);
})();

// Manager Logic
let activeCmItem = null;
function openCurveManager() {
  document.getElementById('managerModal').style.display = 'flex';
  renderCmSidebar();
  selectCmItem(state[0].key);
}
function closeManager() {
  document.getElementById('managerModal').style.display = 'none';
  rebuildSvcProg(PROJECT_MONTHS / 33);
  render();
  buildVC();
}
function renderCmSidebar() {
  const sb = document.getElementById('cm-sidebar');
  sb.innerHTML = state.map(it => `
    <div onclick="selectCmItem('${it.key}')" 
         style="padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;
                background:${activeCmItem===it.key ? 'var(--border)' : 'transparent'}">
      ${LABELS[it.key] || it.key}
      ${it.curveBase ? '<span style="float:right;width:8px;height:8px;background:var(--blue);border-radius:50%;margin-top:4px;"></span>' : ''}
    </div>
  `).join('');
}
function selectCmItem(key) {
  activeCmItem = key;
  renderCmSidebar();
  const it = state.find(x => x.key === key);
  const ed = document.getElementById('cm-editor');
  const hasCustom = !!it.curveBase;
  
  let desc = "Flat Distribution (Equal Lots)";
  if(it.svc) desc = "Predefined Bell Curve";
  else if(it.vfs) desc = "Module VFS Curve [0.8, 1, ..., 0.15, 0.05]";

  
  let html = `<h2 style="margin-top:0;font-size:20px;">${LABELS[key] || key}</h2>`;
  
  
  html += `<div style="margin-bottom:20px;display:flex;gap:20px;">
    <label style="cursor:pointer;display:flex;align-items:center;gap:6px;"><input type="radio" name="ctype" onchange="setCurveType('${key}', 'standard')" ${!hasCustom ? 'checked' : ''}> Standard Logic</label>
    <label style="cursor:pointer;display:flex;align-items:center;gap:6px;"><input type="radio" name="ctype" onchange="setCurveType('${key}', 'custom')" ${hasCustom ? 'checked' : ''}> Custom Curve</label>
  </div>`;
  
  if(!hasCustom) {
    html += `<div style="padding:20px;background:var(--surface);border-radius:8px;color:var(--muted);font-size:13px;line-height:1.6;">
      Currently using standard mathematical shape: <strong style="color:var(--text);">${desc}</strong>.<br><br>
      To override this shape with your own specific monthly percentages, select "Custom Curve" above.<br>
      Note: Setting a custom curve will override the "Lots" and "Gap" sliders.
    </div>`;
  } else {
    html += `<div id="cm-inputs" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;"></div>
    <div style="text-align:right;font-weight:600;font-size:15px;margin-bottom:20px;color:var(--text);">Curve Sum: <span id="cm-sum-lbl" style="color:var(--blue);">0</span></div>`;
    html += `<button onclick="addCmMonth('${key}')" style="padding:8px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text);font-weight:500;">+ Add Month</button>`;
  }
  ed.innerHTML = html;
  if(hasCustom) renderCmInputs(it);
}
function setCurveType(key, type) {
  const it = state.find(x => x.key === key);
  if(type === 'custom') {
    if(!it.curveBase) {
      if(it.svc) it.curveBase = {...(key==='Civil'?CIVIL_BASE:EREC_BASE)};
      else it.curveBase = {1:33.3, 2:33.3, 3:33.4};
    }
  } else {
    it.curveBase = null;
    it.curve = null;
  }
  selectCmItem(key);
}
function renderCmInputs(it) {
  const container = document.getElementById('cm-inputs');
  const base = it.curveBase;
  const maxM = Math.max(...Object.keys(base).map(Number), 0);
  let html = '';
  for(let i=1; i<=maxM; i++) {
    html += `<div style="background:var(--bg);padding:10px;border-radius:8px;border:1px solid var(--border);">
               <div style="font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Month ${i}</div>
               <div style="display:flex;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;">
                 <input type="number" step="0.1" min="0" value="${base[i]||0}" 
                        oninput="updateCmVal('${it.key}', ${i}, this.value)"
                        style="width:100%;box-sizing:border-box;padding:8px;border:none;background:transparent;color:var(--text);font-family:inherit;font-size:14px;font-weight:500;outline:none;">
                 <span style="padding-right:12px;color:var(--muted);font-weight:bold;font-size:12px;">%</span>
               </div>
             </div>`;
  }
  container.innerHTML = html;
  const tot = Object.values(base).reduce((a,b)=>a+b,0);
  const sumEl = document.getElementById('cm-sum-lbl');
  if(sumEl) sumEl.textContent = tot.toFixed(2);
}
function updateCmVal(key, month, val) {
  const it = state.find(x => x.key === key);
  if(it && it.curveBase) {
    it.curveBase[month] = parseFloat(val) || 0;
    const tot = Object.values(it.curveBase).reduce((a,b)=>a+b,0);
    const sumEl = document.getElementById('cm-sum-lbl');
    if(sumEl) sumEl.textContent = tot.toFixed(2);
  }
}
function addCmMonth(key) {
  const it = state.find(x => x.key === key);
  if(it && it.curveBase) {
    const maxM = Math.max(...Object.keys(it.curveBase).map(Number), 0);
    it.curveBase[maxM + 1] = 0;
    renderCmInputs(it);
  }
}

/* EXPORT SUMMARY REPORT  — standalone HTML page, opens in new tab */
function exportSummary(){
  const r = recompute();
  const isLight = themeIsLight();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  const timeStr = now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});

  /* helpers */
  const cr = v => '₹' + v.toFixed(2) + ' Cr';
  const pct = v => v.toFixed(1) + '%';
  const totalCost = state.reduce((s,it)=>s+it.cost,0);
  const gm = r.totalIn - r.totalOut;
  const gmPct = r.totalIn > 0 ? (gm / r.totalIn * 100) : 0;
  const specificCost = DC_CAPACITY > 0 ? totalCost / DC_CAPACITY : 0;

  /* quarterly cashflow aggregation */
  const quarters = [];
  for(let m=1; m<=N; m+=3){
    const qIn = (r.it[m]||0)+(r.it[m+1]||0)+(r.it[m+2]||0);
    const qOut= (r.ot[m]||0)+(r.ot[m+1]||0)+(r.ot[m+2]||0);
    const mi = minfo(m);
    quarters.push({ label:`Q${Math.ceil(m/3)} ${mi.yr}`, qIn, qOut, net: qIn-qOut,
                    cumNet: r.net[Math.min(m+2,N)-1] });
  }

  /* SVG cumulative cash timeline */
  const netVals = r.net;
  const minV = Math.min(0, ...netVals), maxV = Math.max(0.01, ...netVals);
  const range = maxV - minV || 1;
  const W=560, H=80, pad=4;
  const toX = i => pad + (i/(N-1||1))*(W-2*pad);
  const toY = v => H-pad - ((v-minV)/range)*(H-2*pad);
  const pts = netVals.map((v,i)=>`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const zY = toY(0).toFixed(1);
  const areaPath = `M${toX(0)},${zY} ` + netVals.map((v,i)=>`L${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ') + ` L${toX(N-1)},${zY} Z`;

  /* milestone dots */
  const milestones = [
    { m: CLIENT.months.comm,  label:'COMM', color:'#3d8bff' },
    { m: CLIENT.months.compl, label:'COMP', color:'#9f8fff' },
    { m: CLIENT.months.pg,    label:'PG',   color:'#f6a93b' },
  ];
  const milestoneDots = milestones.map(ms => {
    const idx = Math.min(ms.m-1, N-1);
    const x = toX(idx), y = toY(netVals[idx]||0);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${ms.color}"/>
            <text x="${x.toFixed(1)}" y="${(y-8).toFixed(1)}" font-size="8" fill="${ms.color}" text-anchor="middle" font-family="monospace">${ms.label}</text>`;
  }).join('');

  /* month table (grouped by year) */
  let monthRows = '';
  let prevYr = null;
  let cumIn=0, cumOut=0;
  for(let m=1; m<=N; m++){
    const xi=minfo(m), inV=r.it[m]||0, outV=r.ot[m]||0, netV=r.net[m-1];
    cumIn+=inV; cumOut+=outV;
    if(xi.yr!==prevYr){
      monthRows+=`<tr><td colspan="5" style="background:var(--hdr);font-family:var(--fd);font-size:10px;letter-spacing:.1em;font-weight:700;color:var(--muted);padding:6px 10px;border-bottom:1px solid var(--border)">${xi.yr}</td></tr>`;
      prevYr=xi.yr;
    }
    const negStyle = netV<0 ? 'color:var(--red);font-weight:700' : '';
    const isMilestone = (m===CLIENT.months.comm||m===CLIENT.months.compl||m===CLIENT.months.pg);
    const msTag = m===CLIENT.months.comm?'<span class="ms-tag ms-blue">COMM</span>'
                : m===CLIENT.months.compl?'<span class="ms-tag ms-violet">COMP</span>'
                : m===CLIENT.months.pg?'<span class="ms-tag ms-amber">PG</span>':'';
    monthRows+=`<tr class="${m%2===0?'even':''}">
      <td style="padding:4px 10px;font-family:monospace;font-size:11px;white-space:nowrap">${xi.name}'${String(xi.yr).slice(2)} ${msTag}</td>
      <td style="text-align:right;padding:4px 10px;font-family:monospace;font-size:11px;color:var(--green)">${inV>0?inV.toFixed(2):''}</td>
      <td style="text-align:right;padding:4px 10px;font-family:monospace;font-size:11px;color:var(--amber)">${outV>0?outV.toFixed(2):''}</td>
      <td style="text-align:right;padding:4px 10px;font-family:monospace;font-size:11px;${netV>=0?'color:var(--green)':'color:var(--red);font-weight:700'}">${netV.toFixed(2)}</td>
      <td style="text-align:right;padding:4px 10px;font-family:monospace;font-size:10px;color:var(--muted)">${inV>0||outV>0?'':'—'}</td>
    </tr>`;
  }

  /* cost breakdown rows */
  const supplyItems = state.filter(it=>!it.svc && it.cost>0).sort((a,b)=>b.cost-a.cost);
  const svcItems    = state.filter(it=>it.svc  && it.cost>0).sort((a,b)=>b.cost-a.cost);
  const costRow = (it,cls='') => {
    const pctOfTotal = totalCost>0 ? (it.cost/totalCost*100) : 0;
    const bar = Math.round(pctOfTotal*1.8);
    return `<tr class="${cls}">
      <td style="padding:6px 10px;font-size:12px">${LABELS[it.key]||it.key}</td>
      <td style="text-align:right;padding:6px 10px;font-family:monospace;font-size:12px">${it.cost.toFixed(2)}</td>
      <td style="padding:6px 10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:${bar}px;height:6px;border-radius:3px;background:var(--blue);opacity:.8"></div>
          <span style="font-family:monospace;font-size:11px;color:var(--muted)">${pctOfTotal.toFixed(1)}%</span>
        </div>
      </td>
      <td style="text-align:right;padding:6px 10px;font-family:monospace;font-size:12px;color:var(--muted)">${it.credit}d / ${it.mode==='pr'?'Pro-rata':'Std'}</td>
    </tr>`;
  };

  /* risk flags */
  const riskRows = r.neg.length === 0
    ? `<tr><td colspan="3" style="padding:12px 10px;color:var(--green);font-size:12px">✓ No negative cash months — project is self-funding throughout.</td></tr>`
    : r.neg.map(({m,n}) => {
        const xi=minfo(m);
        return `<tr>
          <td style="padding:5px 10px;font-family:monospace;font-size:11px">${xi.name} ${xi.yr}</td>
          <td style="text-align:right;padding:5px 10px;font-family:monospace;font-size:11px;color:var(--red);font-weight:700">${n.toFixed(2)} Cr</td>
          <td style="padding:5px 10px;font-size:11px;color:var(--muted)">Month ${m}</td>
        </tr>`;
      }).join('');

  /* vendor milestone summary (worst slack months) */
  const vendorRows = state.filter(it=>it.cost>0).map(it=>{
    const payMonths = Object.keys(r.obi[it.key]||{}).map(Number).filter(m=>r.obi[it.key][m]>0).sort((a,b)=>a-b);
    const first = payMonths[0], last = payMonths[payMonths.length-1];
    const keyClass = it.key.replace(/[^a-zA-Z0-9]/g, '');
    return `<tr style="view-transition-name: vendor-row-${keyClass};">
      <td style="padding:5px 10px;font-size:12px">${LABELS[it.key]||it.key}</td>
      <td style="text-align:right;padding:5px 10px;font-family:monospace;font-size:11px">${it.cost.toFixed(2)}</td>
      <td style="padding:5px 10px;font-family:monospace;font-size:11px;color:var(--muted)">${first?mlbl(first):'—'}</td>
      <td style="padding:5px 10px;font-family:monospace;font-size:11px;color:var(--muted)">${last?mlbl(last):'—'}</td>
      <td style="text-align:right;padding:5px 10px;font-family:monospace;font-size:11px;color:var(--muted)">${it.credit}d</td>
    </tr>`;
  }).join('');

  /* theme tokens for the report */
  const bg     = isLight ? '#e9eef4' : '#081521';
  const surf   = isLight ? '#ffffff' : '#0e2335';
  const surf2  = isLight ? '#eef3f9' : '#143047';
  const text   = isLight ? '#0e2438' : '#d8e7f5';
  const muted  = isLight ? '#5d7691' : '#7f9cb8';
  const border = isLight ? 'rgba(20,60,100,0.15)' : 'rgba(125,180,224,0.18)';
  const hdr    = isLight ? '#e1eaf4' : '#1c3c57';
  const blue   = isLight ? '#1f6fe0' : '#3d8bff';
  const green  = isLight ? '#0f7f5e' : '#2fd6a6';
  const amber  = isLight ? '#c87711' : '#f6a93b';
  const red    = isLight ? '#c22b27' : '#ff6b63';
  const grid   = isLight ? 'rgba(40,90,140,0.07)' : 'rgba(120,180,224,0.06)';
  const gridMj = isLight ? 'rgba(40,90,140,0.12)' : 'rgba(120,180,224,0.10)';
  const areaFill = isLight ? 'rgba(15,127,94,0.14)' : 'rgba(47,214,166,0.12)';
  const lineClr  = isLight ? '#0f7f5e' : '#2fd6a6';
  const negArea  = isLight ? 'rgba(194,43,39,0.12)' : 'rgba(255,94,87,0.12)';

  /* full HTML */
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acme Cash Flow Summary — ${dateStr}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --bg:${bg};--surf:${surf};--surf2:${surf2};--text:${text};--muted:${muted};
  --border:${border};--hdr:${hdr};--blue:${blue};--green:${green};--amber:${amber};--red:${red};
  --fd:'Chakra Petch',sans-serif;--fm:'IBM Plex Mono',monospace;--fu:'IBM Plex Sans',sans-serif;
  color-scheme:${isLight?'light':'dark'};
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:${bg};background-image:
  linear-gradient(${grid} 1px,transparent 1px),
  linear-gradient(90deg,${grid} 1px,transparent 1px),
  linear-gradient(${gridMj} 1px,transparent 1px),
  linear-gradient(90deg,${gridMj} 1px,transparent 1px);
  background-size:26px 26px,26px 26px,156px 156px,156px 156px;
  color:${text};font-family:var(--fu);padding:32px 40px;max-width:1040px;margin:0 auto;
  -webkit-font-smoothing:antialiased}
@media print{body{background-image:none!important;padding:16px}}
.sheet{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:28px 32px;margin-bottom:22px;
  box-shadow:0 2px 24px -16px rgba(0,0,0,.5);page-break-inside:avoid}
h2{font-family:var(--fd);font-size:11px;font-weight:700;letter-spacing:.18em;color:var(--muted);
  text-transform:uppercase;margin-bottom:18px;padding-bottom:10px;border-bottom:1px solid var(--border)}
h2 span{float:right;font-size:10px;font-weight:400;letter-spacing:.04em;font-family:var(--fm);margin-top:1px}
table{width:100%;border-collapse:collapse}
tr.even{background:var(--surf2)}
tr:hover{background:var(--hdr)}
thead th{font-family:var(--fd);font-size:9px;letter-spacing:.14em;font-weight:700;color:var(--muted);
  text-align:right;padding:7px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
thead th:first-child{text-align:left}
td{border-bottom:1px solid var(--border);vertical-align:middle}
.ms-tag{display:inline-block;font-family:var(--fm);font-size:8px;font-weight:700;padding:1px 5px;
  border-radius:3px;margin-left:4px;vertical-align:middle}
.ms-blue{background:rgba(61,139,255,.18);color:${blue}}
.ms-violet{background:rgba(159,143,255,.18);color:#9f8fff}
.ms-amber{background:rgba(246,169,59,.18);color:${amber}}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:0}
.kpi{background:var(--surf2);border-radius:8px;padding:14px 16px;border:1px solid var(--border)}
.kpi .lbl{font-family:var(--fd);font-size:9px;letter-spacing:.14em;color:var(--muted);margin-bottom:6px}
.kpi .val{font-family:var(--fm);font-size:20px;font-weight:600}
.kpi .sub{font-size:10px;color:var(--muted);margin-top:3px;font-family:var(--fu)}
.section-divider{height:1px;background:var(--border);margin:8px 0 16px}
.risk-ok{color:var(--green)}.risk-bad{color:var(--red)}
@media print{.sheet{box-shadow:none;border:1px solid #ccc}.no-print{display:none}}
</style>
</head>
<body>

<!-- TITLEBLOCK -->
<div class="sheet" style="padding:22px 32px;margin-bottom:22px">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px">
    <div style="display:flex;align-items:center;gap:16px">
      <div style="width:48px;height:48px;border-radius:8px;overflow:hidden;line-height:0;box-shadow:0 0 0 1px rgba(125,180,224,.3),0 8px 20px -6px rgba(0,0,0,.4)">
        <svg width="48" height="48" viewBox="0 0 3000 3000" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Acme logo" style="display:block">
          <rect width="3000" height="3000" fill="#FFCC00"/>
          <g fill="#000" stroke="#000" stroke-miterlimit="4">
            <path stroke-width="19.2" d="M 1029.4164,286.80935 L 203.4893,1707.2444 L 1260.8356,1711.2344 L 1496.2449,1292.2859 L 750.11741,1292.2859 L 1404.4752,199.02965 L 1029.4164,286.80935 z"/>
            <path stroke-width="48.9" d="M 1252.8557,2744.6409 L 1891.2535,1699.2644 L 1484.2748,1695.2744 L 1707.7142,1306.2508 L 2753.0905,1308.2458 L 2545.6112,1691.2845 L 2134.6427,1687.2945 L 1508.2148,2760.6008 L 1252.8557,2744.6409 z"/>
            <path fill="none" stroke-width="235.61" d="M 2889.0587 1499.0437 A 1230.1071 1320.3901 0 1 1 428.8446,1499.0437 A 1230.1071 1320.3901 0 1 1 2889.0587 1499.0437 z" transform="matrix(1.11623,0,0,1.0399,-351.766,-58.8619)"/>
          </g>
        </svg>
      </div>
      <div>
        <div style="font-family:var(--fd);font-size:20px;font-weight:700;letter-spacing:.13em;color:var(--text)">ACME RENEWABLES</div>
        <div style="font-family:var(--fm);font-size:11px;color:var(--muted);margin-top:6px;letter-spacing:.04em">PROJECT CASH FLOW SUMMARY · EPC SOLAR · ₹ Cr</div>
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-family:var(--fm);font-size:12px;color:var(--text);font-weight:600">${dateStr} &nbsp;${timeStr}</div>
      <div style="font-family:var(--fm);font-size:10px;color:var(--muted);margin-top:4px">
        Start: <strong>${mlbl(1)}</strong> &nbsp;·&nbsp; Duration: <strong>${PROJECT_MONTHS} months</strong>
      </div>
      <div style="font-family:var(--fm);font-size:10px;color:var(--muted);margin-top:2px">
        DC Capacity: <strong>${DC_CAPACITY.toFixed(1)} MWp</strong> &nbsp;·&nbsp; Spec. Cost: <strong>${specificCost.toFixed(4)} Cr/MWp</strong>
      </div>
      <button onclick="window.print()" class="no-print"
        style="margin-top:10px;padding:7px 16px;background:${blue};color:#fff;border:none;border-radius:6px;
               font-family:var(--fd);font-size:11px;font-weight:600;letter-spacing:.06em;cursor:pointer">⎙ Print / Save PDF</button>
    </div>
  </div>
</div>

<!-- EXECUTIVE KPIs -->
<div class="sheet">
  <h2>Executive Summary</h2>
  <div class="kpi-grid">
    <div class="kpi">
      <div class="lbl">Project Revenue</div>
      <div class="val" style="color:var(--green)">${cr(r.totalIn)}</div>
      <div class="sub">Total client receipts</div>
    </div>
    <div class="kpi">
      <div class="lbl">Total Cost</div>
      <div class="val" style="color:var(--amber)">${cr(totalCost)}</div>
      <div class="sub">All vendor payments</div>
    </div>
    <div class="kpi">
      <div class="lbl">Gross Margin</div>
      <div class="val" style="color:${gm>=0?green:red}">${cr(gm)}</div>
      <div class="sub">${pct(gmPct)} of revenue</div>
    </div>
    <div class="kpi">
      <div class="lbl">Lowest Net Cash</div>
      <div class="val" style="color:${r.minNet>=0?green:red}">${cr(r.minNet)}</div>
      <div class="sub">Tightest: ${mlbl(r.minM)}</div>
    </div>
    <div class="kpi">
      <div class="lbl">Negative Months</div>
      <div class="val" style="color:${r.neg.length===0?green:red}">${r.neg.length}</div>
      <div class="sub">${r.neg.length===0?'Fully self-funded':'Cash support needed'}</div>
    </div>
    <div class="kpi">
      <div class="lbl">DC Capacity</div>
      <div class="val" style="color:var(--blue)">${DC_CAPACITY.toFixed(1)}</div>
      <div class="sub">MWp &nbsp;·&nbsp; ${specificCost.toFixed(4)} Cr/MWp</div>
    </div>
  </div>
</div>

<!-- CUMULATIVE CASH TIMELINE -->
<div class="sheet">
  <h2>Cumulative Net Cash Position <span>₹ Cr — Month ${1} to ${N}</span></h2>
  <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
    <!-- zero line -->
    <line x1="${pad}" y1="${zY}" x2="${W-pad}" y2="${zY}" stroke="${red}" stroke-width="1" stroke-dasharray="4,4" opacity=".5"/>
    <!-- area -->
    <path d="${areaPath}" fill="${areaFill}" opacity=".9"/>
    <!-- line -->
    <polyline points="${pts}" fill="none" stroke="${lineClr}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <!-- milestone dots -->
    ${milestoneDots}
    <!-- axis labels -->
    <text x="${pad}" y="${H+14}" font-size="9" fill="${muted}" font-family="monospace">${mlbl(1)}</text>
    <text x="${W/2}" y="${H+14}" font-size="9" fill="${muted}" font-family="monospace" text-anchor="middle">${mlbl(Math.ceil(N/2))}</text>
    <text x="${W-pad}" y="${H+14}" font-size="9" fill="${muted}" font-family="monospace" text-anchor="end">${mlbl(N)}</text>
    <text x="${pad-2}" y="${toY(maxV).toFixed(1)}" font-size="8" fill="${green}" font-family="monospace" text-anchor="end" dominant-baseline="middle">${maxV.toFixed(0)}</text>
    ${minV<0?`<text x="${pad-2}" y="${toY(minV).toFixed(1)}" font-size="8" fill="${red}" font-family="monospace" text-anchor="end" dominant-baseline="middle">${minV.toFixed(0)}</text>`:''}
  </svg>
  <div style="display:flex;gap:16px;margin-top:18px;font-family:monospace;font-size:10px;color:var(--muted)">
    <span style="display:flex;align-items:center;gap:5px"><span style="width:20px;height:2px;background:${lineClr};display:inline-block"></span> Net cumulative</span>
    <span style="display:flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${blue};display:inline-block"></span> Commissioning</span>
    <span style="display:flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:#9f8fff;display:inline-block"></span> Completion</span>
    <span style="display:flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${amber};display:inline-block"></span> PG Test</span>
  </div>
</div>

<!-- MONTHLY CASHFLOW TABLE -->
<div class="sheet">
  <h2>Monthly Cash Flow <span>₹ Cr</span></h2>
  <div style="overflow-x:auto">
  <table>
    <thead><tr>
      <th style="text-align:left">Month</th>
      <th>Inflow</th>
      <th>Outflow</th>
      <th>Net Cum.</th>
      <th></th>
    </tr></thead>
    <tbody>${monthRows}</tbody>
    <tfoot><tr style="background:var(--hdr)">
      <td style="padding:7px 10px;font-family:var(--fd);font-size:11px;font-weight:700;letter-spacing:.06em">TOTAL</td>
      <td style="text-align:right;padding:7px 10px;font-family:monospace;font-size:12px;font-weight:700;color:var(--green)">${r.totalIn.toFixed(2)}</td>
      <td style="text-align:right;padding:7px 10px;font-family:monospace;font-size:12px;font-weight:700;color:var(--amber)">${r.totalOut.toFixed(2)}</td>
      <td style="text-align:right;padding:7px 10px;font-family:monospace;font-size:12px;font-weight:700;color:${gm>=0?green:red}">${gm.toFixed(2)}</td>
      <td></td>
    </tr></tfoot>
  </table>
  </div>
</div>

<!-- COST BREAKDOWN -->
<div class="sheet">
  <h2>Cost Breakdown <span>₹ Cr · Total: ${totalCost.toFixed(2)} Cr</span></h2>
  <div style="font-family:var(--fd);font-size:9px;letter-spacing:.1em;color:var(--muted);margin-bottom:8px">SUPPLY ITEMS</div>
  <table>
    <thead><tr>
      <th style="text-align:left">Item</th>
      <th>₹ Cr</th>
      <th style="text-align:left">% of Total</th>
      <th>Credit / Mode</th>
    </tr></thead>
    <tbody>${supplyItems.map((it,i)=>costRow(it,i%2===0?'even':'')).join('')}</tbody>
  </table>
  ${svcItems.length>0?`
  <div style="font-family:var(--fd);font-size:9px;letter-spacing:.1em;color:var(--muted);margin:16px 0 8px">SERVICE ITEMS</div>
  <table>
    <thead><tr>
      <th style="text-align:left">Item</th>
      <th>₹ Cr</th>
      <th style="text-align:left">% of Total</th>
      <th>Credit / Mode</th>
    </tr></thead>
    <tbody>${svcItems.map((it,i)=>costRow(it,i%2===0?'even':'')).join('')}</tbody>
  </table>`:''}
</div>

<!-- VENDOR PAYMENT SCHEDULE -->
<div class="sheet">
  <h2>Vendor Payment Schedule <span>First → Last payment month</span></h2>
  <table>
    <thead><tr>
      <th style="text-align:left">Vendor / Package</th>
      <th>₹ Cr</th>
      <th style="text-align:left">First Payment</th>
      <th style="text-align:left">Last Payment</th>
      <th>Credit</th>
    </tr></thead>
    <tbody>${vendorRows}</tbody>
  </table>
</div>

<!-- CLIENT TERMS -->
<div class="sheet">
  <h2>Client Payment Terms</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
    <div>
      <div style="font-family:var(--fd);font-size:9px;letter-spacing:.1em;color:var(--muted);margin-bottom:10px">SUPPLY TERMS</div>
      <table>
        <tbody>
          ${[['Advance (M1)',CLIENT.supply.adv],['Against Dispatch',CLIENT.supply.disp],['Receipt at Site',CLIENT.supply.recv],['Erection & Testing',CLIENT.supply.erect||0],['Commissioning',CLIENT.supply.comm],['Completion',CLIENT.supply.compl],['PG/OAT Test',CLIENT.supply.pg]].map(([l,v],i)=>`<tr class="${i%2===0?'even':''}"><td style="padding:5px 10px;font-size:12px">${l}</td><td style="text-align:right;padding:5px 10px;font-family:monospace;font-size:12px;font-weight:600">${v}%</td></tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:var(--hdr)"><td style="padding:5px 10px;font-family:var(--fd);font-size:10px;font-weight:700;letter-spacing:.06em">TOTAL</td><td style="text-align:right;padding:5px 10px;font-family:monospace;font-size:12px;font-weight:700;color:${(CLIENT.supply.adv+CLIENT.supply.disp+CLIENT.supply.recv+(CLIENT.supply.erect||0)+CLIENT.supply.comm+CLIENT.supply.compl+CLIENT.supply.pg===100)?green:red}">${(CLIENT.supply.adv+CLIENT.supply.disp+CLIENT.supply.recv+(CLIENT.supply.erect||0)+CLIENT.supply.comm+CLIENT.supply.compl+CLIENT.supply.pg).toFixed(1)}%</td></tr></tfoot>
      </table>
      <div style="font-family:monospace;font-size:10px;color:var(--muted);margin-top:8px">Client credit period: ${CLIENT.credit} days</div>
    </div>
    <div>
      <div style="font-family:var(--fd);font-size:9px;letter-spacing:.1em;color:var(--muted);margin-bottom:10px">SERVICE TERMS</div>
      <table>
        <tbody>
          ${[['Progress Billed',CLIENT.service.prog],['Commissioning',CLIENT.service.comm],['Completion',CLIENT.service.compl],['PG/OAT Test',CLIENT.service.pg]].map(([l,v],i)=>`<tr class="${i%2===0?'even':''}"><td style="padding:5px 10px;font-size:12px">${l}</td><td style="text-align:right;padding:5px 10px;font-family:monospace;font-size:12px;font-weight:600">${v}%</td></tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:var(--hdr)"><td style="padding:5px 10px;font-family:var(--fd);font-size:10px;font-weight:700;letter-spacing:.06em">TOTAL</td><td style="text-align:right;padding:5px 10px;font-family:monospace;font-size:12px;font-weight:700;color:${(CLIENT.service.prog+CLIENT.service.comm+CLIENT.service.compl+CLIENT.service.pg===100)?green:red}">${(CLIENT.service.prog+CLIENT.service.comm+CLIENT.service.compl+CLIENT.service.pg).toFixed(1)}%</td></tr></tfoot>
      </table>
      <div style="font-family:var(--fd);font-size:9px;letter-spacing:.1em;color:var(--muted);margin:16px 0 8px">MILESTONE MONTHS</div>
      <table><tbody>
        <tr><td style="padding:5px 10px;font-size:12px">Commissioning</td><td style="padding:5px 10px;font-family:monospace;font-size:12px;color:${blue}">Month ${CLIENT.months.comm} — ${mlbl(CLIENT.months.comm)}</td></tr>
        <tr class="even"><td style="padding:5px 10px;font-size:12px">Completion</td><td style="padding:5px 10px;font-family:monospace;font-size:12px;color:#9f8fff">Month ${CLIENT.months.compl} — ${mlbl(CLIENT.months.compl)}</td></tr>
        <tr><td style="padding:5px 10px;font-size:12px">PG/OAT Test</td><td style="padding:5px 10px;font-family:monospace;font-size:12px;color:${amber}">Month ${CLIENT.months.pg} — ${mlbl(CLIENT.months.pg)}</td></tr>
      </tbody></table>
    </div>
  </div>
</div>

<!-- RISK FLAGS -->
<div class="sheet">
  <h2>Cash Risk Flags <span>${r.neg.length} negative month${r.neg.length===1?'':'s'}</span></h2>
  ${r.neg.length>0?`<div style="background:var(--red)22;border:1px solid var(--red)55;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:var(--red)">
    ⚠ Net cash is negative in <strong>${r.neg.length}</strong> month${r.neg.length===1?'':'s'}. Worst shortfall: <strong>${cr(Math.min(...r.neg.map(x=>x.n)))}</strong> in <strong>${mlbl(r.neg.reduce((a,b)=>b.n<a.n?b:a).m)}</strong>. Consider extending vendor credit periods or advancing client receipts.
  </div>`:`<div style="background:${green}22;border:1px solid ${green}55;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:${green}">
    ✓ Cash position is positive across all ${N} months. Lowest: ${cr(r.minNet)} in ${mlbl(r.minM)}.
  </div>`}
  <table>
    <thead><tr>
      <th style="text-align:left">Month</th>
      <th>Net Cumulative (₹ Cr)</th>
      <th style="text-align:left">Note</th>
    </tr></thead>
    <tbody>${riskRows}</tbody>
  </table>
</div>

<div style="text-align:center;font-family:monospace;font-size:10px;color:var(--muted);padding:16px 0 8px">
  Generated by Acme Cash Flow Dashboard · ${dateStr} ${timeStr} ·
</div>

</div>

</body>
</html>`;

  const blob = new Blob([html], {type: 'text/html'});
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if(!win){ alert('Please allow popups for this page to open the summary report.'); return; }
  win.onload = () => setTimeout(()=>URL.revokeObjectURL(url), 5000);
}

/* EXPORT TO EXCEL  — mirrors REF-Cashflow_and_SOI layout from live numbers */
function exportToExcel(){
  if(typeof ExcelJS === 'undefined'){
    alert('Excel export library could not be loaded (no internet connection?).\nPlease check your connection and reload the page.');
    return;
  }

  const r = recompute();
  const NM = N;
  const money = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
  const pctFmt = '0%';
  const pctFmt2 = '0.0%';
  const dateFmt = 'mmm-yy';

  /* column geometry (1-based, matching REF) */
  const C_A     = 1;           // col A — delivery % for services
  const C_LABEL = 2;           // col B — item names
  const C_VALUE = 3;           // col C — contract value
  const C_M1    = 4;           // col D — first month
  const monthCol = m => C_M1 + (m - 1);
  const C_LASTM  = monthCol(NM);
  const C_GAP1   = C_LASTM + 1; // blank spacer column
  const C_TOTAL  = C_GAP1 + 1;  // "Total" column
  const C_CHECK  = C_TOTAL + 1; // "Check" column
  const C_GAP2   = C_CHECK + 1; // blank spacer column
  const C_AW     = C_GAP2 + 1;  // Payment Terms / Assumptions text
  const C_AX     = C_AW + 1;    // Payment term % or label
  const C_AY     = C_AX + 1;    // Calculated ₹ amount

  const colL = n => { let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=(n-m-1)/26; } return s; };

  /* styling helpers */
  const YELLOW   = {type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};
  const LIGHTBLUE= {type:'pattern',pattern:'solid',fgColor:{argb:'FFDCE6F1'}};
  const HL_FILL  = {type:'pattern',pattern:'solid',fgColor:{argb:'FFD9E2F3'}};
  const HDRFILL  = {type:'pattern',pattern:'solid',fgColor:{argb:'FFF1EFE8'}};
  const thin     = {style:'thin', color:{argb:'FFBFBFBF'}};
  const box      = {top:thin, left:thin, right:thin, bottom:thin};
  const FONT     = {name:'Calibri', size:11};

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cash Flow Dashboard';
  wb.created = new Date();

  /* SHEET 1 : Cashflow  (matches REF layout exactly) */
  const ws2 = wb.addWorksheet('Inputs for CF');
  const ws = wb.addWorksheet('Cashflow', {views:[{state:'frozen', xSplit:3, ySplit:4}]});

  /* column widths (match REF) */
  ws.getColumn(C_A).width     = 5.2;
  ws.getColumn(C_LABEL).width = 20.8;
  ws.getColumn(C_VALUE).width = 10.2;
  for(let m=1;m<=NM;m++) ws.getColumn(monthCol(m)).width = 9;
  ws.getColumn(C_GAP1).width  = 3;
  ws.getColumn(C_TOTAL).width = 9.2;
  ws.getColumn(C_CHECK).width = 9.8;
  ws.getColumn(C_GAP2).width  = 3.2;
  ws.getColumn(C_AW).width    = 71.8;
  ws.getColumn(C_AX).width    = 18.8;
  ws.getColumn(C_AY).width    = 9.6;

  /* cell helpers */
  const set = (row,col,val,opts={}) => {
    const c = ws.getCell(row,col);
    if(typeof val === 'number' && !isFinite(val)) val = null;
    if(val !== undefined && val !== null && val !== '') c.value = val;
    c.font = {...FONT, bold:!!opts.bold, italic:!!opts.italic,
              color: opts.color ? {argb:opts.color} : undefined};
    if(opts.fmt) c.numFmt = opts.fmt;
    if(opts.fill) c.fill = opts.fill;
    if(opts.border !== false) c.border = box;
    c.alignment = {horizontal: opts.align || (typeof val==='number' ? 'right':'left'),
                   vertical:'center', wrapText: !!opts.wrap};
    return c;
  };
  const fcell = (row,col,formula,result,opts={}) => {
    const c = ws.getCell(row,col);
    if(typeof result === 'number' && !isFinite(result)) result = 0;
    if(typeof formula === 'string' && formula.charAt(0) === '=') formula = formula.slice(1);
    c.value = {formula, result};
    c.font = {...FONT, bold:!!opts.bold, color: opts.color?{argb:opts.color}:undefined};
    if(opts.fmt) c.numFmt = opts.fmt;
    if(opts.fill) c.fill = opts.fill;
    if(opts.border !== false) c.border = box;
    c.alignment = {horizontal:'right', vertical:'center'};
    return c;
  };
  const dateFor = m => { const x = minfo(m); return new Date(x.yr, M_NAMES.indexOf(x.name), 1); };

  const itemToInputsRow = {};
  const sparesTargetRows = [];
  const inputItemsList = MODEL==='procurement'
    ? PROC_SECTIONS.flatMap((sec,i) => (i>0?[null]:[]).concat(sec.items))
    : [
    'Cell','BCD','Module','Inverter','BESS','BCD_BESS','MMS','PowerTx','Cables','Floater','IDT',
    null, 'Other', null,
    'Erection','Civil','PowerEvac','MandSpares','IDC'
  ];
  let tempR = 6;
  const sparesTargetsList = ['Inverter','MMS','PowerTx','Cables','IDT','Other','PowerEvac'];
  inputItemsList.forEach(key => {
    if(key !== null) {
      const it = state.find(x=>x.key===key);
      if(it) {
        itemToInputsRow[key] = tempR;
        if(sparesTargetsList.includes(key)) sparesTargetRows.push('D'+tempR);
      }
    }
    tempR++;
  });
  const totalRowIdx = tempR;

  // vendor term text
  const vendorTerms = st => {
    if(!st) return '';
    const credit = st.credit||0, adv = st.adv||0;
    let txt = '';
    if(adv>0) txt = adv+'% advance, '+(100-adv)+'% Credit period - '+credit+' days';
    else txt = '100% Credit period - '+credit+' days';
    if(st.lots) txt += ' (' + st.lots + ' lots)';
    return txt;
  };

  /* OUTFLOW BLOCK  (Rows 1-23 equivalent in REF) */
  // Row 1 — empty (REF row 1–2 are empty)
  // Row 2 — milestone markers
  const milestones = {[CLIENT.months.comm]:'Comm', [CLIENT.months.compl]:'Compl', [CLIENT.months.pg]:'PG Test'};
  for(const m in milestones){
    if(+m>=1 && +m<=NM) set(2, monthCol(+m), milestones[m], {bold:true, align:'center', color:'FF3B6FB6', border:false});
  }

  // Row 3 — "Outflow" header + month numbers (REF row 3)
  set(3, C_LABEL, 'Outflow', {bold:true, fill:YELLOW, border:true});
  set(3, C_VALUE, 'Month', {bold:true, align:'center', border:true});
  for(let m=1;m<=NM;m++) set(3, monthCol(m), m, {bold:false, align:'center', border:true});

  // Row 4 — "Items" + "Value" + dates (REF row 4, height=39.45)
  ws.getRow(4).height = 39.45;
  set(4, C_LABEL, 'Items', {bold:true, border:true, align:'center'});
  set(4, C_VALUE, 'Value', {bold:true, align:'center', border:true});
  for(let m=1;m<=NM;m++) set(4, monthCol(m), dateFor(m), {bold:true, align:'center', fmt:dateFmt, border:true});
  set(4, C_TOTAL, 'Total', {bold:true, align:'center', border:true});
  set(4, C_CHECK, 'Check', {bold:true, align:'center', border:true});
  set(4, C_AW, 'Payment Terms/Assumptions', {bold:true, border:true});

  /* Outflow item rows (REF rows 5–21) */
  const outItems = MODEL==='procurement'
    ? PROC_SECTIONS.flatMap(sec => sec.items.map(k => ({key:k, label:LABELS[k]||k, value:stCost(k)})))
    : [
    {key:'Cell',       label:'Cell',                       value:stCost('Cell')},
    {key:'BCD',        label:'BCD',                        value:stCost('BCD')},
    {key:'Module',     label:'Cell Tolling - Module',      value:stCost('Module')},
    {key:'Inverter',   label:'Inverter',                   value:stCost('Inverter')},
    {key:'BESS',       label:'BESS',                       value:stCost('BESS')},
    {key:'BCD_BESS',   label:'BCD for BESS',               value:stCost('BCD_BESS')},
    {key:'MMS',        label:'MMS - Tracker',              value:stCost('MMS')},
    {key:'PowerTx',    label:'Power Transformer',          value:stCost('PowerTx')},
    {key:'Cables',     label:'Cables',                     value:stCost('Cables')},
    {key:'Floater',    label:'Floater',                    value:stCost('Floater')},
    {key:'IDT',        label:'IDT',                        value:stCost('IDT')},
    {key:'Other',      label:'Other Supply',               value:stCost('Other')},
    {key:'Erection',   label:'Erection',                   value:stCost('Erection'), svc:true},
    {key:'Civil',      label:'Civil',                      value:stCost('Civil'),    svc:true},
    {key:'PowerEvac',  label:'Power Evacuation',           value:stCost('PowerEvac')},
    {key:'MandSpares', label:'Mandatory Spares & Freight', value:stCost('MandSpares')},
    {key:'IDC',        label:'IDC and R&C',                value:stCost('IDC')},
  ];

  const outFirstRow = 5;
  let oRow = outFirstRow;
  outItems.forEach(it => {
    const map = r.obi[it.key] || {};
    const st = state.find(x=>x.key===it.key);

    // Col A — delivery % for service items (Erection, Civil)
    if(it.svc && st){
      const idcK = MODEL==='procurement' ? 'P_IDC' : 'IDC';
      const totalCostExIDC = state.reduce((s,x) => x.key!==idcK ? s+x.cost : s, 0);
      if(totalCostExIDC > 0) set(oRow, C_A, st.cost/totalCostExIDC, {fmt:pctFmt2, border:false});
    }

    set(oRow, C_LABEL, it.label, {border:true, align:'left'});
    if (itemToInputsRow[it.key]) {
      fcell(oRow, C_VALUE, `'Inputs for CF'!D${itemToInputsRow[it.key]}`, it.value||0, {fmt:money, border:true});
    } else {
      set(oRow, C_VALUE, it.value||null, {fmt:money, border:true});
    }

    const delivMap = st ? (r.dm[st.key] || {}) : {};
    const valC = it.value || 0;
    for(let m=1;m<=NM;m++){
      const v = map[m]||0;
      const hasVal = v>0.001;
      const isDeliv = !!delivMap[m];
      const opts = {fmt:money, border:hasVal||isDeliv, fill: isDeliv ? HL_FILL : undefined};
      if(hasVal && valC>0){
        // Live formula (matches REF): contract value (col C) × this month's % of value.
        // Edit the value in col C and the whole row + totals + net recompute in Excel.
        const pct = +((v/valC)*100).toFixed(6);
        fcell(oRow, monthCol(m), '$'+colL(C_VALUE)+'$'+oRow+'*'+pct+'%', v, opts);
      } else {
        set(oRow, monthCol(m), hasVal ? v : null, opts);
      }
    }

    // Total formula
    const rng = colL(C_M1)+oRow+':'+colL(C_LASTM)+oRow;
    let tot=0; for(let m=1;m<=NM;m++) tot += (map[m]||0);
    fcell(oRow, C_TOTAL, 'SUM('+rng+')', tot, {fmt:money, border:true});

    // Check = Value - Total
    fcell(oRow, C_CHECK, colL(C_VALUE)+oRow+'-'+colL(C_TOTAL)+oRow, (it.value||0)-tot, {fmt:money, border:true});

    // Payment terms (AW)
    set(oRow, C_AW, vendorTerms(st), {border:true});

    oRow++;
  });
  const outLastItemRow = oRow - 1;

  // Total - Outflow row (REF row 22, yellow fill)
  const outTotalRow = oRow;
  set(oRow, C_LABEL, 'Total - Outflow', {bold:true, fill:YELLOW, border:true});
  fcell(oRow, C_VALUE, 'SUM('+colL(C_VALUE)+outFirstRow+':'+colL(C_VALUE)+outLastItemRow+')', r.totalOut,
        {bold:true, fmt:money, fill:YELLOW, border:true});
  for(let m=1;m<=NM;m++){
    const col = monthCol(m);
    fcell(oRow, col, 'SUM('+colL(col)+outFirstRow+':'+colL(col)+outLastItemRow+')', r.ot[m]||0,
          {bold:true, fmt:money, fill:YELLOW, border:true});
  }
  fcell(oRow, C_TOTAL, 'SUM('+colL(C_TOTAL)+outFirstRow+':'+colL(C_TOTAL)+outLastItemRow+')', r.totalOut,
        {bold:true, fmt:money, fill:YELLOW, border:true});
  fcell(oRow, C_CHECK, colL(C_VALUE)+oRow+'-'+colL(C_TOTAL)+oRow, 0, {bold:true, fmt:money, fill:YELLOW, border:true});
  oRow++;

  // % cumulative outflow (REF row 23)
  let cumOut=0;
  for(let m=1;m<=NM;m++){
    cumOut += r.ot[m]||0;
    const col = monthCol(m);
    const frac = r.totalOut ? cumOut/r.totalOut : 0;
    fcell(oRow, col, 'SUM($'+colL(C_M1)+'$'+outTotalRow+':'+colL(col)+'$'+outTotalRow+')/$'+colL(C_TOTAL)+'$'+outTotalRow,
          frac, {fmt:pctFmt});
  }
  oRow++;

  /* INFLOW BLOCK  (REF rows 25-44) */
  oRow++; // blank row gap

  // Inflow header row (yellow)
  const inHeadRow = oRow;
  set(oRow, C_LABEL, 'Inflow', {bold:true, fill:YELLOW, border:true});
  set(oRow, C_VALUE, 'Month', {bold:true, align:'center', border:true});
  for(let m=1;m<=NM;m++) set(oRow, monthCol(m), m, {bold:false, align:'center', border:true});
  oRow++;

  // Inflow date header
  set(oRow, C_LABEL, 'Items', {bold:true, border:true, align:'center'});
  set(oRow, C_VALUE, 'Value', {bold:true, align:'center', border:true});
  for(let m=1;m<=NM;m++) set(oRow, monthCol(m), dateFor(m), {bold:true, align:'center', fmt:dateFmt, border:true});
  set(oRow, C_TOTAL, 'Total', {bold:true, align:'center', border:true});
  set(oRow, C_CHECK, 'Check', {bold:true, align:'center', border:true});

  // Payment terms structured (AW-AY) header
  set(oRow, C_AW, 'Payment Terms/Assumptions', {bold:true, border:true});
  set(oRow, C_AX, '', {bold:true, border:true});
  set(oRow, C_AY, '', {bold:true, border:true});
  oRow++;

  const sc = k => { const x = state.find(z=>z.key===k); return x ? x.salesC:0; };
  const inItems = MODEL==='procurement'
    ? PROC_SECTIONS.flatMap(sec => sec.items.map(k => ({key:k, label:LABELS[k]||k, value:sc(k)})))
    : [
    {key:'Cell',       label:'Cell',                       value:0},
    {key:'BCD',        label:'BCD',                        value:0},
    {key:'Module',     label:'Cell Tolling - Module',      value:sc('Module')},
    {key:'Inverter',   label:'Inverter',                   value:sc('Inverter')},
    {key:'BESS',       label:'BESS',                       value:sc('BESS')},
    {key:'BCD_BESS',   label:'BCD for BESS',               value:0},
    {key:'MMS',        label:'MMS - Tracker',              value:sc('MMS')},
    {key:'PowerTx',    label:'Power Transformer',          value:sc('PowerTx')},
    {key:'Cables',     label:'Cables',                     value:sc('Cables')},
    {key:'Floater',    label:'Floater',                    value:sc('Floater')},
    {key:'IDT',        label:'IDT',                        value:sc('IDT')},
    {key:'Other',      label:'Other Supply',               value:sc('Other')},
    {key:'Erection',   label:'Erection',                   value:sc('Erection'),   svc:true},
    {key:'Civil',      label:'Civil',                      value:sc('Civil'),       svc:true},
    {key:'PowerEvac',  label:'Power Evacuation',           value:sc('PowerEvac')},
    {key:'KeyEquip',   label:'Key equipment erection',     value:null, empty:true},
    {key:'MandSpares', label:'Mandatory Spares & Freight', value:0},
    {key:'IDC',        label:'IDC and R&C',                value:0},
  ];

  const inFirstRow = oRow;

  // Identify supply and service rows to create dynamic sum formulas for payment terms
  const supplyRowList = [];
  const serviceRowList = [];
  let tempOr = inFirstRow;
  inItems.forEach(it => {
    if (!it.empty) {
      const st = state.find(x=>x.key===it.key);
      const isSvc = st ? st.svc : it.svc;
      if (it.key !== 'IDC' && it.key !== 'P_IDC' && it.key !== 'MandSpares') {
        if (isSvc) serviceRowList.push('$C$'+tempOr);
        else supplyRowList.push('$C$'+tempOr);
      }
    }
    tempOr++;
  });
  const sSum = supplyRowList.length ? `(${supplyRowList.join('+')})` : '0';
  const svSum = serviceRowList.length ? `(${serviceRowList.join('+')})` : '0';

  // Compute total supply sales for payment term amounts
  const idcKey = MODEL === 'procurement' ? 'P_IDC' : 'IDC';
  const totalSupplySales = state.filter(x => x.di && !x.svc).reduce((s,x) => s+x.salesC, 0);
  const totalSvcSales = state.filter(x => x.di && x.svc && x.key !== idcKey).reduce((s,x) => s+x.salesC, 0);
  const totalAllSales = totalSupplySales + totalSvcSales;

  // Payment terms milestone rows (alongside inflow items in AW-AY)
  const sTerms = CLIENT.supply;
  const svTerms = CLIENT.service;
  const paymentTermRows = [
    {desc:'Supply', isHeader:true},
    {desc:'Advance Payment',                            pct: sTerms.adv/100,   amtFmla: `${sSum}*${colL(C_AX)}{row}`},
    {desc:'Against dispatch of Material from Manufacturers work', pct: sTerms.disp/100, amtFmla: `${sSum}*${colL(C_AX)}{row}`},
    {desc:'Upon receipt of Supply of Material/Equipment at site and Acceptance thereof', pct: sTerms.recv/100, amtFmla: `${sSum}*${colL(C_AX)}{row}`},
    {desc:'Upon Commissioning',                         pct: sTerms.comm/100,  amtFmla: `${sSum}*${colL(C_AX)}{row}`},
    {desc:'Upon Completion of Facilities',              pct: sTerms.compl/100, amtFmla: `${sSum}*${colL(C_AX)}{row}`},
    {desc:'Upon successful completion of PG Test',      pct: sTerms.pg/100,    amtFmla: `${sSum}*${colL(C_AX)}{row}`},
    {desc:'Services', isHeader:true},
    {desc:'Interest bearing advance payment',           pct: svTerms.adv/100,  amtFmla: `${svSum}*${colL(C_AX)}{row}`},
    {desc:'On pro-rata basis against Installation / Completion', pct: svTerms.compl/100, amtFmla: `${svSum}*${colL(C_AX)}{row}`},
    {desc:'Upon Commissioning',                         pct: svTerms.comm/100, amtFmla: `${svSum}*${colL(C_AX)}{row}`},
    {desc:'Upon successful completion of PG Test',      pct: svTerms.pg/100,   amtFmla: `${svSum}*${colL(C_AX)}{row}`}
  ];
  inItems.forEach((it, idx) => {
    if(it.empty){
      // Empty row (Key equipment erection)
      set(oRow, C_LABEL, it.label, {border:true, align:'left'});
      set(oRow, C_TOTAL, null, {fmt:money, border:true});
      set(oRow, C_CHECK, null, {fmt:money, border:true});
      oRow++;
      return;
    }
    const map = r.ibi[it.key] || {};
    const st = state.find(x=>x.key===it.key);

    // Col A — delivery % for service items
    if(it.svc && st){
      const idcK = MODEL==='procurement' ? 'P_IDC' : 'IDC';
      const totalCostExIDC = state.reduce((s,x) => x.key!==idcK ? s+x.cost : s, 0);
      if(totalCostExIDC > 0) set(oRow, C_A, st.cost/totalCostExIDC, {fmt:pctFmt2, border:false});
    }

    set(oRow, C_LABEL, it.label, {border:true, align:'left'});
    if (itemToInputsRow[it.key]) {
      fcell(oRow, C_VALUE, `'Inputs for CF'!K${itemToInputsRow[it.key]}`, it.value||0, {fmt:money, border:true});
    } else {
      if(it.value) set(oRow, C_VALUE, it.value, {fmt:money, border:true});
      else set(oRow, C_VALUE, it.value===0 ? 0 : null, {fmt:money, border:true});
    }

    const delivMap = st ? (r.dm[st.key] || {}) : {};
    const valC = it.value || 0;
    for(let m=1;m<=NM;m++){
      const v = map[m]||0;
      const hasVal = v>0.001;
      const isDeliv = !!delivMap[m];
      const opts = {fmt:money, border:hasVal||isDeliv, fill: isDeliv ? HL_FILL : undefined};
      if(hasVal && valC>0){
        // Live formula: sales value (col C) × this month's % of value (advance / dispatch / milestone share)
        const pct = +((v/valC)*100).toFixed(6);
        fcell(oRow, monthCol(m), '$'+colL(C_VALUE)+'$'+oRow+'*'+pct+'%', v, opts);
      } else {
        set(oRow, monthCol(m), hasVal ? v : null, opts);
      }
    }

    const rng = colL(C_M1)+oRow+':'+colL(C_LASTM)+oRow;
    let tot=0; for(let m=1;m<=NM;m++) tot += (map[m]||0);
    fcell(oRow, C_TOTAL, 'SUM('+rng+')', tot, {fmt:money, border:true});
    fcell(oRow, C_CHECK, colL(C_VALUE)+oRow+'-'+colL(C_TOTAL)+oRow, (it.value||0)-tot, {fmt:money, border:true});

    // Payment terms in AW-AY (aligned with inflow rows)
    if(idx < paymentTermRows.length){
      const pt = paymentTermRows[idx];
      set(oRow, C_AW, pt.desc, {border:true, bold: !!pt.isHeader});
      if(pt.isHeader) {
        set(oRow, C_AX, '', {border:true});
        set(oRow, C_AY, '', {border:true});
      } else {
        if(typeof pt.pct === 'number') set(oRow, C_AX, pt.pct, {fmt: pctFmt, border:true});
        else set(oRow, C_AX, '', {border:true});

        if(pt.amtFmla) fcell(oRow, C_AY, pt.amtFmla.replace('{row}', oRow), 0, {fmt:money, border:true});
        else if(typeof pt.amt === 'number') set(oRow, C_AY, pt.amt, {fmt:money, border:true});
        else set(oRow, C_AY, '', {border:true});
      }
    }

    oRow++;
  });
  const inLastItemRow = oRow - 1;

  // Total - Inflow row (REF uses themed fill, not yellow)
  const inTotalRow = oRow;
  set(oRow, C_LABEL, 'Total - Inflow', {bold:true, fill:LIGHTBLUE, border:true});
  fcell(oRow, C_VALUE, 'SUM('+colL(C_VALUE)+inFirstRow+':'+colL(C_VALUE)+inLastItemRow+')', r.totalIn,
        {bold:true, fmt:money, fill:LIGHTBLUE, border:true});
  for(let m=1;m<=NM;m++){
    const col = monthCol(m);
    fcell(oRow, col, 'SUM('+colL(col)+inFirstRow+':'+colL(col)+inLastItemRow+')', r.it[m]||0,
          {bold:true, fmt:money, fill:LIGHTBLUE, border:true});
  }
  fcell(oRow, C_TOTAL, 'SUM('+colL(C_TOTAL)+inFirstRow+':'+colL(C_TOTAL)+inLastItemRow+')', r.totalIn,
        {bold:true, fmt:money, fill:LIGHTBLUE, border:true});
  fcell(oRow, C_CHECK, colL(C_VALUE)+oRow+'-'+colL(C_TOTAL)+oRow, 0, {bold:true, fmt:money, fill:LIGHTBLUE, border:true});

  // Payment terms total in AW-AY
  const ayRange = `AY${inFirstRow}:AY${inFirstRow + paymentTermRows.length - 1}`;
  set(oRow, C_AW, 'Total', {bold:true, fill:LIGHTBLUE, border:true});
  set(oRow, C_AX, '', {bold:true, fill:LIGHTBLUE, border:true});
  fcell(oRow, C_AY, `SUM(${ayRange})`, totalAllSales, {fmt:money, bold:true, fill:LIGHTBLUE, border:true});
  oRow++;

  // % cumulative inflow
  let cumIn=0;
  for(let m=1;m<=NM;m++){
    cumIn += r.it[m]||0;
    const col = monthCol(m);
    const frac = r.totalIn ? cumIn/r.totalIn : 0;
    fcell(oRow, col, 'SUM($'+colL(C_M1)+'$'+inTotalRow+':'+colL(col)+'$'+inTotalRow+')/$'+colL(C_TOTAL)+'$'+inTotalRow,
          frac, {fmt:pctFmt});
  }
  oRow++;

  /* CUMULATIVE CASHFLOW BLOCK  (REF rows 47-49) */
  oRow += 2; // two blank rows

  // Cum. Cash Inflow (light blue fill)
  const cinRow = oRow;
  set(oRow, C_LABEL, 'Cum. Cash Inflow', {bold:true, fill:LIGHTBLUE, border:true});
  fcell(oRow, C_VALUE, '$'+colL(C_TOTAL)+'$'+inTotalRow, r.totalIn, {bold:true, fmt:money, fill:LIGHTBLUE, border:true});
  let ci=0;
  for(let m=1;m<=NM;m++){
    ci += r.it[m]||0;
    const col = monthCol(m);
    const f = (m===1) ? colL(col)+inTotalRow : colL(monthCol(m-1))+oRow+'+'+colL(col)+inTotalRow;
    fcell(oRow, col, f, ci, {bold:true, fmt:money, fill:LIGHTBLUE, border:true});
  }
  oRow++;

  // Cum. Cash Outflow (yellow fill — matches REF)
  const coutRow = oRow;
  set(oRow, C_LABEL, 'Cum. Cash Outflow', {bold:true, fill:YELLOW, border:true});
  fcell(oRow, C_VALUE, '$'+colL(C_TOTAL)+'$'+outTotalRow, r.totalOut, {bold:true, fmt:money, fill:YELLOW, border:true});
  let co=0;
  for(let m=1;m<=NM;m++){
    co += r.ot[m]||0;
    const col = monthCol(m);
    const f = (m===1) ? colL(col)+outTotalRow : colL(monthCol(m-1))+oRow+'+'+colL(col)+outTotalRow;
    fcell(oRow, col, f, co, {bold:true, fmt:money, fill:YELLOW, border:true});
  }
  oRow++;

  // Net Cashflow
  const netRow = oRow;
  set(oRow, C_LABEL, 'Net Cashflow', {bold:true, border:true});
  fcell(oRow, C_VALUE, colL(C_VALUE)+cinRow+'-'+colL(C_VALUE)+coutRow, r.totalIn-r.totalOut, {bold:true, fmt:money, border:true});
  { let cumI=0, cumO=0;
    for(let m=1;m<=NM;m++){
      cumI+=r.it[m]||0; cumO+=r.ot[m]||0;
      const col = monthCol(m);
      const net = cumI - cumO;
      fcell(oRow, col, colL(col)+cinRow+'-'+colL(col)+coutRow, net,
            {bold:true, fmt:money, border:true, color: net<0 ? 'FFA32D2D' : undefined});
    }
  }
  oRow++;

  /* SHEET 2 : Inputs for CF  (matches REF layout) */
  ws2.getColumn(1).width = 3;
  ws2.getColumn(2).width = 26;     // B — Items
  ws2.getColumn(3).width = 12;     // C — Total Cost (per unit)
  ws2.getColumn(4).width = 16;     // D — Total Cost in Crores
  ws2.getColumn(5).width = 10;     // E — % of Cost
  ws2.getColumn(6).width = 14;     // F — IDC & Risk Loading
  ws2.getColumn(7).width = 14;     // G — Spares & Freight Loading
  ws2.getColumn(8).width = 16;     // H — Total cost with IDC Loading
  ws2.getColumn(9).width = 14;     // I — Total Sales
  ws2.getColumn(10).width = 12;    // J — % of Sales/Invoice
  ws2.getColumn(11).width = 14;    // K — Total Invoice
  ws2.getColumn(12).width = 3;     // L — spacer
  ws2.getColumn(13).width = 40;    // M — Client Payment Terms
  ws2.getColumn(14).width = 10;    // N — % of CV

  const s2 = (rw,cl,v,o={})=>{ const c=ws2.getCell(rw,cl);
    if(typeof v==='number' && !isFinite(v)) v=null;
    if(v!==undefined&&v!==null&&v!=='') c.value=v;
    c.font={...FONT,bold:!!o.bold,italic:!!o.italic};
    if(o.fmt)c.numFmt=o.fmt; if(o.fill)c.fill=o.fill; if(o.border)c.border=box;
    c.alignment={horizontal:o.align||(typeof v==='number'?'right':'left'),vertical:'center',wrapText:!!o.wrap}; return c; };
  const f2 = (rw,cl,formula,result,o={})=>{ const c=ws2.getCell(rw,cl);
    if(typeof result==='number' && !isFinite(result)) result=0;
    if(typeof formula==='string' && formula.charAt(0)==='=') formula=formula.slice(1);
    c.value={formula,result}; c.font={...FONT,bold:!!o.bold};
    if(o.fmt)c.numFmt=o.fmt; if(o.fill)c.fill=o.fill; if(o.border)c.border=box;
    c.alignment={horizontal:'right',vertical:'center'}; return c; };

  // Rows 2-4: Capacity info
  const ac = DC_CAPACITY / 1.5;
  s2(2,2,'AC Capacity',{bold:true,border:true}); s2(2,3,ac,{fmt:'#,##0',border:true}); s2(2,4,'MW',{border:true});
  s2(3,2,'Inverter Capacity',{bold:true,border:true}); s2(3,3,ac*1.2,{fmt:'#,##0',border:true}); s2(3,4,'MW',{border:true});
  s2(4,2,'DC Capacity',{bold:true,border:true}); s2(4,3,DC_CAPACITY,{fmt:'#,##0.0',border:true}); s2(4,4,'MWp',{border:true});

  // Row 5: Column headers (matching REF)
  const hdr5 = [
    [2,'Items'], [3,'Total Cost'], [4,'Total Cost in Crores'], [5,'% of Cost'],
    [6,'IDC & Risk Loading'], [7,'Spares & Freight Loading'], [8,'Total cost with IDC Loading'],
    [9,'Total Sales'], [10,'% of Sales/invoice'], [11,'Total Invoice']
  ];
  hdr5.forEach(([c,v]) => s2(5,c,v,{bold:true,fill:HDRFILL,border:true,align:'center',wrap:true}));

  // Compute IDC and Spares loading
  const totalIDC = stCost('IDC') + stCost('P_IDC');
  const totalCostExIDCSpares = state.filter(x => x.key!=='IDC' && x.key!=='MandSpares' && x.key!=='P_IDC' && x.key!=='P_MandSpares').reduce((s,x)=>s+(x.cost||0), 0);
  const rawTotalCost = state.reduce((s,x)=>s+(x.cost||0), 0);
  const idcRatio = (stCost('IDC') + stCost('P_IDC')) / (totalCostExIDCSpares || 1);

  const sparesItem = state.find(x=>x.key==='MandSpares');
  const totalSpares = sparesItem ? sparesItem.cost:0;
  const sparesTargets = ['Inverter','MMS','PowerTx','Cables','IDT','Other','PowerEvac'];
  let sparesBaseCost = 0;
  state.forEach(it => { if(sparesTargets.includes(it.key)) sparesBaseCost += it.cost; });
  const sparesRatio = sparesBaseCost > 0 ? totalSpares / sparesBaseCost : 0;

  const totalCostAll = state.reduce((s,it)=>s+it.cost, 0);
  const totalSalesAll = PROJECT_VALUE;

  let rr = 6;
  const inputFirstRow = rr;
  const inputItems = inputItemsList;

  // GM% lands one row below the Total row, which is one below the last item row.
  // Every inputItems entry (item or null separator) consumes exactly one row.
  const gmPctRow = inputFirstRow + inputItems.length + 1;

  inputItems.forEach(key => {
    if(key === null){
      // blank separator row
      rr++;
      return;
    }
    const it = state.find(x=>x.key===key);
    if(!it) { rr++; return; }
    const label = LABELS[key] || key;
    const costPerUnit = DC_CAPACITY > 0 ? it.cost / DC_CAPACITY : 0;
    const idcLoad = (key !== 'IDC' && key !== 'MandSpares') ? it.cost * idcRatio : 0;
    const sparesLoad = sparesTargets.includes(key) ? it.cost * sparesRatio : 0;
    const costWithIDC = it.cost + idcLoad + sparesLoad;
    const pctCost = totalCostAll > 0 ? it.cost / totalCostAll : 0;
    const pctSales = totalSalesAll > 0 ? it.salesC / totalSalesAll : 0;

    s2(rr, 2, label, {border:true});
    f2(rr, 3, 'D'+rr+'/$C$4', costPerUnit, {fmt:'#,##0.000000', border:true});
    s2(rr, 4, it.cost, {fmt:money, border:true});
    f2(rr, 5, 'D'+rr+'/$D$'+totalRowIdx, pctCost, {fmt:pctFmt, border:true});
    
    const idcR = itemToInputsRow['IDC'] || itemToInputsRow['P_IDC'] || 0;
    const sparesR = itemToInputsRow['MandSpares'] || 0;
    const isIdcOrSpares = (key === 'IDC' || key === 'P_IDC' || key === 'MandSpares' || key === 'P_MandSpares');

    if (isIdcOrSpares) {
      s2(rr, 6, '', {border:true});
      s2(rr, 7, '', {border:true});
      s2(rr, 8, '', {border:true});
      s2(rr, 9, '', {border:true});
      s2(rr, 10, '', {border:true});
      s2(rr, 11, '', {border:true});
    } else {
      if (idcR) {
        f2(rr, 6, `(D${rr}/($D$${totalRowIdx}-($D$${idcR}${sparesR ? '+$D$'+sparesR : ''})))*$D$${idcR}`, idcLoad, {fmt:money, border:true});
      } else {
        s2(rr, 6, '', {border:true});
      }
      
      if (sparesTargetsList.includes(key) && sparesR && sparesTargetRows.length > 0) {
        f2(rr, 7, `(D${rr}/SUM(${sparesTargetRows.join(',')}))*$D$${sparesR}`, sparesLoad, {fmt:money, border:true});
      } else {
        s2(rr, 7, '', {border:true});
      }
      
      f2(rr, 8, `SUM(D${rr},F${rr},G${rr})`, costWithIDC, {fmt:money, border:true});
      f2(rr, 9, 'H'+rr+'/(1-$C$'+gmPctRow+')', it.salesC||0, {fmt:money, border:true});
      f2(rr, 10, 'I'+rr+'/$I$'+totalRowIdx, pctSales, {fmt:pctFmt, border:true});
      f2(rr, 11, 'I'+rr, it.salesC||0, {fmt:money, border:true});
    }

    rr++;
  });
  const inputLastRow = rr - 1;

  // Total row
  s2(rr, 2, 'Total ', {bold:true, fill:YELLOW, border:true});
  s2(rr, 3, '', {fill:YELLOW, border:true});
  f2(rr, 4, 'SUM(D'+inputFirstRow+':D'+inputLastRow+')', totalCostAll, {bold:true, fmt:money, fill:YELLOW, border:true});
  f2(rr, 5, 'SUM(E'+inputFirstRow+':E'+inputLastRow+')', 1, {bold:true, fmt:pctFmt, fill:YELLOW, border:true});
  f2(rr, 6, 'SUM(F'+inputFirstRow+':F'+inputLastRow+')', totalIDC, {bold:true, fmt:money, fill:YELLOW, border:true});
  f2(rr, 7, 'SUM(G'+inputFirstRow+':G'+inputLastRow+')', totalSpares, {bold:true, fmt:money, fill:YELLOW, border:true});
  f2(rr, 8, 'SUM(H'+inputFirstRow+':H'+inputLastRow+')', totalCostAll, {bold:true, fmt:money, fill:YELLOW, border:true});
  f2(rr, 9, 'SUM(I'+inputFirstRow+':I'+inputLastRow+')', totalSalesAll, {bold:true, fmt:money, fill:YELLOW, border:true});
  f2(rr, 10, 'SUM(J'+inputFirstRow+':J'+inputLastRow+')', 1, {bold:true, fmt:pctFmt, fill:YELLOW, border:true});
  f2(rr, 11, 'SUM(K'+inputFirstRow+':K'+inputLastRow+')', totalSalesAll, {bold:true, fmt:money, fill:YELLOW, border:true});

  const totR = rr;
  rr += 1;

  // GM% row
  s2(rr, 2, 'GM% ', {bold:true}); s2(rr, 3, (MARGIN||0)/100, {fmt:pctFmt}); s2(rr, 4, (MARGIN||0)/100, {fmt:pctFmt});
  rr++;
  // Sales row
  s2(rr, 2, 'Sales ', {bold:true}); s2(rr, 3, DC_CAPACITY>0?totalSalesAll/DC_CAPACITY:0, {fmt:'#,##0.000000'}); s2(rr, 4, totalSalesAll, {fmt:money});
  rr++;
  // Gross Margin row
  s2(rr, 2, 'Gross Margin', {bold:true}); s2(rr, 3, DC_CAPACITY>0?(totalSalesAll-totalCostAll)/DC_CAPACITY:0, {fmt:'#,##0.000000'}); s2(rr, 4, totalSalesAll-totalCostAll, {fmt:money});

  /* download */
  wb.xlsx.writeBuffer().then(buf=>{
    const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const stamp = d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
    a.href = url;
    a.download = 'Cashflow_and_SOI_export_'+stamp+'.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  }).catch(err=>{
    console.error(err);
    alert('Could not generate the Excel file: '+err.message);
  });
}

function toggleCompareMode(enable) {
  isCompareMode = enable;
  if(!document.getElementById('btnNormalMode')) return;   // ghost-line toggle removed from UI
  document.getElementById('btnNormalMode').style.background = enable ? 'transparent' : 'var(--blue)';
  document.getElementById('btnNormalMode').style.border = enable ? '1px solid var(--border)' : 'none';
  document.getElementById('btnNormalMode').style.color = enable ? 'var(--text)' : 'white';
  document.getElementById('btnCompareMode').style.background = enable ? 'var(--blue)' : 'transparent';
  document.getElementById('btnCompareMode').style.border = enable ? 'none' : '1px solid var(--border)';
  document.getElementById('btnCompareMode').style.color = enable ? 'white' : 'var(--text)';

  document.getElementById('compareActionBtns').style.display = enable ? 'flex' : 'none';
  document.getElementById('normalActionBtns').style.display = enable ? 'none' : 'flex';

  if (enable) {
    // Entering compare sub-mode: snapshot state as discard baseline
    savedState = JSON.parse(JSON.stringify(state));
    savedClientSupply = JSON.parse(JSON.stringify(CLIENT.supply));
    savedClientService = JSON.parse(JSON.stringify(CLIENT.service));
    const r = recompute();
    baselineNet = [...r.net];
  } else {
    // Clicking Normal button — discard compare changes silently
    if (savedState) {
      state = JSON.parse(JSON.stringify(savedState));
      CLIENT.supply = JSON.parse(JSON.stringify(savedClientSupply));
      CLIENT.service = JSON.parse(JSON.stringify(savedClientService));
      savedState = null;
      buildVC();
      buildClientInputs();
    }
  }

  render();
}

function saveCompareChanges() {
  // Commit compare edits as the new permanent state
  const r = recompute();
  baselineNet = [...r.net];
  savedState = null; // don't revert on next exit
  // Switch UI back to Normal mode
  isCompareMode = false;
  document.getElementById('btnNormalMode').style.background = 'var(--blue)';
  document.getElementById('btnNormalMode').style.border = 'none';
  document.getElementById('btnNormalMode').style.color = 'white';
  document.getElementById('btnCompareMode').style.background = 'transparent';
  document.getElementById('btnCompareMode').style.border = '1px solid var(--border)';
  document.getElementById('btnCompareMode').style.color = 'var(--text)';
  document.getElementById('compareActionBtns').style.display = 'none';
  document.getElementById('normalActionBtns').style.display = 'flex';
  render();
}

function discardCompareChanges() {
  // Revert to snapshot and switch back to Normal mode
  if (savedState) {
    state = JSON.parse(JSON.stringify(savedState));
    CLIENT.supply = JSON.parse(JSON.stringify(savedClientSupply));
    CLIENT.service = JSON.parse(JSON.stringify(savedClientService));
    savedState = null;
  }
  isCompareMode = false;
  document.getElementById('btnNormalMode').style.background = 'var(--blue)';
  document.getElementById('btnNormalMode').style.border = 'none';
  document.getElementById('btnNormalMode').style.color = 'white';
  document.getElementById('btnCompareMode').style.background = 'transparent';
  document.getElementById('btnCompareMode').style.border = '1px solid var(--border)';
  document.getElementById('btnCompareMode').style.color = 'var(--text)';
  document.getElementById('compareActionBtns').style.display = 'none';
  document.getElementById('normalActionBtns').style.display = 'flex';
  buildVC();
  buildClientInputs();
  render();
}



/* Global: auto-select number input content on focus */
/* passive:true tells the browser this listener won't call preventDefault()
   so it can process scroll/focus without waiting for JS — unblocks the compositor */
document.addEventListener('focus', function(e){
  if(e.target && e.target.matches('input[type="number"]')){
    e.target.select();
  }
}, { capture: true, passive: true });

/* ---- Modal accessibility: focus move + trap + return, Esc & backdrop close ----
   Modals open/close by flipping inline display; a MutationObserver picks that up so
   we don't have to wrap every open/close call site. No visual change. */
(function(){
  const modals = ['managerModal','sensitivityModal','optimizerModal']
    .map(id=>document.getElementById(id)).filter(Boolean);
  if(!modals.length) return;
  const SEL = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const isOpen = m => m && getComputedStyle(m).display !== 'none';
  const focusables = m => Array.from(m.querySelectorAll(SEL)).filter(el => el.offsetParent !== null && !el.disabled);
  function properClose(m){
    if(m.id === 'managerModal' && typeof closeManager === 'function') closeManager();
    else if(m.id === 'sensitivityModal' && typeof closeSensitivityModal === 'function') closeSensitivityModal();
    else m.style.display = 'none';
  }
  modals.forEach(m=>{
    new MutationObserver(()=>{
      const open = isOpen(m);
      if(open && !m._a11yOpen){
        m._a11yOpen = true;
        m._lastFocus = document.activeElement;   // per-modal, so stacking modals don't clobber each other
        const f = focusables(m); if(f.length) setTimeout(()=>f[0].focus(), 0);
      } else if(!open && m._a11yOpen){
        m._a11yOpen = false;
        if(m._lastFocus && m._lastFocus.focus){ try{ m._lastFocus.focus(); }catch(e){} m._lastFocus = null; }
      }
    }).observe(m, { attributes:true, attributeFilter:['style'] });
    // click on the backdrop (the overlay itself) closes
    m.addEventListener('mousedown', e=>{ if(e.target === m) properClose(m); });
  });
  document.addEventListener('keydown', e=>{
    const open = modals.filter(isOpen);
    if(!open.length) return;
    const m = open[open.length - 1];
    if(e.key === 'Escape'){ e.preventDefault(); properClose(m); return; }
    if(e.key === 'Tab'){
      const f = focusables(m); if(!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
  });
})();
