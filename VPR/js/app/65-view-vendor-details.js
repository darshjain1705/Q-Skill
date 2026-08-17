// VENDOR DETAILS — the contact directory.
//
// Reads the Vendor Master (code, name, factory location, address, and the two
// contact levels) and shows it as one searchable table; clicking a row opens the
// full detail panel for that vendor. Vendors that appear in the rating workbook but
// are missing from the master are still listed, flagged as "not in master", so the
// page doubles as a checklist of the contact data still to be collected.

// One row per vendor: master records first, then any vendor seen only in the PO data.
function vendorDetailRows(){
  const seen=new Map();   // normCodeKey → row
  const put=(rec)=>{
    // A merged Vendor Master row (multiple original codes joined with "; ", from a
    // company-grouped entity like Siemens) isn't a real single code — normCodeKey'ing
    // it would produce a key nothing else can match. De-dupe those by name instead,
    // same as how the ratings-side roster already keys grouped vendors by name.
    const isMultiCode = rec.code && /;\s|,\s/.test(rec.code);
    const key = (rec.code && !isMultiCode) ? normCodeKey(rec.code) : normVenKey(rec.name);
    if(!key) return;
    const prev=seen.get(key);
    if(prev){ // fill blanks from the weaker source rather than overwriting
      Object.keys(rec).forEach(k=>{ if(!prev[k] && rec[k]) prev[k]=rec[k]; });
      return;
    }
    seen.set(key, Object.assign({code:'',name:'',factory:'',address:'',materialDesc:'',c1Name:'',c1Email:'',
                                 c1Phone:'',c2Name:'',c2Email:'',c2Phone:'',inMaster:false,poCount:0}, rec));
  };

  // 1. Everything the Vendor Master gave us (VENDOR_DETAILS holds duplicate keys
  //    pointing at the same object, so de-dupe on the object identity first).
  const uniq=new Set();
  Object.values(VENDOR_DETAILS||{}).forEach(r=>{ if(r && !uniq.has(r)){ uniq.add(r); put(Object.assign({},r,{inMaster:true})); } });
  // 2. Roster entries (code/name/location only) for masters without contact columns.
  Object.values(VENDOR_MASTER_ROSTER||{}).forEach(v=>{
    if(v && (v.code||v.name)) put({code:v.code||'', name:v.name||'', factory:v.location||'', inMaster:true});
  });
  // 3. Vendors that exist in the rating workbook — so gaps in the master are visible.
  try{
    const byVendor={};
    all().forEach(i=>{ const c=i.vendor||''; if(!c || c.length<2) return; (byVendor[c]=byVendor[c]||[]).push(i); });
    Object.keys(byVendor).forEach(c=>{
      const items=byVendor[c];
      const nm=(items.find(i=>i.vendorName&&i.vendorName.length>1)||{}).vendorName||'';
      put({code:c, name:nm});
      const row=seen.get(normCodeKey(c)); if(row) row.poCount=new Set(items.map(i=>i.poNum||i.item||'')).size;
    });
  }catch(e){}

  const rows=[...seen.values()];
  rows.forEach(r=>{
    // A vendor is "complete" once we can both mail and phone the first-level contact.
    r.hasEmail = !!(r.c1Email||r.c2Email);
    r.complete = !!(r.c1Email && r.c1Phone && r.factory);
    r.search   = (r.code+' '+r.name+' '+r.factory+' '+r.address+' '+r.materialDesc+' '+r.c1Name+' '+
                  r.c1Email+' '+r.c1Phone+' '+r.c2Name+' '+r.c2Email+' '+r.c2Phone).toLowerCase();
  });
  rows.sort((a,b)=>(a.name||a.code).localeCompare(b.name||b.code));
  return rows;
}

let _vdFilter='all';

