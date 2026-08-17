/* ════════════════════════════════════════════════════════════════════
   AUTOLOAD v1 — read the workbooks sitting next to this HTML file.

   Three tiers, tried in order, so nobody hits a dead end:

     1. fetch('./*.xlsx')      Works when the page is served over http://
                               (i.e. launched via START_WINDOWS.bat).
                               Silent, automatic, every browser.
     2. Directory picker       For Chrome/Edge users who opened the HTML
                               directly. One folder-pick, remembered in
                               IndexedDB across reloads.
     3. Manual upload button   The original behaviour. Always available.

   Tier 1 cannot work from file:// — fetch() on a file:// URL is blocked
   by CORS in every modern browser. Tier 2 cannot work from file:// either
   (showDirectoryPicker requires a secure context). Hence the launcher.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var FILES = ['Vendor_Rating_Workbook.xlsx', 'Vendor_Master.xlsx'];
  var DB_NAME = 'lnt_autoload', STORE = 'handles';

  function log(m){ try { console.info('[autoload] ' + m); } catch(e){} }

  /* ---- tiny IndexedDB helpers (handles are structured-cloneable) ---- */
  function idb(){
    return new Promise(function(res, rej){
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore(STORE); };
      r.onsuccess = function(){ res(r.result); };
      r.onerror   = function(){ rej(r.error); };
    });
  }
  function idbGet(k){
    return idb().then(function(db){ return new Promise(function(res){
      var t = db.transaction(STORE,'readonly').objectStore(STORE).get(k);
      t.onsuccess = function(){ res(t.result); };
      t.onerror   = function(){ res(null); };
    });});
  }
  function idbSet(k, v){
    return idb().then(function(db){ return new Promise(function(res){
      var t = db.transaction(STORE,'readwrite').objectStore(STORE).put(v, k);
      t.onsuccess = function(){ res(true); };
      t.onerror   = function(){ res(false); };
    });});
  }

  /* ---- feed an ArrayBuffer into the app's existing load path -------- */
  function toFile(buf, name){
    try { return new File([buf], name,
      { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
    catch(e){ var b = new Blob([buf]); b.name = name; return b; }
  }

  function handOff(files, source){
    if (!files.length) return false;
    if (typeof window.loadFiles !== 'function'){ log('loadFiles() not found'); return false; }
    log('loading ' + files.length + ' file(s) via ' + source);
    try { window.loadFiles(files); return true; }
    catch(e){ log('loadFiles threw: ' + e.message); return false; }
  }

  /* ---- TIER 1 · fetch from the same folder (needs http://) ---------- */
  function tierFetch(){
    if (location.protocol === 'file:') return Promise.resolve(false);
    var jobs = FILES.map(function(n){
      return fetch(n, { cache:'no-store' })
        .then(function(r){ return r.ok ? r.arrayBuffer().then(function(b){ return toFile(b, n); }) : null; })
        .catch(function(){ return null; });
    });
    return Promise.all(jobs).then(function(list){
      var files = list.filter(Boolean);
      return files.length ? handOff(files, 'same-folder fetch') : false;
    });
  }

  /* ---- TIER 2 · remembered directory handle (Chrome/Edge, http) ----- */
  function readDir(dir){
    var out = [], walk = [];
    return (async function(){
      for await (var ent of dir.entries()){
        var name = ent[0], h = ent[1];
        if (h.kind !== 'file') continue;
        if (!/\.xlsx$/i.test(name)) continue;
        walk.push(h.getFile().then(function(f){ return f.arrayBuffer().then(function(b){ return toFile(b, f.name); }); }));
      }
      out = await Promise.all(walk);
      return out;
    })();
  }

  function tierHandle(){
    if (!window.showDirectoryPicker) return Promise.resolve(false);
    return idbGet('dir').then(function(dir){
      if (!dir) return false;
      return dir.queryPermission({ mode:'read' }).then(function(p){
        if (p === 'granted') return true;
        if (p === 'prompt') return dir.requestPermission({ mode:'read' }).then(function(q){ return q === 'granted'; });
        return false;
      }).then(function(ok){
        if (!ok) return false;
        return readDir(dir).then(function(files){ return handOff(files, 'saved folder'); });
      });
    }).catch(function(){ return false; });
  }

  // Exposed for the "Choose folder" button (tier 2 first-time setup).
  window.pickDataFolder = function(){
    if (!window.showDirectoryPicker){
      alert('This browser does not support folder access.\n\nUse START_WINDOWS.bat to launch the dashboard, or use the file picker.');
      return;
    }
    window.showDirectoryPicker({ mode:'read' }).then(function(dir){
      return idbSet('dir', dir).then(function(){
        return readDir(dir).then(function(files){ handOff(files, 'folder picker'); });
      });
    }).catch(function(){ /* user cancelled */ });
  };

  /* ---- boot: try tiers in order, stop at first success -------------- */
  function boot(){
    tierFetch().then(function(ok){
      if (ok) return true;
      return tierHandle();
    }).then(function(ok){
      if (!ok){
        log('no automatic source — use the file picker (tier 3)');
        if (location.protocol === 'file:'){
          log('opened via file:// — auto-load is unavailable; run START_WINDOWS.bat for automatic loading');
        }
      }
    }).catch(function(e){ log('boot error: ' + e.message); });
  }

  if (document.readyState === 'complete') setTimeout(boot, 60);
  else window.addEventListener('load', function(){ setTimeout(boot, 60); });
})();
