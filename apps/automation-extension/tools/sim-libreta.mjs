// Simulación de la extensión en Node: libreta, clic con guardia de red, verificación
// por saldo, re-login y barrido tras un reinicio. Reloj virtual: los minutos de
// espera corren en milisegundos. Uso: node tools/sim-libreta.mjs
//
// No toca el panel ni el backend: chrome.*, la página y ApiClient son simulados.

import assert from 'node:assert/strict';

// ─── Reloj virtual ───────────────────────────────────────────────────────────
const RealDate = Date;
let vt = RealDate.parse('2026-10-16T15:00:00Z');
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(vt); else super(...a); }
  static now() { return vt; }
}
globalThis.Date = FakeDate;
let timers = [];
let timerSeq = 0;
globalThis.setTimeout = (f, ms = 0, ...args) => { const id = ++timerSeq; timers.push({ id, at: vt + Math.max(0, ms), f, args }); return id; };
globalThis.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
const drain = () => new Promise((r) => setImmediate(r));
async function run(promise) {
  let settled = false;
  let value; let error;
  promise.then((v) => { settled = true; value = v; }, (e) => { settled = true; error = e; });
  for (let i = 0; i < 200000; i++) {
    for (let k = 0; k < 5; k++) await drain();
    if (settled) break;
    if (!timers.length) throw new Error('deadlock: la promesa no termina y no hay timers');
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const t = timers.shift();
    vt = Math.max(vt, t.at);
    t.f(...t.args);
  }
  if (error) throw error;
  return value;
}

// ─── chrome.* simulado ───────────────────────────────────────────────────────
const noop = () => {};
const deepNoop = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : deepNoop()), apply: () => undefined });
let store = {};
const tabsLog = [];
const chromeMock = {
  storage: { local: {
    get: async (keys) => { const out = {}; for (const k of [].concat(keys || [])) if (k in store) out[k] = structuredClone(store[k]); return out; },
    set: async (obj) => { for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v); },
    remove: async (k) => { for (const key of [].concat(k)) delete store[key]; },
  }, onChanged: { addListener: noop } },
  scripting: { executeScript: async ({ func, args = [], files }) => (files ? [{ result: undefined }] : [{ result: await func(...args) }]) },
  tabs: {
    query: async () => [{ id: 1, url: 'https://panel.test/users', windowId: 1 }],
    get: async () => ({ id: 1, url: 'https://panel.test/users', status: 'complete' }),
    update: async (id, p) => { tabsLog.push(['update', p.url]); return { id }; },
    reload: async () => { tabsLog.push(['reload']); },
    create: async (p) => ({ id: 1, url: p.url }),
    onUpdated: { addListener: noop, removeListener: noop },
  },
  windows: { update: async () => ({}) },
  runtime: { getManifest: () => ({ version: '1.0.8' }), getContexts: async () => [], getURL: (p) => p, lastError: null,
    onInstalled: { addListener: noop }, onStartup: { addListener: noop }, onMessage: { addListener: noop } },
  alarms: { create: noop, get: async () => null, onAlarm: { addListener: noop } },
};
// Cualquier API que no esté simulada (onRemoved, action, notifications…) es un no-op.
const conRespaldo = (obj) => new Proxy(obj, {
  get: (t, k) => {
    if (!(k in t)) return deepNoop();
    const v = t[k];
    return v && typeof v === 'object' && !Array.isArray(v) ? conRespaldo(v) : v;
  },
});
globalThis.chrome = conRespaldo(chromeMock);
globalThis.WebSocket = { OPEN: 1 };
globalThis.self = globalThis;

