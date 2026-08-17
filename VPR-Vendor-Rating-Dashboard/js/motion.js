/* ════════════════════════════════════════════════════════════════════
   MOTION v4 · dual-engine layer  (anime.js 4.5.0 + GSAP 3.15.0)

   OWNERSHIP MAP — the one rule that keeps two engines from fighting.
   Each engine owns a disjoint set of elements. No element is ever
   touched by more than one animator, because two libraries writing the
   same transform/opacity on the same node in the same frame produces
   visible jitter (last writer per frame wins, and which one that is
   varies).

     GSAP        → view transitions (#main children), table rows
                   Chosen for: overwrite:'auto', which auto-kills a
                   conflicting tween on the same property if the user
                   navigates mid-animation. Matters most where renders
                   can interrupt each other.
     anime.js    → chart panel frames
                   Chosen for: its timeline + eases.outBack, and it
                   already drives these well.
     CountUp     → KPI numerals            (pre-existing, untouched)
     IO + CSS    → scroll reveal .sv2-*    (pre-existing, untouched)
     Chart.js    → its own <canvas>        (never animated from outside)

   Both CDNs are optional: each block checks for its engine and no-ops
   if absent, so a blocked CDN degrades to the original static UI.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function G()  { return window.gsap; }            // resolved lazily — both scripts are deferred
  function A()  { return window.anime; }
  function gsapReady()  { return !!G() && !reduce; }
  function animeReady() { return !!A() && !reduce; }

  /* ---- GSAP · view transitions --------------------------------------
     go()/goSheet() replace #main's innerHTML synchronously. We animate
     the NEW content in afterwards. No exit animation: the old DOM is
     already gone when the original returns, and faking one would just
     delay navigation.
     overwrite:'auto' is the reason GSAP owns this — rapid nav clicks
     kill the in-flight tween instead of stacking transforms. */
  function enterMain() {
    if (!gsapReady()) return;
    var main = document.getElementById('main');
    if (!main || !main.children.length) return;
    G().killTweensOf(main.children);
    G().from(main.children, {
      opacity:   0,
      y:         8,
      duration:  0.38,
      stagger:   0.028,
      ease:      'power3.out',
      overwrite: 'auto',
      clearProps:'transform,opacity'   // hand the element back to CSS when done
    });
  }

  function wrapNav(name) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__motionWrapped) return;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      try { enterMain(); } catch (e) {}
      return r;
    };
    wrapped.__motionWrapped = true;
    window[name] = wrapped;
  }

  /* ---- GSAP · table rows ---------------------------------------------
     streamRows() paints in chunks of 80 via requestIdleCallback. We
     animate each fresh chunk, capped at 40 nodes, so a 250-row sheet
     costs the same as a 40-row one. */
  function wrapStreamRows() {
    var orig = window.streamRows;
    if (typeof orig !== 'function' || orig.__motionWrapped) return;
    var wrapped = function (tbody, rowsHtml, onDone) {
      if (!gsapReady() || !tbody) return orig.apply(this, arguments);
      var seen = tbody.children.length;
      return orig.call(this, tbody, rowsHtml, function () {
        try {
          var fresh = Array.prototype.slice.call(tbody.children, seen, seen + 40);
          if (fresh.length) {
            G().from(fresh, {
              opacity:   0,
              y:         6,
              duration:  0.26,
              stagger:   0.012,
              ease:      'power2.out',
              overwrite: 'auto',
              clearProps:'transform,opacity'
            });
          }
        } catch (e) {}
        if (onDone) onDone();
      });
    };
    wrapped.__motionWrapped = true;
    window.streamRows = wrapped;
  }

  /* ---- anime.js · chart panel frames ---------------------------------
     Chart.js animates its own canvas internals, so we animate only the
     panel FRAME around it — never the canvas. data-motion marks a panel
     as done so re-renders don't re-trigger it. */
  function animatePanels(scope) {
    if (!animeReady()) return;
    // NOTE: scope is normally the #main element itself. An element-scoped
    // querySelectorAll still evaluates the FULL selector, so '#main .pn'
    // would require a #main ancestor *inside* main and match nothing.
    // Query '.pn' relative to the scope instead.
    var root = scope || document;
    var panels = root === document
      ? document.querySelectorAll('#main .pn:not([data-motion])')
      : root.querySelectorAll('.pn:not([data-motion])');
    if (!panels.length) return;
    Array.prototype.forEach.call(panels, function (p) { p.setAttribute('data-motion', '1'); });
    A().animate(panels, {
      opacity:  [0, 1],
      scale:    [0.985, 1],
      duration: 420,
      delay:    A().stagger(40),
      ease:     'out(3)'
    });
  }

  /* ---- boot ----------------------------------------------------------- */
  var queued = false;
  function sweep() {
    queued = false;
    var main = document.getElementById('main');
    if (!main) return;
    try { animatePanels(main); } catch (e) {}
  }
  function queueSweep() {
    if (queued) return;
    queued = true;
    // rAF is the right scheduler in a live tab, but it never fires in a
    // background/non-rendered document. The setTimeout is a safety net:
    // whichever lands first runs sweep(), and the `queued` latch plus the
    // per-element data-motion / __motionDone marks make a double-run a no-op.
    if (window.requestAnimationFrame) window.requestAnimationFrame(sweep);
    setTimeout(sweep, 32);
  }

  function boot() {
    if (!G() && !A()) return;            // both CDNs blocked — leave the UI as-is
    if (G()) {
      // Panels/map are anime.js territory; keep GSAP off them entirely.
      G().config({ nullTargetWarn: false });
      wrapNav('go');
      wrapNav('goSheet');
      wrapStreamRows();
    }
    queueSweep();
    var main = document.getElementById('main');
    if (main && 'MutationObserver' in window) {
      new MutationObserver(queueSweep).observe(main, { childList: true, subtree: true });
    }
  }

  // Both libs are deferred, so wait for load rather than DOMContentLoaded.
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
