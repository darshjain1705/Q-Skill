/*
 * Shared light/dark theme controller for the launcher and the three tools.
 * Persists the choice in localStorage and keeps every same-origin iframe and
 * tab in sync through storage events. Exposes window.LTTheme.{ toggle, set, current }.
 */
(function(){
  var KEY = 'lt-suite-theme';

  function preferred(){
    try {
      var saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch(e){}
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function apply(t){ document.documentElement.setAttribute('data-theme', t); }

  // apply as early as possible (script is in <head>) to avoid a flash
  apply(preferred());

  function syncButtons(){
    var t = preferred();
    document.querySelectorAll('.theme-toggle').forEach(function(b){
      b.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      b.setAttribute('title', t === 'dark' ? 'Light mode' : 'Dark mode');
    });
  }

  window.LTTheme = {
    current: preferred,
    set: function(t){ try{ localStorage.setItem(KEY, t); }catch(e){} apply(t); syncButtons(); },
    toggle: function(){ this.set(preferred() === 'dark' ? 'light' : 'dark'); }
  };

  // react to changes made in other documents (launcher <-> iframe, other tabs)
  window.addEventListener('storage', function(e){
    if (e.key === KEY){ apply(preferred()); syncButtons(); }
  });
  // follow OS theme only when the user hasn't explicitly chosen
  if (window.matchMedia){
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){
        var saved; try{ saved = localStorage.getItem(KEY); }catch(e){}
        if (saved !== 'light' && saved !== 'dark'){ apply(preferred()); syncButtons(); }
      });
    } catch(e){}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncButtons);
  else syncButtons();
})();

