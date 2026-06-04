document.addEventListener('DOMContentLoaded', function () {
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  var isAndroid = /android/i.test(ua);

  var WEB_APP_URL = 'https://tiorico-chat-web.onrender.com';
  // APK fallback served from this same site (Render). For zero-server-bandwidth
  // hosting, swap this to a GitHub Releases URL once the release is published:
  //   https://github.com/<usuario>/<repo>/releases/download/v1.0.0/tio-rico-fichas.apk
  // (no other code changes needed — the in-app auto-update flow reads APP_APK_URL_CHAT
  // from backend settings and downloads from whatever URL is set there.)
  var APK_URL = 'tio-rico-fichas.apk';

  var btns = [
    document.getElementById('downloadBtn'),
    document.getElementById('downloadBtn2'),
    document.getElementById('navDownload')
  ];
  var hint = document.getElementById('downloadHint');

  btns.forEach(function (btn) {
    if (!btn) return;
    var isNav = btn.id === 'navDownload';
    if (isIOS) {
      btn.href = WEB_APP_URL;
      btn.removeAttribute('download');
      btn.textContent = isNav ? 'Abrir App' : 'Abrir App Web';
    } else {
      btn.href = APK_URL;
      btn.setAttribute('download', '');
      if (isNav) btn.textContent = 'Descargar';
    }
  });

  if (hint) {
    hint.textContent = isIOS ? 'Version web para iPhone'
      : isAndroid ? 'Disponible para Android'
      : 'Android \u00B7 Web para iOS';
  }

  // Scroll reveal
  var els = document.querySelectorAll('[data-reveal]');
  if (els.length && 'IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('revealed');
          obs.unobserve(e.target);
          if (e.target.querySelector('.stat-val')) animateCounters();
        }
      });
    }, { threshold: 0.15 });
    els.forEach(function (el, i) {
      el.style.transitionDelay = i * 80 + 'ms';
      obs.observe(el);
    });
  } else {
    els.forEach(function (el) { el.classList.add('revealed'); });
  }

  // Counter animation
  var counted = false;
  function animateCounters() {
    if (counted) return;
    counted = true;
    document.querySelectorAll('.stat-val[data-count]').forEach(function (c) {
      var target = parseInt(c.dataset.count, 10);
      var start = performance.now();
      function tick(now) {
        var p = Math.min((now - start) / 1600, 1);
        var ease = 1 - Math.pow(1 - p, 4);
        c.textContent = Math.floor(ease * target).toLocaleString('es-AR') + '+';
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }
});