function rVendorDetails(){
  initRatings();
  const rows=vendorDetailRows();
  const nEmail=rows.filter(r=>r.hasEmail).length;
  const nSenior=rows.filter(r=>r.c2Email||r.c2Phone||r.c2Name).length;
  const nGap=rows.filter(r=>!r.hasEmail).length;

  const dash='<span style="color:var(--t4,#9aa3ab)">—</span>';
  const cell=(v)=>v?hesc(v):dash;
  const mailLink=(e)=>e?`<a href="mailto:${hesc(e)}" onclick="event.stopPropagation()" style="color:var(--acc,#0072bc);text-decoration:none;">${hesc(e)}</a>`:dash;
  const telLink=(p)=>p?`<a href="tel:${hesc(String(p).replace(/[^\d+]/g,''))}" onclick="event.stopPropagation()" style="color:var(--t2);text-decoration:none;font-family:var(--mono);font-size:11.5px;">${hesc(p)}</a>`:dash;

  // Completion status colors. The old badge column used fixed light-mode hex
  // (#1f6b3d/#8a5200/#a12b2b on pale fills) — fine for a badge's own
  // background, but those same hexes as a dot directly on a dark card fall
  // to ~2.3-2.8:1 (unreadable). Use the app's grn/amb/red tokens instead,
  // which already carry a legible dark-theme variant (~6-8:1 on dark cards).
  const STATUS_META = {
    complete: { c:'var(--grn,#1a7f4b)', label:'Contact info complete' },
    partial:  { c:'var(--amb,#8a6410)', label:'Some contact fields are still blank' },
    missing:  { c:'var(--red,#b3291d)', label:'Not in Vendor Master' },
  };
  const body=rows.map(r=>{
    const key=r.code||r.name;
    const st=r.inMaster?(r.complete?'complete':'partial'):'missing';
    const sm=STATUS_META[st];
    // Completion status (was its own visible column) still drives the filter
    // pills/KPIs, the detail panel's "not in master" warning, AND this row's
    // title (below) — just shown as a small dot next to the name instead of
    // a badge column, now that Material Description occupies that space.
    // The dot itself is aria-hidden/decorative; the real description lives
    // on the row's title, so it rides the row's existing tab stop (js/ui-
    // enhance.js already upgrades title="" on focusable elements into a
    // proper aria-describedby + on-focus tooltip) instead of adding a
    // second, redundant one just for the dot.
    const dot=`<span aria-hidden="true" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${sm.c};margin-right:7px;flex-shrink:0;"></span>`;
    return `<tr class="vd-row" data-s="${hesc(r.search)}" data-st="${st}"
              style="cursor:pointer" onclick="openVendorDetail('${esc(key)}')" title="${hesc(sm.label)} — Click for full details">
      <td style="font-family:var(--mono);font-size:11.5px;white-space:nowrap">${cell(r.code)}</td>
      <td style="min-width:200px"><div style="display:flex;align-items:center;">${dot}<span>${cell(r.name)}</span></div></td>
      <td>${cell(r.factory)}</td>
      <td>
        <div style="font-weight:500">${cell(r.c1Name)}</div>
        <div style="font-size:11.5px">${mailLink(r.c1Email)}</div>
        <div>${telLink(r.c1Phone)}</div>
      </td>
      <td>
        <div style="font-weight:500">${cell(r.c2Name)}</div>
        <div style="font-size:11.5px">${mailLink(r.c2Email)}</div>
        <div>${telLink(r.c2Phone)}</div>
      </td>
      <td>${cell(r.materialDesc)}</td>
    </tr>`;
  }).join('');

  const pill=(id,label,val)=>`<button id="vdf-${id}" onclick="vdSetFilter('${val}')"
      style="cursor:pointer;padding:5px 11px;border:1px solid var(--brd2,#a3aab1);background:${_vdFilter===val?'var(--acc,#0072bc)':'transparent'};color:${_vdFilter===val?'#fff':'var(--t2)'};font-family:var(--fn);font-size:11.5px;font-weight:500;border-radius:2px;">${label}</button>`;

  setM(`
    <div class="shd">
      <h2 class="stitle">Vendor Details</h2>
      <div class="chps" style="align-items:center;gap:10px;">
        <span class="ch ch-b">${rows.length} vendors</span>
      </div>
    </div>

    <div class="kg">
      <div class="kpi"><div class="kl">Vendors Listed</div><div class="kv cb">${rows.length}</div></div>
      <div class="kpi"><div class="kl">With Email</div><div class="kv cp">${nEmail}</div></div>
      <div class="kpi"><div class="kl">Senior Contact On File</div><div class="kv ca">${nSenior}</div></div>
      <div class="kpi"><div class="kl">No Contact Yet</div><div class="kv" style="color:${nGap?'var(--red,#b23b3b)':'var(--grn,#2e7d4f)'}">${nGap}</div></div>
    </div>

    <div class="pn">
      <div class="phd" style="flex-wrap:wrap;gap:8px;">
        <h3 class="pt">Contact Directory</h3>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${pill('all','All','all')}${pill('complete','Complete','complete')}${pill('partial','Partial','partial')}${pill('missing','Not in Master','missing')}
          <input class="sinp" id="vd-search" placeholder="Search code, name, city, contact…" oninput="vdFilter()" style="width:260px"/>
          <button class="btn-exp" onclick="vdExportCSV()" title="Download this directory as CSV">
            <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Export
          </button>
        </div>
      </div>
      <div class="pb">
        ${rows.length?`
        <div style="overflow-x:auto">
          <table class="dt">
            <thead><tr>
              <th>Vendor Code</th><th>Vendor Name</th><th>Factory Location</th>
              <th>First Level Contact</th><th>Senior Level Contact</th><th>Material Description</th>
            </tr></thead>
            <tbody id="vd-body">${body}</tbody>
          </table>
        </div>
        <div id="vd-empty" style="display:none;padding:26px;text-align:center;color:var(--t3);font-size:12.5px;">No vendor matches that search.</div>
        `:`<div style="padding:30px;text-align:center;color:var(--t3);font-size:12.5px;line-height:1.7">
             No vendor data loaded yet.<br/>Upload <b>Vendor_Master.xlsx</b> to populate this directory.
           </div>`}
      </div>
    </div>
  `);
  document.querySelectorAll('.nav').forEach(e=>e.classList.remove('on'));
  const nv=document.getElementById('nav-vdetails'); if(nv) nv.classList.add('on');
  vdFilter();
}