// ─── Página del panel simulada (para el guardia y el clic en MAIN world) ─────
let panel; // escenario actual
function resetPage(scn) {
  delete globalThis.__trBot;
  const ss = {};
  globalThis.sessionStorage = { getItem: (k) => ss[k] ?? null, setItem: (k, v) => { ss[k] = String(v); } };
  globalThis.window = globalThis;
  globalThis.HTMLInputElement = class { set value(v) {} };
  globalThis.ProgressEvent = class { constructor(t) { this.type = t; } };
  globalThis.Event = class { constructor(t) { this.type = t; } };
  globalThis.fetch = async () => ({ status: 200, clone: () => ({ json: async () => ({}) }) });
  panel = { sends: 0, ...scn };
  class FakeXHR {
    open(m, u) { this.u = u; }
    addEventListener(ev, f) { this['_' + ev] = f; }
    dispatchEvent(e) { this['_' + e.type]?.(e); }
    send(body) {
      panel.sends++;
      panel.lastBody = body;
      const r = panel.respond;
      if (!r) return; // nunca responde
      setTimeout(() => {
        this.status = r.status; this.responseType = ''; this.responseText = JSON.stringify(r.json ?? {});
        this._loadend?.();
      }, r.afterMs ?? 600);
    }
  }
  globalThis.XMLHttpRequest = FakeXHR;
  const input = { dispatchEvent: noop };
  const btn = {
    removeAttribute: noop, getAttribute: () => null,
    click: () => {
      if (panel.buttonDead) return; // Aceptar no dispara nada
      const x = new XMLHttpRequest();
      x.open('POST', `/api/admin/user/${panel.op || 'addCredit'}`);
      x.send(JSON.stringify({ userKingboxId: 7, amount: panel.sentAmount ?? 1000 }));
    },
  };
  const modal = { querySelector: (sel) => (sel.includes('button') ? btn : input) };
  // Historial (/widthdraw): panel.historial = filas [fecha, origen, destino, importe]
  // (las más nuevas primero) o null si la tabla no aparece. panel.historialSoloBuscando:
  // la fila aparece recién después de buscar por usuario.
  let buscado = false;
  const filasHist = () => (panel.historial || [])
    .filter((f) => !panel.historialSoloBuscando || buscado)
    .map((f) => ({ cells: f.map((c) => ({ innerText: c })) }));
  const userInput = { dispatchEvent: noop };
  const buscar = { innerText: 'BUSCAR', click: () => { buscado = true; panel.busquedas = (panel.busquedas || 0) + 1; } };
  globalThis.document = {
    querySelector: (sel) => {
      if (sel.includes('modal')) return modal;
      if (sel === '#DataTables_Table_0') return panel.historial ? {} : null;
      if (sel === '#DataTables_Table_0_processing') return null;
      if (sel.includes('Username') || sel.includes('.md-form.mb-3')) return userInput;
      if (sel.includes('/users')) return { href: 'https://panel.test/users' };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('#DataTables_Table_0 tbody tr')) return filasHist();
      if (sel === 'button.btn-cyan') return [buscar];
      return [];
    },
  };
  globalThis.getComputedStyle = () => ({ display: 'none' });
}

// ─── Cargar módulos ──────────────────────────────────────────────────────────
globalThis.__TR_TEST__ = {};
const { JobLedger, necesitaVerificacion } = await import('../background/job-ledger.js');
const { JobProcessor } = await import('../background/job-processor.js');
const { ApiClient } = await import('../background/api-client.js');
await import('../background/service-worker.js');
const SW = globalThis.__TR_TEST__.sw;
const quiet = process.env.VERBOSE ? null : (console.log = noop, console.warn = noop, console.error = noop);

// Stubs del procesador (lo que toca el panel de verdad)
let saldos = [];          // lecturas de saldo que va a devolver verifyChips, en orden
let logueado = true;
let relogins = 0;
let sesionStatus = { isLoggedIn: true };
JobProcessor.captureScreenshotSafe = async () => null;
JobProcessor.waitForTabLoad = async () => {};
JobProcessor.ensurePanelTab = async () => ({ id: 1, url: 'https://panel.test/users', windowId: 1 });
JobProcessor.checkLoginStatus = async () => logueado;
JobProcessor.validateSession = async (tab) => { if (!logueado) { relogins++; logueado = true; } return tab; };
JobProcessor.verifyChips = async () => {
  const v = saldos.length ? saldos.shift() : null;
  return v == null ? { success: false } : { success: true, balance: v };
};

