/* ════════════════════════════════════════════════════════════════════
   SKIN v2 · presentation-only enhancement layer
   · CountUp.js (CDN) animates KPI numerals on first paint
   · IntersectionObserver staggers panel/KPI reveals on scroll
   · MutationObserver re-arms both after every view re-render
   Fully defensive: if a CDN is blocked or an API is missing, the app
   behaves exactly as before. No application state is read or written.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ---- scroll reveal ------------------------------------------------ */
  var io = null;
  if ('IntersectionObserver' in window && !reduce) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var el = en.target;
          el.classList.remove('sv2-pre');
          el.style.animationDelay = (Math.min(el.__sv2i || 0, 6) * 45) + 'ms';
          el.classList.add('sv2-in');
          io.unobserve(el);
        }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  }

  /* ---- animated numerals (CountUp.js) ------------------------------- */
  function countUpEl(el) {
    if (el.dataset.sv2c) return;
    el.dataset.sv2c = '1';
    if (reduce || !window.countUp || !window.countUp.CountUp) return;
    // Some tiles render their unit in a trailing <small> (e.g. 83.4<small>%</small>).
    // CountUp rewrites the whole element's text, so target the numeric node only and
    // leave the unit markup intact.
    var host = el, unitEl = null;
    var kids = el.childNodes;
    if (kids.length === 2 && kids[0].nodeType === 3 && kids[1].nodeName === 'SMALL') {
      unitEl = kids[1];
      var span = document.createElement('span');
      span.textContent = kids[0].nodeValue;
      el.replaceChild(span, kids[0]);
      host = span;
    }
    var raw = (host.textContent || '').trim();
    // Only pure numerals, optionally with decimals / % / ★ suffix.
    var m = raw.match(/^(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?\s*([%★]?)$/);
    if (!m) return;
    var num = parseFloat((m[1] + (m[2] || '')).replace(/,/g, ''));
    if (!isFinite(num)) return;
    var decimals = m[2] ? m[2].length - 1 : 0;
    try {
      var c = new window.countUp.CountUp(host, num, {
        duration: 1.1,
        decimalPlaces: decimals,
        separator: m[1].indexOf(',') > -1 ? ',' : '',
        suffix: m[3] ? (raw.indexOf(' ' + m[3]) > -1 ? ' ' + m[3] : m[3]) : ''
      });
      if (!c.error) c.start(); else host.textContent = raw;
    } catch (e) { host.textContent = raw; }
  }

  /* ---- arm everything currently in #main ---------------------------- */
  var armQueued = false;
  function arm() {
    armQueued = false;
    var main = document.getElementById('main');
    if (!main) return;
    var i = 0;
    main.querySelectorAll('.kpi, .pn, .vpd-stat, .upzone, .knc, .cdd-kpi').forEach(function (el) {
      if (el.dataset.sv2r) return;
      el.dataset.sv2r = '1';
      el.__sv2i = i++;
      if (io) { el.classList.add('sv2-pre'); io.observe(el); }
    });
    main.querySelectorAll('.kv, .vpd-stat-value, .cdd-kpi-v').forEach(countUpEl);
  }
  function queueArm() {
    if (armQueued) return;
    armQueued = true;
    (window.requestAnimationFrame || setTimeout)(arm, 16);
  }

  function boot() {
    queueArm();
    var main = document.getElementById('main');
    if (main && 'MutationObserver' in window) {
      new MutationObserver(queueArm).observe(main, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* ════════════════════════════════════════════════════════════════════
   Keyboard + screen-reader access for click-only controls
   The app renders ~100+ interactive elements as plain <div>/<tr>/<span
   onclick="..."> (nav items, table rows, KPI cards, tier tiles, legend
   rows) with no native keyboard affordance, plus ~75 uses of the native
   title="" attribute as the only place explanatory text lives (mouse-hover
   only: unreachable by keyboard, inconsistent across screen readers,
   invisible on touch). Rather than hand-editing every render call across
   7 view files, this sweeps #main after every re-render (same
   MutationObserver pattern as the block above) and:
   1) gives any [onclick] element that isn't already natively focusable a
      tabindex (role="button" too, except on table rows/cells, which keep
      their table semantics),
   2) delegates Enter/Space activation to one document listener, skipping
      elements that already handle those keys natively (a/button/input/
      select/textarea) so their own handling isn't double-fired,
   3) copies each title="" into a paired <span> exposed via
      aria-describedby, so screen readers get it regardless of hover
      support, and reveals it as a visible on-focus tooltip (CSS below)
      for non-table elements — the safe majority of the ~75, since
      position:relative on table rows/cells risks interacting with the
      sticky table header (table.dt th{position:sticky}) in ways this
      sweep can't visually verify across every table in the app,
   4) mirrors .nav's "on" class into aria-current, so it can't fall out of
      sync with whichever of the ~10 call sites toggles it.
   Fully defensive: degrades gracefully if MutationObserver is missing.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var NATIVE_KEY_TAGS = { A: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1 };
  var NO_ROLE_TAGS = { TR: 1, TH: 1, TD: 1, TABLE: 1, TBODY: 1, THEAD: 1 };

  /* ---- 1) tabindex/role sweep for [onclick] --------------------------- */
  function enhanceClickable(el) {
    if (el.hasAttribute('tabindex') || NATIVE_KEY_TAGS[el.tagName]) return;
    el.setAttribute('tabindex', '0');
    if (!NO_ROLE_TAGS[el.tagName] && !el.hasAttribute('role')) {
      el.setAttribute('role', 'button');
    }
  }

  /* ---- 2) Enter/Space activation, delegated --------------------------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var el = e.target && e.target.closest && e.target.closest('[onclick]');
    if (!el || NATIVE_KEY_TAGS[el.tagName]) return;
    e.preventDefault();
    el.click();
  });

  /* ---- 3) title="" -> aria-describedby (+ visible on-focus tooltip) --- */
  var ttSeq = 0;
  function upgradeTooltip(el) {
    var text = el.getAttribute('title');
    if (!text || el.dataset.a11yTip) return;
    el.dataset.a11yTip = '1';
    // Redundant with an identical aria-label (e.g. the theme toggle button) —
    // that's already announced as the element's name, a description would
    // just repeat it.
    if (el.getAttribute('aria-label') === text) return;
    var id = 'a11y-tip-' + (++ttSeq);
    var desc = document.createElement('span');
    desc.id = id;
    desc.className = 'a11y-tip';
    desc.textContent = text;
    el.appendChild(desc);
    var existing = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', existing ? existing + ' ' + id : id);
    if (!el.hasAttribute('tabindex') && !NATIVE_KEY_TAGS[el.tagName]) {
      el.setAttribute('tabindex', '0');
    }
    if (!NO_ROLE_TAGS[el.tagName]) el.classList.add('a11y-tip-host');
  }

  /* ---- 4) .nav "on" -> aria-current ------------------------------------ */
  function syncNavAriaCurrent() {
    document.querySelectorAll('.nav').forEach(function (el) {
      if (el.classList.contains('on')) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  function sweep(root) {
    (root || document).querySelectorAll('[onclick]').forEach(enhanceClickable);
    (root || document).querySelectorAll('[title]').forEach(upgradeTooltip);
  }

  function boot() {
    sweep(document); // static shell: topbar nav, upload screen, theme toggle, etc.
    syncNavAriaCurrent();
    var main = document.getElementById('main');
    if (main && 'MutationObserver' in window) {
      new MutationObserver(function () { sweep(main); syncNavAriaCurrent(); })
        .observe(main, { childList: true, subtree: true });
    }
    var topbar = document.getElementById('topbar');
    if (topbar && 'MutationObserver' in window) {
      new MutationObserver(syncNavAriaCurrent).observe(topbar, {
        attributes: true, attributeFilter: ['class'], subtree: true
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