function vdSetFilter(v){ _vdFilter=v; rVendorDetails(); }

function vdFilter(){
  const q=(document.getElementById('vd-search')?.value||'').trim().toLowerCase();
  let shown=0;
  document.querySelectorAll('#vd-body .vd-row').forEach(tr=>{
    const okQ=!q||tr.dataset.s.includes(q);
    const okF=_vdFilter==='all'||tr.dataset.st===_vdFilter;
    const on=okQ&&okF;
    tr.style.display=on?'':'none';
    if(on) shown++;
  });
  const em=document.getElementById('vd-empty'); if(em) em.style.display=shown?'none':'';
}

function vdExportCSV(){
  const rows=vendorDetailRows();
  const head=['Vendor Code','Vendor Name','Factory Location','Address','Material Description','First Level Contact Name',
              'First Level Email','First Level Number','Senior Level Contact Name','Senior Level Email',
              'Senior Level Number','In Vendor Master'];
  const q=(s)=>`"${String(s==null?'':s).replace(/"/g,'""')}"`;
  const csv=[head.map(q).join(',')].concat(rows.map(r=>[r.code,r.name,r.factory,r.address,r.materialDesc,r.c1Name,
              r.c1Email,r.c1Phone,r.c2Name,r.c2Email,r.c2Phone,r.inMaster?'Yes':'No'].map(q).join(','))).join('\n');
  dlCSV(csv,'Vendor_Details.csv');
  toast('Vendor details exported','ok');
}