// ApiClient simulado
let reportes = [];
let backendCaido = false;
ApiClient.reportJobResult = async (cfg, jobId, payload) => { if (backendCaido) throw new Error('backend caído'); reportes.push({ jobId, payload }); return {}; };
ApiClient.reportJobStarted = async () => ({ ok: true });
ApiClient.checkKillSwitch = async () => ({ active: false });
ApiClient.checkActivityWindow = async () => ({ allowed: true });
ApiClient.reportStatus = async () => {};
ApiClient.uploadScreenshot = async () => null;
ApiClient.sendSessionLogBatch = async () => {};
SW.state.config = { backendUrl: 'http://backend.test', apiKey: 'k', panelId: 'p1', panelUrl: 'https://panel.test' };

// ─── Utilidades de test ──────────────────────────────────────────────────────
let pasaron = 0;
const fallos = [];
async function caso(nombre, fn) {
  store = {}; reportes = []; backendCaido = false; saldos = []; logueado = true; relogins = 0; tabsLog.length = 0;
  timers = []; SW.state.currentJob = null; SW.state.status = 'CONNECTED'; SW.state.claimingJobIds.clear();
  SW.state.lastJobCompletedAt = 0; SW.state.ultimaLibretaAt = 0; SW.state.circuitBreakerActive = false; SW.state.consecutiveJobErrors = 0;
  JobLedger._cola = Promise.resolve(); JobLedger._migrado = false;
  resetPage({});
  try { await fn(); pasaron++; process.stdout.write(`  ✓ ${nombre}\n`); }
  catch (e) { fallos.push(nombre); process.stdout.write(`  ✗ ${nombre}\n      ${e.stack?.split('\n').slice(0, 3).join('\n      ')}\n`); }
}
const job = (over = {}) => ({ id: over.id || `job-${Math.random().toString(36).slice(2, 8)}`, type: 'LOAD_CREDITS', targetUsername: 'juan77', amount: 1000, ...over });
async function fichaEn(j, etapa, datos = {}) {
  await JobLedger.abrir(j);
  for (const e of ['SESION_OK', 'USUARIO_ENCONTRADO', 'MONTO_LISTO', 'ACEPTAR_TOCADO']) {
    await JobLedger.avanzar(j.id, e, datos);
    if (e === etapa) break;
  }
  return JobLedger.get(j.id);
}
const click = (j, opts = {}) => JobProcessor.mainWorldClickAndWait(1, j, Number(j.amount), {
  op: 'addCredit', userKingboxId: 7, balanceBefore: 5000, config: SW.state.config, ...opts,
});
// Fila del historial con la hora local, como la muestra el panel ("16/10/26 03:05 PM")
const filaHora = (ms) => {
  const d = new Date(ms); const p2 = (n) => String(n).padStart(2, '0');
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p2(h)}:${p2(d.getMinutes())} ${ap}`;
};
const okJson = (balance = 6000, transaction = 991) => ({ header: { status: 200, description: 'OK' }, content: { walletUser: { balance }, transaction } });

// ─── Casos ───────────────────────────────────────────────────────────────────
console.info('Libreta');
await caso('abrir crea la ficha una vez; la segunda dice que ya existía', async () => {
  const j = job();
  const a = await JobLedger.abrir(j); const b = await JobLedger.abrir(j);
  assert.equal(a.existia, false); assert.equal(b.existia, true); assert.equal(b.ficha.etapa, 'RECIBIDA');
});
await caso('ACEPTAR_TOCADO se niega si la ficha está cancelada, ya tocada o resuelta', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  await JobLedger.cancelar(j.id);
  await assert.rejects(() => JobLedger.avanzar(j.id, 'ACEPTAR_TOCADO'), /cancelada/);
  const k = job(); await fichaEn(k, 'ACEPTAR_TOCADO');
  await assert.rejects(() => JobLedger.avanzar(k.id, 'ACEPTAR_TOCADO'), /ya se tocó/);
});
await caso('un OK no se pisa con otro veredicto', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO');
  await JobLedger.veredicto(j.id, 'OK'); await JobLedger.veredicto(j.id, 'EN_DUDA');
  assert.equal((await JobLedger.get(j.id)).veredicto, 'OK');
});
await caso('reabrirPorSesion: sólo con NO_APLICADA segura y una sola vez', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO');
  await JobLedger.veredicto(j.id, 'EN_DUDA');
  assert.equal(await JobLedger.reabrirPorSesion(j.id), false);
  const k = job(); await fichaEn(k, 'ACEPTAR_TOCADO');
  await JobLedger.veredicto(k.id, 'NO_APLICADA', { certeza: 'panel' });
  assert.equal(await JobLedger.reabrirPorSesion(k.id), true);
  const f = await JobLedger.get(k.id);
  assert.equal(f.etapa, 'RECIBIDA'); assert.equal(f.reintentoPorSesion, 1);
  await fichaEn(k, 'ACEPTAR_TOCADO');
  await JobLedger.veredicto(k.id, 'NO_APLICADA', { certeza: 'panel' });
  assert.equal(await JobLedger.reabrirPorSesion(k.id), false);
});
await caso('migra los failedReports viejos y los reenvía', async () => {
  store.failedReports = [{ jobId: 'viejo-1', result: { success: true }, failedAt: new Date().toISOString() }];
  await run(SW.procesarLibreta({ forzar: true }));
  assert.equal(store.failedReports, undefined);
  assert.deepEqual(reportes.map((r) => r.jobId), ['viejo-1']);
  assert.equal((await JobLedger.get('viejo-1')).etapa, 'CERRADA');
});

console.info('Clic + guardia de red');
await caso('panel responde OK → se cargó, se anota antes de volver a la lista', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: { status: 200, json: okJson() } });
  const r = await run(click(j));
  assert.equal(r.success, true); assert.equal(r.panelTransaction, 991);
  const f = await JobLedger.get(j.id);
  assert.equal(f.veredicto, 'OK'); assert.equal(f.respuestaPanel.transaction, 991);
  // Pasa por el historial y vuelve a usuarios.
  assert.ok(tabsLog.some((t) => t[1] === 'https://panel.test/widthdraw'));
  assert.deepEqual(tabsLog.at(-1), ['update', 'https://panel.test/users']);
  assert.equal(panel.sends, 1);
});
await caso('panel rechaza (422) → "No se cargó", segura', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: { status: 422, json: { message: 'saldo insuficiente' } } });
  await assert.rejects(run(click(j)), (e) => /^No se cargó: el panel la rechazó/.test(e.message) && e.loadNotApplied);
  const f = await JobLedger.get(j.id);
  assert.equal(f.veredicto, 'NO_APLICADA'); assert.equal(f.certeza, 'panel');
});
await caso('sesión vencida (419) → "No se cargó" + marca de sesión', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: { status: 419 } });
  await assert.rejects(run(click(j)), (e) => e.panelSessionExpired && /^No se cargó/.test(e.message));
});
await caso('Aceptar no envía nada y el saldo no cambió → "No se cargó"', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ buttonDead: true }); saldos = [5000];
  await assert.rejects(run(click(j)), (e) => e.nothingSent && /^No se cargó: el panel no recibió el pedido/.test(e.message));
  assert.equal((await JobLedger.get(j.id)).certeza, 'guardia');
});
await caso('el guardia no vio el envío pero el saldo subió → se cargó (vale el saldo)', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ buttonDead: true }); saldos = [6000];
  const r = await run(click(j));
  assert.equal(r.success, true); assert.equal((await JobLedger.get(j.id)).veredicto, 'OK');
});
await caso('respuesta lenta (30 s) → se espera y sale OK, sin recargar en el medio', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: { status: 200, json: okJson(), afterMs: 30000 } });
  const r = await run(click(j));
  assert.equal(r.success, true);
  assert.equal(tabsLog.filter((t) => t[0] === 'reload').length, 0);
});
await caso('sin respuesta en 45 s → queda para verificar por saldo (no se inventa un resultado)', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: null });
  await assert.rejects(run(click(j)), (e) => e.ambiguousAfterSubmit);
  assert.equal(necesitaVerificacion(await JobLedger.get(j.id)), true);
});
await caso('monto distinto al pedido → el guardia frena el envío', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: { status: 200, json: okJson() }, sentAmount: 10000 });
  await assert.rejects(run(click(j)), (e) => e.guardBlocked && /^No se cargó: la extensión frenó el envío/.test(e.message));
  assert.equal(panel.sends, 0);
});
await caso('ficha cancelada → no se toca Aceptar', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO'); await JobLedger.cancelar(j.id);
  resetPage({ respond: { status: 200, json: okJson() } });
  await assert.rejects(run(click(j)), (e) => /^No se cargó/.test(e.message));
  assert.equal(panel.sends, 0);
});
await caso('segundo clic del mismo job → negado', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: { status: 200, json: okJson() } });
  await run(click(j));
  resetPage({ respond: { status: 200, json: okJson() } });
  await assert.rejects(run(click(j)), (e) => /^No se cargó/.test(e.message));
  assert.equal(panel.sends, 0);
});

await caso('panel OK y la fila aparece arriba del historial → confirmada y fila anotada', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: { status: 200, json: okJson() }, historial: [[filaHora(vt + 600), 'nahuebot', 'juan77', '1.000,00'], [filaHora(vt - 600000), 'nahuebot', 'otro', '500,00']] });
  const r = await run(click(j));
  assert.match(r.message, /visto en el historial/);
  assert.ok((await JobLedger.get(j.id)).filaHistorial);
});
await caso('no salió nada pero figura en el historial → se cargó', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ buttonDead: true, historial: [[filaHora(vt), 'nahuebot', 'juan77', '1.000,00']] });
  const r = await run(click(j));
  assert.equal(r.success, true); assert.equal((await JobLedger.get(j.id)).certeza, 'historial');
});

console.info('Verificación (historial + saldo)');
const verificar = (j, before = 5000) => JobProcessor.verifyLoadByBalance(j, SW.state.config, before, new Error('sin respuesta'));
await caso('el saldo sube en la segunda lectura → se cargó', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO'); saldos = [5000, 6000];
  const r = await run(verificar(j));
  assert.equal(r.success, true); assert.equal((await JobLedger.get(j.id)).veredicto, 'OK');
});
await caso('saldo quieto en las 4 lecturas (~1,5 min) → "No se cargó"', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO'); saldos = [5000, 5000, 5000, 5000];
  await assert.rejects(run(verificar(j)), (e) => e.loadNotApplied && /^No se cargó: el panel no la aplicó/.test(e.message));
  assert.equal((await JobLedger.get(j.id)).veredicto, 'NO_APLICADA');
});
await caso('el saldo se movió por otro monto → error con la indicación de mirar el saldo', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO'); saldos = [4200];
  await assert.rejects(run(verificar(j)), (e) => e.uncertain && /^Error: no se pudo confirmar si se cargó\. Revisá el saldo de juan77/.test(e.message));
  assert.equal((await JobLedger.get(j.id)).veredicto, 'EN_DUDA');
});
await caso('no se puede leer el saldo → error ahora y la ficha queda abierta para seguir verificando', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO'); saldos = [];
  await assert.rejects(run(verificar(j)), (e) => e.pendingVerification);
  assert.equal(necesitaVerificacion(await JobLedger.get(j.id)), true);
});
await caso('retiro: el saldo baja el monto → se descargó', async () => {
  const j = job({ type: 'WITHDRAW_CHIPS' }); await fichaEn(j, 'ACEPTAR_TOCADO'); saldos = [4000];
  const r = await run(JobProcessor.verifyLoadByBalance(j, SW.state.config, 5000, new Error('x'), -1));
  assert.equal(r.success, true);
});

await caso('historial: la fila aparece al buscar por usuario → se cargó', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO');
  resetPage({ historial: [[filaHora(vt + 1000), 'nahuebot', 'juan77', '1.000,00']], historialSoloBuscando: true });
  saldos = [5000];
  const r = await run(verificar(j));
  assert.equal(r.success, true); assert.equal(panel.busquedas >= 1, true);
});
await caso('historial sin la fila aunque el usuario jugó (saldo movido) → "No se cargó"', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO');
  resetPage({ historial: [[filaHora(vt - 3600000), 'nahuebot', 'juan77', '1.000,00']] });
  saldos = [3100];
  await assert.rejects(run(verificar(j)), (e) => /^No se cargó: el panel no la aplicó \(no figura en el historial\)/.test(e.message));
});
await caso('descarga en el historial (importe negativo) → se descargó', async () => {
  const j = job({ type: 'WITHDRAW_CHIPS' }); await fichaEn(j, 'ACEPTAR_TOCADO');
  resetPage({ historial: [[filaHora(vt), 'nahuebot', 'juan77', '-1.000,00']] });
  const r = await run(JobProcessor.verifyLoadByBalance(j, SW.state.config, null, new Error('x'), -1));
  assert.equal(r.success, true);
});
await caso('una misma fila no confirma dos cargas iguales', async () => {
  const a = job(); await fichaEn(a, 'ACEPTAR_TOCADO');
  const b = job(); await fichaEn(b, 'ACEPTAR_TOCADO');
  resetPage({ historial: [[filaHora(vt), 'nahuebot', 'juan77', '1.000,00']] });
  const ra = await run(verificar(a));
  assert.equal(ra.success, true);
  await assert.rejects(run(verificar(b)), (e) => /^No se cargó/.test(e.message));
});
await caso('fechas del historial: "28/08/26 06:47 PM" y "12:05 AM"', async () => {
  const { parseFechaHistorial, parseImporte } = await import('../background/job-processor.js');
  const t = new Date(parseFechaHistorial('28/08/26 06:47 PM'));
  assert.equal(t.getHours(), 18); assert.equal(t.getMinutes(), 47); assert.equal(t.getFullYear(), 2026);
  assert.equal(new Date(parseFechaHistorial('01/09/26 12:05 AM')).getHours(), 0);
  assert.equal(parseImporte('-5.092,00'), -5092); assert.equal(parseImporte('1.100,00'), 1100);
});

console.info('Re-login');
await caso('sesión vencida en addCredit → re-login y se rehace UNA vez', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: { status: 419 } });
  const err = await run(click(j)).catch((e) => e);
  logueado = false;
  const tab = await run(JobProcessor._rehacerTrasRelogin({ id: 1 }, j, SW.state.config, err));
  assert.ok(tab); assert.equal(relogins, 1);
  await fichaEn(j, 'MONTO_LISTO');
  resetPage({ respond: { status: 200, json: okJson() } });
  const r = await run(click(j));
  assert.equal(r.success, true);
  // Una segunda sesión vencida ya no se rehace sola.
  const k = job(); await fichaEn(k, 'MONTO_LISTO');
  resetPage({ respond: { status: 419 } });
  const e1 = await run(click(k)).catch((e) => e);
  assert.ok(await run(JobProcessor._rehacerTrasRelogin({ id: 1 }, k, SW.state.config, e1)));
  await fichaEn(k, 'MONTO_LISTO');
  resetPage({ respond: { status: 419 } });
  const e2 = await run(click(k)).catch((e) => e);
  assert.equal(await run(JobProcessor._rehacerTrasRelogin({ id: 1 }, k, SW.state.config, e2)), null);
});
await caso('no salió nada con la sesión abierta → no se rehace (falla normal)', async () => {
  const j = job(); await fichaEn(j, 'MONTO_LISTO');
  resetPage({ buttonDead: true }); saldos = [5000];
  const err = await run(click(j)).catch((e) => e);
  assert.equal(await run(JobProcessor._rehacerTrasRelogin({ id: 1 }, j, SW.state.config, err)), null);
});

console.info('Service worker: reportes, barrido y reinicios');
await caso('backend caído → el resultado queda en la libreta y se reenvía después', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO'); await JobLedger.veredicto(j.id, 'OK');
  backendCaido = true;
  assert.equal(await run(SW.reportarFicha(j.id, { success: true, outcome: 'APPLIED' })), false);
  assert.equal((await JobLedger.get(j.id)).etapa, 'VEREDICTO');
  backendCaido = false;
  await run(SW.procesarLibreta({ forzar: true }));
  assert.equal(reportes.length, 1); assert.equal((await JobLedger.get(j.id)).etapa, 'CERRADA');
});
await caso('reinicio con Aceptar tocado y sin veredicto → verifica por saldo y reporta, sin clickear', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO', { balanceBefore: 5000 });
  vt += 60000; saldos = [6000];
  resetPage({ respond: { status: 200, json: okJson() } });
  await run(SW.procesarLibreta({ forzar: true }));
  assert.equal(panel.sends, 0);
  assert.equal(reportes[0]?.payload?.outcome, 'APPLIED');
  assert.equal((await JobLedger.get(j.id)).etapa, 'CERRADA');
});
await caso('falla antes de Aceptar (p. ej. "fichas insuficientes") → se cierra y nunca se verifica', async () => {
  const j = job();
  const orig = JobProcessor.execute;
  JobProcessor.execute = async (jj) => { await JobLedger.avanzar(jj.id, 'SESION_OK'); throw new Error('Fichas insuficientes en el panel'); };
  await run(SW.handleNewJob(j));
  JobProcessor.execute = orig;
  const f = await JobLedger.get(j.id);
  assert.equal(f.etapa, 'CERRADA'); assert.equal(necesitaVerificacion(f), false);
  reportes = [];
  vt += 5 * 60000;
  await run(SW.procesarLibreta({ forzar: true }));
  assert.equal(reportes.length, 0);
});
await caso('reinicio antes de tocar Aceptar → "No se cargó: la extensión se cortó…"', async () => {
  const j = job(); await fichaEn(j, 'USUARIO_ENCONTRADO');
  vt += 4 * 60000;
  await run(SW.procesarLibreta({ forzar: true }));
  assert.match(reportes[0]?.payload?.error || '', /^No se cargó: la extensión se cortó/);
  assert.equal(reportes[0].payload.outcome, 'NOT_APPLIED');
});
await caso('job re-despachado que ya tenía resultado → se reporta sin operar', async () => {
  const j = job(); await fichaEn(j, 'ACEPTAR_TOCADO'); await JobLedger.veredicto(j.id, 'OK');
  let ejecutadas = 0; const orig = JobProcessor.execute; JobProcessor.execute = async () => { ejecutadas++; return { success: true }; };
  await run(SW.handleNewJob(j));
  JobProcessor.execute = orig;
  assert.equal(ejecutadas, 0); assert.equal(reportes[0]?.payload?.success, true);
});
await caso('carga normal de punta a punta → reporte APPLIED y ficha cerrada', async () => {
  const j = job();
  const orig = JobProcessor.execute;
  JobProcessor.execute = async (jj) => { await JobLedger.avanzar(jj.id, 'MONTO_LISTO'); resetPage({ respond: { status: 200, json: okJson() } }); return click(jj); };
  await run(SW.handleNewJob(j));
  JobProcessor.execute = orig;
  assert.equal(reportes[0]?.payload?.outcome, 'APPLIED'); assert.equal(reportes[0].payload.panelTransaction, '991');
  assert.equal((await JobLedger.get(j.id)).etapa, 'CERRADA');
});
await caso('se cuelga con Aceptar tocado → error claro al operador y la ficha sigue abierta para verificar', async () => {
  const j = job();
  const orig = JobProcessor.execute;
  JobProcessor.execute = async (jj) => { await fichaEn(jj, 'ACEPTAR_TOCADO'); return new Promise(() => {}); };
  await run(SW.handleNewJob(j));
  JobProcessor.execute = orig;
  assert.match(reportes[0]?.payload?.error || '', /^Error: no se pudo confirmar si se cargó\. Revisá el saldo de juan77/);
  assert.equal(reportes[0].payload.outcome, 'UNCERTAIN');
  const f = await JobLedger.get(j.id);
  assert.equal(f.cancelada, true, JSON.stringify(f)); assert.equal(necesitaVerificacion(f), true, JSON.stringify({etapa:f.etapa, v:f.veredicto, h:f.historial}));
});
await caso('se cuelga antes de tocar Aceptar → a los 120 s "No se cargó"', async () => {
  const j = job();
  const orig = JobProcessor.execute;
  JobProcessor.execute = async (jj) => { await JobLedger.avanzar(jj.id, 'SESION_OK'); return new Promise(() => {}); };
  const t0 = vt;
  await run(SW.handleNewJob(j));
  JobProcessor.execute = orig;
  assert.equal(reportes[0]?.payload?.outcome, 'NOT_APPLIED');
  assert.ok(vt - t0 >= 120000);
});

await caso('falla pasajera antes de Aceptar (login) → se rehace sola una vez y carga', async () => {
  const j = job(); let intentos = 0;
  const orig = JobProcessor.execute;
  JobProcessor.execute = async (jj) => {
    intentos++;
    await JobLedger.avanzar(jj.id, 'SESION_OK');
    if (intentos === 1) throw new Error('Login failed: Failed at verify_login');
    await JobLedger.avanzar(jj.id, 'MONTO_LISTO'); resetPage({ respond: { status: 200, json: okJson() } }); return click(jj);
  };
  await run(SW.handleNewJob(j));
  JobProcessor.execute = orig;
  assert.equal(intentos, 2); assert.equal(reportes.length, 1); assert.equal(reportes[0].payload.outcome, 'APPLIED');
});
await caso('falla real antes de Aceptar (fichas insuficientes) → no se rehace', async () => {
  const j = job(); let intentos = 0;
  const orig = JobProcessor.execute;
  JobProcessor.execute = async () => { intentos++; throw new Error('Fichas insuficientes en el panel'); };
  await run(SW.handleNewJob(j));
  JobProcessor.execute = orig;
  assert.equal(intentos, 1); assert.equal(reportes[0].payload.outcome, 'NOT_APPLIED');
});
await caso('falla pasajera dos veces → se reporta "no se cargó" (no insiste más)', async () => {
  const j = job(); let intentos = 0;
  const orig = JobProcessor.execute;
  JobProcessor.execute = async (jj) => { intentos++; await JobLedger.avanzar(jj.id, 'SESION_OK'); throw new Error('Frame with ID 0 was removed.'); };
  await run(SW.handleNewJob(j));
  JobProcessor.execute = orig;
  assert.equal(intentos, 2); assert.equal(reportes[0].payload.success, false);
});
await caso('llega una carga mientras la extensión se está logueando → espera y después carga', async () => {
  const j = job(); let arranco = null;
  let soltar; JobProcessor._loginInFlight = new Promise((r) => { soltar = r; });
  setTimeout(() => { JobProcessor._loginInFlight = null; soltar(); }, 20000);
  const t0 = vt;
  const orig = JobProcessor.execute;
  JobProcessor.execute = async (jj) => { arranco = vt; await JobLedger.avanzar(jj.id, 'MONTO_LISTO'); resetPage({ respond: { status: 200, json: okJson() } }); return click(jj); };
  await run(SW.handleNewJob(j));
  JobProcessor.execute = orig;
  assert.ok(arranco - t0 >= 20000, `arrancó a los ${arranco - t0} ms`);
  assert.equal(reportes[0].payload.outcome, 'APPLIED');
});

console.info('Pedidos repetidos del operador');
await caso('la carga anterior igual entró → la nueva no se hace ("ya estaba hecha")', async () => {
  const vieja = job({ id: 'vieja-1' }); await fichaEn(vieja, 'ACEPTAR_TOCADO', { balanceBefore: 5000 });
  saldos = [6000];
  await assert.rejects(run(SW.chequearDuplicadoEnDuda(job())), (e) => /^No se cargó de nuevo: ya estaba hecha/.test(e.message));
});
await caso('la anterior igual no entró → la nueva sigue normal', async () => {
  const vieja = job({ id: 'vieja-2' }); await fichaEn(vieja, 'ACEPTAR_TOCADO', { balanceBefore: 5000 });
  saldos = [5000, 5000, 5000, 5000];
  await run(SW.chequearDuplicadoEnDuda(job()));
  assert.equal((await JobLedger.get('vieja-2')).veredicto, 'NO_APLICADA');
});
await caso('la anterior quedó sin confirmar → frena una vez; si el operador insiste, se hace', async () => {
  const vieja = job({ id: 'vieja-3' }); await fichaEn(vieja, 'ACEPTAR_TOCADO', { balanceBefore: 5000 });
  saldos = [4200];
  await assert.rejects(run(SW.chequearDuplicadoEnDuda(job())), (e) => /^Error: no se pudo confirmar una carga igual/.test(e.message));
  await run(SW.chequearDuplicadoEnDuda(job()));
});
await caso('otra carga igual ya confirmada OK no frena (pueden ser dos cargas reales)', async () => {
  const vieja = job({ id: 'vieja-4' }); await fichaEn(vieja, 'ACEPTAR_TOCADO'); await JobLedger.veredicto('vieja-4', 'OK');
  await run(SW.chequearDuplicadoEnDuda(job()));
});

console.info(`\n${pasaron} pasaron, ${fallos.length} fallaron`);
process.exit(fallos.length ? 1 : 0);
