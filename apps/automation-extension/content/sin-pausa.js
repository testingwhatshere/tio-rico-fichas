// Que el panel siga funcionando aunque su ventana quede tapada, minimizada o en
// segundo plano mientras el operador usa la PC.
//
// Con la página oculta Chrome deja de dibujarla: requestAnimationFrame no corre, y
// las animaciones de los diálogos del panel (Vue) no terminan nunca de abrir/cerrar.
// Además, tras 5 minutos oculta, los setTimeout encadenados (como las esperas de la
// automatización) pasan a correr una vez por minuto. Las dos cosas cortaban cargas.
//
// Mientras la página está oculta:
//  - requestAnimationFrame se resuelve con un timer de ~16 ms.
//  - cada setTimeout se agenda desde un mensaje (MessageChannel), así nunca queda
//    "encadenado" y Chrome no lo demora a un minuto.
// Con la página visible todo pasa directo a las funciones nativas.
//
// Se inyecta al iniciar el documento, en MAIN (antes de que cargue Vue, que guarda
// una referencia a requestAnimationFrame) y en el mundo aislado (esperas de la extensión).
(() => {
  if (window.__tioSinPausa) return;
  window.__tioSinPausa = true;

  const st = window.setTimeout.bind(window);
  const ct = window.clearTimeout.bind(window);
  const raf = window.requestAnimationFrame?.bind(window);
  const caf = window.cancelAnimationFrame?.bind(window);
  const oculta = () => document.visibilityState === 'hidden';

  let seq = 2e9;
  const timers = new Map(); // id propio -> id nativo (null hasta agendarlo)
  const cola = [];
  const canal = new MessageChannel();
  canal.port1.onmessage = () => { const f = cola.shift(); if (f) f(); };

  window.setTimeout = function setTimeout(fn, ms, ...args) {
    if (!oculta() || typeof fn !== 'function') return st(fn, ms, ...args);
    const id = ++seq;
    timers.set(id, null);
    cola.push(() => {
      if (!timers.has(id)) return;
      timers.set(id, st(() => { timers.delete(id); fn(...args); }, ms));
    });
    canal.port2.postMessage(0);
    return id;
  };

  window.clearTimeout = function clearTimeout(id) {
    if (timers.has(id)) {
      const nativo = timers.get(id);
      timers.delete(id);
      if (nativo != null) ct(nativo);
      return;
    }
    ct(id);
  };

  if (!raf) return;
  const rafs = new Map(); // id propio -> { tipo: 'raf' | 'timer', nativo, correr }

  const porTimer = (r) => {
    r.tipo = 'timer';
    r.nativo = window.setTimeout(() => r.correr(performance.now()), 16);
  };

  window.requestAnimationFrame = function requestAnimationFrame(cb) {
    const id = ++seq;
    const r = { correr: (t) => { if (rafs.delete(id)) cb(t); } };
    rafs.set(id, r);
    if (oculta()) porTimer(r);
    else { r.tipo = 'raf'; r.nativo = raf(r.correr); }
    return id;
  };

  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    const r = rafs.get(id);
    if (!r) return caf(id);
    rafs.delete(id);
    if (r.tipo === 'raf') caf(r.nativo);
    else window.clearTimeout(r.nativo);
  };

  // Frames pedidos justo antes de ocultarse: el nativo ya no va a correr.
  document.addEventListener('visibilitychange', () => {
    if (!oculta()) return;
    for (const r of rafs.values()) {
      if (r.tipo === 'raf') { caf(r.nativo); porTimer(r); }
    }
  }, true);
})();