// ---- Detail panel --------------------------------------------------------------
// Full contact card for one vendor, reached by clicking any row in the directory.
function openVendorDetail(key, fromHistory=false){
  const h='#vdetail:'+encodeURIComponent(key);
  if(!fromHistory && window.location.hash!==h) window.history.pushState(null,'',h);

  const rows=vendorDetailRows();
  const k=normCodeKey(key), kn=normVenKey(key);
  const r=rows.find(x=>(x.code&&normCodeKey(x.code)===k)||(x.name&&normVenKey(x.name)===kn));
  if(!r){ toast('Vendor not found in the directory','warn'); rVendorDetails(); return; }

  const dash='<span style="color:var(--t4,#9aa3ab)">Not provided</span>';
  const field=(label,val,extra='')=>`
    <div style="padding:11px 0;border-bottom:1px solid var(--brd,#e3e8ed);">
      <div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--t3);font-weight:600;margin-bottom:3px;">${hesc(label)}</div>
      <div style="font-size:13px;color:var(--txt);line-height:1.55;${extra}">${val||dash}</div>
    </div>`;
  const mail=(e)=>e?`<a href="mailto:${hesc(e)}" style="color:var(--acc,#0072bc);text-decoration:none;">${hesc(e)}</a>`:'';
  const tel=(p)=>p?`<a href="tel:${hesc(String(p).replace(/[^\d+]/g,''))}" style="color:var(--txt);text-decoration:none;font-family:var(--mono);">${hesc(p)}</a>`:'';

  const contactCard=(title,nm,em,ph,note)=>`
    <div class="pn" style="margin:0;">
      <div class="phd"><h3 class="pt">${hesc(title)}</h3>
        <span style="font-size:10px;color:var(--t3);font-family:var(--fn)">${hesc(note)}</span></div>
      <div class="pb" style="padding-top:2px;">
        ${field('Contact Name', nm?hesc(nm):'')}
        ${field('Email', mail(em))}
        ${field('Phone', tel(ph))}
      </div>
    </div>`;

  const inMasterTag=r.inMaster
    ? ''
    : `<div style="margin-bottom:14px;padding:10px 13px;border-left:3px solid var(--amb,#d98c1f);background:var(--s1,#faf7f2);font-size:12px;color:var(--t2);line-height:1.6;">
         This vendor appears in the rating workbook but has no row in <b>Vendor_Master.xlsx</b>.
         Add it there — code <span style="font-family:var(--mono)">${hesc(r.code||'—')}</span> — to capture contacts.
       </div>`;

  setM(`
    <div class="shd" style="align-items:flex-start;">
      <div>
        <h2 class="stitle" style="margin-bottom:2px;">${hesc(r.name||r.code||'Vendor')}</h2>
        <div style="font-family:var(--mono);font-size:11.5px;color:var(--t3);">${hesc(r.code||'')}</div>
      </div>
      <div class="chps" style="gap:8px;">
        <button onclick="goBack('vdetails')" style="cursor:pointer;background:none;border:1px solid var(--brd2,#a3aab1);color:var(--t2);font-family:var(--hd);font-weight:500;font-size:12px;padding:7px 14px;border-radius:2px;">&larr; Vendor Details</button>
        ${r.code?`<button onclick="openVendorPage('${esc(r.code)}')" style="cursor:pointer;background:none;border:1px solid var(--brd2,#a3aab1);color:var(--t2);font-family:var(--hd);font-weight:500;font-size:12px;padding:7px 14px;border-radius:2px;">Ratings &rarr;</button>`:''}
        ${r.code?`<button onclick="emailVendor('${esc(r.code)}')" title="${r.c1Email?('To: '+hesc(r.c1Email)+(r.c2Email?('  |  Cc: '+hesc(r.c2Email)):'')):'No email on file — opens Outlook with a blank recipient'}"
            style="cursor:pointer;background:var(--acc,#0072bc);border:1px solid var(--acc,#0072bc);color:#fff;font-family:var(--hd);font-weight:600;font-size:12px;padding:7px 14px;border-radius:2px;">Email Vendor</button>`:''}
      </div>
    </div>

    ${inMasterTag}

    <div class="pn">
      <div class="phd"><h3 class="pt">Vendor Information</h3>
        <span style="font-size:10px;color:var(--t3);font-family:var(--fn)">${r.poCount?`${r.poCount} PO(s) in the workbook`:'From Vendor Master'}</span></div>
      <div class="pb" style="padding-top:2px;">
        ${field('Vendor Code', r.code?`<span style="font-family:var(--mono)">${hesc(r.code)}</span>`:'')}
        ${field('Vendor Name', r.name?hesc(r.name):'')}
        ${field('Factory Location', r.factory?hesc(r.factory):'')}
        ${field('Address', r.address?hesc(r.address).replace(/\n/g,'<br/>'):'')}
        ${field('Material Description', r.materialDesc?hesc(r.materialDesc):'')}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:14px;">
      ${contactCard('First Level Contact', r.c1Name, r.c1Email, r.c1Phone, 'Mail goes To:')}
      ${contactCard('Senior Level Contact', r.c2Name, r.c2Email, r.c2Phone, 'Mail goes Cc:')}
    </div>
  `);
  document.querySelectorAll('.nav').forEach(e=>e.classList.remove('on'));
  const nv=document.getElementById('nav-vdetails'); if(nv) nv.classList.add('on');
  scrollMainToTop();
}
