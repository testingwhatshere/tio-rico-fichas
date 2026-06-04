/**
 * JavaScript injected into the MHTML iframe for element selection.
 * Wrapped in a self-contained script tag that handles errors gracefully.
 */
export function buildPickerHtml(rawHtml: string): string {
  // Inject our picker script before </body> or </html> or at the end
  const script = PICKER_SCRIPT_CODE

  // Try to inject before closing tags (case-insensitive)
  const bodyClose = rawHtml.search(/<\/body\s*>/i)
  if (bodyClose !== -1) {
    return rawHtml.slice(0, bodyClose) + script + rawHtml.slice(bodyClose)
  }

  const htmlClose = rawHtml.search(/<\/html\s*>/i)
  if (htmlClose !== -1) {
    return rawHtml.slice(0, htmlClose) + script + rawHtml.slice(htmlClose)
  }

  // Fallback: append at end
  return rawHtml + script
}

const PICKER_SCRIPT_CODE = `
<style>
  .__picker-overlay {
    position: fixed !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    border: 2px solid #a855f7 !important;
    background: rgba(168, 85, 247, 0.1) !important;
    transition: all 0.08s ease !important;
    display: none;
    border-radius: 3px !important;
    box-sizing: border-box !important;
  }
  .__picker-tooltip {
    position: fixed !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
    background: #18181b !important;
    color: #e4e4e7 !important;
    font: 11px/1.4 'SF Mono', Menlo, monospace !important;
    padding: 4px 10px !important;
    border-radius: 6px !important;
    border: 1px solid #3f3f46 !important;
    display: none;
    max-width: 350px !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
  }
  .__picker-test-hl {
    position: fixed !important;
    pointer-events: none !important;
    z-index: 2147483646 !important;
    border: 2px solid #22c55e !important;
    background: rgba(34, 197, 94, 0.12) !important;
    border-radius: 3px !important;
    box-sizing: border-box !important;
  }
</style>
<script>
(function() {
  try {
    if (window.__pickerReady) return;
    window.__pickerReady = true;

    var hoveredEl = null;
    var pickingEnabled = true;
    var testHls = [];

    // Create overlay
    var ov = document.createElement('div');
    ov.className = '__picker-overlay';
    document.body.appendChild(ov);

    // Create tooltip
    var tip = document.createElement('div');
    tip.className = '__picker-tooltip';
    document.body.appendChild(tip);

    function posOv(el) {
      var r = el.getBoundingClientRect();
      ov.style.left = r.left + 'px';
      ov.style.top = r.top + 'px';
      ov.style.width = r.width + 'px';
      ov.style.height = r.height + 'px';
      ov.style.display = 'block';
    }

    function label(el) {
      var s = el.tagName.toLowerCase();
      if (el.id) s += '#' + el.id;
      if (el.className && typeof el.className === 'string') {
        var c = el.className.trim().split(/\\s+/).slice(0, 3).join('.');
        if (c) s += '.' + c;
      }
      var t = el.getAttribute('type');
      if (t) s += ' [type=' + t + ']';
      var n = el.getAttribute('name');
      if (n) s += ' [name=' + n + ']';
      var a = el.getAttribute('aria-label');
      if (a) s += ' [aria="' + a.substring(0, 25) + '"]';
      return s;
    }

    function isPicker(el) {
      if (!el) return false;
      var cn = el.className;
      return typeof cn === 'string' && cn.indexOf('__picker') !== -1;
    }

    // Hover
    document.addEventListener('mousemove', function(e) {
      if (!pickingEnabled) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isPicker(el)) return;
      if (el === hoveredEl) {
        tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 360) + 'px';
        tip.style.top = Math.max(e.clientY - 32, 4) + 'px';
        return;
      }
      hoveredEl = el;
      posOv(el);
      tip.textContent = label(el);
      tip.style.display = 'block';
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 360) + 'px';
      tip.style.top = Math.max(e.clientY - 32, 4) + 'px';
    }, true);

    document.addEventListener('mouseleave', function() {
      ov.style.display = 'none';
      tip.style.display = 'none';
      hoveredEl = null;
    });

    // Click
    document.addEventListener('click', function(e) {
      if (!pickingEnabled) return;
      var el = e.target;
      if (!el || isPicker(el)) return;

      e.preventDefault();
      e.stopPropagation();

      var cands = genCandidates(el);

      try {
        window.parent.postMessage({
          type: 'ELEMENT_SELECTED',
          candidates: cands,
          elementInfo: {
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            classes: (el.className && typeof el.className === 'string') ? el.className.trim().split(/\\s+/).filter(Boolean) : [],
            text: (el.textContent || '').trim().substring(0, 80),
            type: el.getAttribute('type'),
            name: el.getAttribute('name'),
            ariaLabel: el.getAttribute('aria-label'),
            placeholder: el.getAttribute('placeholder'),
            href: el.getAttribute('href')
          }
        }, '*');
      } catch(err) {
        console.error('[Picker] postMessage failed:', err);
      }
    }, true);

    // Candidate generation
    function genCandidates(el) {
      var res = [];
      try {
        // ID
        if (el.id && el.id.indexOf('__picker') === -1) {
          tryAdd(res, '#' + el.id, 'ID unico');
        }
        // aria-label
        var aria = el.getAttribute('aria-label');
        if (aria) {
          tryAdd(res, el.tagName.toLowerCase() + '[aria-label="' + aria + '"]', 'aria-label');
        }
        // name
        var nm = el.getAttribute('name');
        if (nm) {
          tryAdd(res, el.tagName.toLowerCase() + '[name="' + nm + '"]', 'name attr');
        }
        // type (inputs)
        var tp = el.getAttribute('type');
        if (tp && el.tagName === 'INPUT') {
          var ph = el.getAttribute('placeholder');
          if (ph) {
            tryAdd(res, 'input[type="' + tp + '"][placeholder*="' + ph.substring(0, 20) + '"]', 'type + placeholder');
          } else {
            tryAdd(res, 'input[type="' + tp + '"]', 'type attr');
          }
        }
        // href
        var hr = el.getAttribute('href');
        if (hr && el.tagName === 'A') {
          var hp = hr.split('?')[0].split('#')[0];
          if (hp.length > 1) {
            tryAdd(res, 'a[href*="' + hp.substring(Math.max(0, hp.length - 20)) + '"]', 'href pattern');
          }
        }
        // Classes
        if (el.className && typeof el.className === 'string') {
          var cls = el.className.trim().split(/\\s+/).filter(function(c) {
            return c && c.length > 2;
          });
          if (cls.length > 0) {
            tryAdd(res, el.tagName.toLowerCase() + '.' + cls.slice(0, 3).join('.'), 'clases CSS');
          }
        }
        // Positional
        if (el.parentElement && el.parentElement !== document.body && el.parentElement !== document.documentElement) {
          var par = el.parentElement;
          var sibs = [];
          for (var i = 0; i < par.children.length; i++) {
            if (par.children[i].tagName === el.tagName) sibs.push(par.children[i]);
          }
          var idx = sibs.indexOf(el) + 1;
          var ps = par.tagName.toLowerCase();
          if (par.id) ps = '#' + par.id;
          else if (par.className && typeof par.className === 'string') {
            var pc = par.className.trim().split(/\\s+/).filter(function(c) { return c.length > 2; }).slice(0, 2);
            if (pc.length) ps += '.' + pc.join('.');
          }
          var cs = el.tagName.toLowerCase() + (sibs.length > 1 ? ':nth-of-type(' + idx + ')' : '');
          tryAdd(res, ps + ' > ' + cs, 'posicion en DOM');
        }
      } catch(err) {
        console.error('[Picker] genCandidates error:', err);
      }
      return res.slice(0, 6);
    }

    function tryAdd(arr, sel, strat) {
      try {
        var count = document.querySelectorAll(sel).length;
        arr.push({ selector: sel, strategy: strat, matchCount: count });
      } catch(e) { /* invalid selector */ }
    }

    // Messages from parent
    window.addEventListener('message', function(e) {
      if (!e.data || !e.data.type) return;

      if (e.data.type === 'TEST_SELECTOR') {
        clearHls();
        try {
          var matches = document.querySelectorAll(e.data.selector);
          for (var i = 0; i < matches.length; i++) {
            var r = matches[i].getBoundingClientRect();
            var h = document.createElement('div');
            h.className = '__picker-test-hl';
            h.style.left = r.left + 'px';
            h.style.top = r.top + 'px';
            h.style.width = r.width + 'px';
            h.style.height = r.height + 'px';
            document.body.appendChild(h);
            testHls.push(h);
          }
          window.parent.postMessage({ type: 'TEST_RESULT', selector: e.data.selector, matchCount: matches.length }, '*');
        } catch(err) {
          window.parent.postMessage({ type: 'TEST_RESULT', selector: e.data.selector, matchCount: -1, error: err.message }, '*');
        }
      }

      if (e.data.type === 'CLEAR_HIGHLIGHTS') clearHls();

      if (e.data.type === 'SET_PICKING') {
        pickingEnabled = !!e.data.enabled;
        if (!pickingEnabled) {
          ov.style.display = 'none';
          tip.style.display = 'none';
        }
      }
    });

    function clearHls() {
      for (var i = 0; i < testHls.length; i++) testHls[i].remove();
      testHls = [];
    }

    console.log('[Picker] Ready');
  } catch(e) {
    console.error('[Picker] Init failed:', e);
  }
})();
</script>
`
