// Libreta de cargas: una ficha por job en chrome.storage.local.
//
// Lo que la extensión sabe de cada operación vive acá y no en memoria: si Chrome
// se cierra, el service worker se reinicia o el panel pide re-login en el medio,
// la ficha dice en qué etapa quedó, qué respondió el panel y si el backend ya se
// enteró. Todas las decisiones de "¿la hago, la verifico o la reporto?" salen de
// la ficha.
//
// Regla de oro: una ficha que llegó a ACEPTAR_TOCADO nunca vuelve a tocar Aceptar.
// Desde ahí sólo se puede leer el saldo del usuario o reportar. La única excepción
// es `reabrirPorSesion`: el panel rechazó por sesión vencida (o no salió ningún
// envío), así que es seguro que no se cargó, y se permite rehacerla UNA vez.

const KEY = 'jobLedger';
const LEGACY_FAILED_REPORTS_KEY = 'failedReports';

export const ETAPAS = [
  'RECIBIDA',
  'SESION_OK',
  'USUARIO_ENCONTRADO',
  'MONTO_LISTO',
  'ACEPTAR_TOCADO',
  'VEREDICTO',
  'CERRADA',
];

// Operaciones que mueven fichas: son las únicas donde importa ACEPTAR_TOCADO.
export const TIPOS_CON_PLATA = ['LOAD_CREDITS', 'WITHDRAW_CHIPS'];

const CERRADAS_DIAS = 7;
const TOPE_FICHAS = 1500;
const VENTANA_DUPLICADOS_MS = 24 * 60 * 60 * 1000;
// Sin poder leer el saldo durante este tiempo desde que se tocó Aceptar → en duda, al operador.
export const VERIFICACION_MAX_MS = 30 * 60 * 1000;

const idx = (etapa) => ETAPAS.indexOf(etapa);
const now = () => new Date().toISOString();

export function tipoDe(job) {
  return job?.type || 'LOAD_CREDITS';
}

export function conPlata(fichaOJob) {
  return TIPOS_CON_PLATA.includes(fichaOJob?.type || 'LOAD_CREDITS');
}

/** true si la ficha ya pasó por Aceptar (o más). */
export function pasoAceptar(ficha) {
  // Por la marca del clic y no por la etapa: una ficha que falló ANTES de Aceptar
  // también llega a VEREDICTO/CERRADA, y eso no significa que se haya clickeado.
  return !!ficha?.aceptarAt;
}

/** Tocó Aceptar y todavía no se sabe si entró: hay que verificar por saldo. */
export function necesitaVerificacion(ficha) {
  return !!ficha && conPlata(ficha) && pasoAceptar(ficha) && ficha.etapa !== 'CERRADA' && !ficha.veredicto;
}

class JobLedgerImpl {
  constructor() {
    this._cola = Promise.resolve();
    this._migrado = false;
  }

  // Toda lectura-modificación-escritura pasa en fila: dos escrituras simultáneas
  // (el job en curso y el barrido de pendientes) no se pisan.
  _enFila(fn) {
    const run = this._cola.then(fn, fn);
    this._cola = run.catch(() => {});
    return run;
  }

  async _leer() {
    const stored = await chrome.storage.local.get([KEY]);
    return stored[KEY] || {};
  }

  async _guardar(fichas) {
    await chrome.storage.local.set({ [KEY]: fichas });
  }

  _historial(ficha, etapa, nota) {
    ficha.historial = [...(ficha.historial || []), { etapa, at: now(), ...(nota ? { nota } : {}) }].slice(-30);
    ficha.actualizada = now();
  }

  async get(jobId) {
    if (!jobId) return null;
    const fichas = await this._enFila(() => this._leer());
    return fichas[jobId] || null;
  }

  async todas() {
    return Object.values(await this._enFila(() => this._leer()));
  }

  /**
   * Abre la ficha de un job (o devuelve la que ya existe).
   * `existia` = true si el job ya había pasado por esta extensión.
   */
  async abrir(job) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const previa = fichas[job.id];
      if (previa) return { ficha: previa, existia: true };
      const amount = Number(job.amount);
      const ficha = {
        jobId: job.id,
        type: tipoDe(job),
        username: job.targetUsername || null,
        amount: Number.isFinite(amount) ? amount : null,
        etapa: 'RECIBIDA',
        historial: [],
        balanceBefore: null,
        userKingboxId: null,
        respuestaPanel: null,
        veredicto: null,
        motivo: null,
        resultado: null,
        reporte: { confirmado: false, intentos: 0, ultimoIntento: null, confirmadoAt: null },
        reintentoPorSesion: 0,
        cancelada: false,
        avisoDuplicado: false,
        creada: now(),
        actualizada: now(),
        aceptarAt: null,
      };
      this._historial(ficha, 'RECIBIDA');
      fichas[job.id] = ficha;
      await this._guardar(fichas);
      return { ficha, existia: false };
    });
  }

  /**
   * Avanza la etapa (nunca retrocede) y guarda datos. Devuelve la ficha.
   * ACEPTAR_TOCADO se niega si la ficha fue cancelada o ya tiene veredicto:
   * así un flujo que quedó vivo después de un timeout no puede clickear.
   */
  async avanzar(jobId, etapa, datos = {}) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const ficha = fichas[jobId];
      if (!ficha) throw new Error(`Libreta: no hay ficha para el job ${jobId}`);
      if (etapa === 'ACEPTAR_TOCADO') {
        if (ficha.cancelada) throw Object.assign(new Error('La carga fue cancelada (tiempo agotado): NO se toca Aceptar'), { loadNotApplied: true });
        if (ficha.veredicto) throw Object.assign(new Error(`La carga ya tiene resultado (${ficha.veredicto}): NO se toca Aceptar de nuevo`), { loadNotApplied: true });
        if (pasoAceptar(ficha)) throw Object.assign(new Error('Aceptar ya se tocó para esta carga: NO se toca de nuevo'), { loadNotApplied: true });
      }
      Object.assign(ficha, datos);
      if (idx(etapa) > idx(ficha.etapa)) {
        ficha.etapa = etapa;
        if (etapa === 'ACEPTAR_TOCADO') ficha.aceptarAt = now();
      }
      this._historial(ficha, etapa);
      await this._guardar(fichas);
      return ficha;
    });
  }

  /**
   * Fija el veredicto apenas se conoce, antes de recargar o reportar.
   * veredicto: 'OK' | 'NO_APLICADA' | 'EN_DUDA'.
   * `certeza` en NO_APLICADA: 'panel' (el panel la rechazó), 'guardia' (no salió
   * ningún envío) o 'saldo' (el saldo no se movió).
   */
  async veredicto(jobId, veredicto, datos = {}) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const ficha = fichas[jobId];
      if (!ficha) return null;
      // Un OK no se pisa nunca: si el panel dijo que entró, entró.
      if (ficha.veredicto === 'OK' && veredicto !== 'OK') return ficha;
      Object.assign(ficha, datos, { veredicto });
      if (idx(ficha.etapa) < idx('VEREDICTO')) ficha.etapa = 'VEREDICTO';
      this._historial(ficha, 'VEREDICTO', `${veredicto}${datos.motivo ? `: ${datos.motivo}` : ''}`);
      await this._guardar(fichas);
      return ficha;
    });
  }

  /** Guarda el resultado que se le va a mandar al backend (antes de mandarlo). */
  async resultado(jobId, payload) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const ficha = fichas[jobId];
      if (!ficha) return null;
      ficha.resultado = payload;
      ficha.reporte = { ...(ficha.reporte || {}), confirmado: false };
      // Un resultado provisorio (Aceptar tocado, sin veredicto) no mueve la etapa:
      // la ficha tiene que seguir marcada para verificar por saldo.
      if (idx(ficha.etapa) < idx('VEREDICTO') && (ficha.veredicto || !pasoAceptar(ficha))) ficha.etapa = 'VEREDICTO';
      this._historial(ficha, 'VEREDICTO', payload?.success ? 'resultado: éxito' : `resultado: falla${payload?.error ? ` (${String(payload.error).slice(0, 120)})` : ''}`);
      await this._guardar(fichas);
      return ficha;
    });
  }

  async intentoDeReporte(jobId) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const ficha = fichas[jobId];
      if (!ficha) return;
      ficha.reporte = { ...(ficha.reporte || {}), intentos: (ficha.reporte?.intentos || 0) + 1, ultimoIntento: now() };
      await this._guardar(fichas);
    });
  }

  /**
   * El backend confirmó el reporte. La ficha se cierra salvo que todavía haya que
   * verificar por saldo (timeout con Aceptar tocado): ahí queda abierta para que
   * el barrido la resuelva y mande el resultado real.
   */
  async reporteConfirmado(jobId) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const ficha = fichas[jobId];
      if (!ficha) return;
      ficha.reporte = { ...(ficha.reporte || {}), confirmado: true, confirmadoAt: now() };
      ficha.resultado = null;
      if (!necesitaVerificacion(ficha)) {
        ficha.etapa = 'CERRADA';
        this._historial(ficha, 'CERRADA');
      } else {
        this._historial(ficha, ficha.etapa, 'reporte provisorio confirmado; falta verificar por saldo');
      }
      await this._guardar(fichas);
    });
  }

  /** Marca la ficha como cancelada (timeout): desde ahora no puede tocar Aceptar. */
  async cancelar(jobId, nota) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const ficha = fichas[jobId];
      if (!ficha) return null;
      ficha.cancelada = true;
      this._historial(ficha, ficha.etapa, nota || 'cancelada');
      await this._guardar(fichas);
      return ficha;
    });
  }

  /**
   * Única excepción a la regla de oro. Permite rehacer la carga una sola vez
   * cuando es SEGURO que no se aplicó (el panel la rechazó por sesión vencida o el
   * guardia no vio salir ningún envío). Devuelve true si se reabrió.
   */
  async reabrirPorSesion(jobId) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const ficha = fichas[jobId];
      if (!ficha || ficha.cancelada) return false;
      if (ficha.reintentoPorSesion >= 1) return false;
      if (ficha.veredicto !== 'NO_APLICADA' || !['panel', 'guardia'].includes(ficha.certeza)) return false;
      ficha.reintentoPorSesion = 1;
      ficha.veredicto = null;
      ficha.certeza = null;
      ficha.motivo = null;
      ficha.respuestaPanel = null;
      ficha.etapa = 'RECIBIDA';
      ficha.aceptarAt = null;
      this._historial(ficha, 'RECIBIDA', 'reabierta tras re-login (la primera NO se aplicó)');
      await this._guardar(fichas);
      return true;
    });
  }

  /**
   * Falla pasajera ANTES de tocar Aceptar (login, la página navegó, el panel tardó):
   * no se envió nada, así que se puede rehacer. Una sola vez por job.
   */
  async reintentarAntesDeAceptar(jobId, motivo) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const ficha = fichas[jobId];
      if (!ficha || ficha.cancelada || ficha.aceptarAt) return false;
      if ((ficha.reintentoTransitorio || 0) >= 1) return false;
      ficha.reintentoTransitorio = 1;
      ficha.veredicto = null;
      ficha.motivo = null;
      ficha.resultado = null;
      ficha.etapa = 'RECIBIDA';
      this._historial(ficha, 'RECIBIDA', `reintento (no se había enviado nada): ${String(motivo || '').slice(0, 120)}`);
      await this._guardar(fichas);
      return true;
    });
  }

  async marcarAvisoDuplicado(jobId) {
    return this._enFila(async () => {
      const fichas = await this._leer();
      if (!fichas[jobId]) return;
      fichas[jobId].avisoDuplicado = true;
      this._historial(fichas[jobId], fichas[jobId].etapa, 'se frenó un pedido igual por esta carga en duda');
      await this._guardar(fichas);
    });
  }

  /**
   * Fichas de OTRO job con el mismo usuario, tipo y monto, de las últimas 24 h, que
   * pasaron por Aceptar y no se sabe si entraron (sin veredicto o EN_DUDA).
   */
  async dudasPara(job) {
    const fichas = await this.todas();
    const desde = Date.now() - VENTANA_DUPLICADOS_MS;
    const amount = Number(job.amount);
    return fichas.filter((f) => f.jobId !== job.id
      && f.type === tipoDe(job)
      && f.username === job.targetUsername
      && Number(f.amount) === amount
      && pasoAceptar(f)
      && (!f.veredicto || f.veredicto === 'EN_DUDA')
      && Date.parse(f.aceptarAt || f.creada) >= desde);
  }

  /** Fichas que todavía piden algo: reportar, verificar o cerrar. */
  async abiertas() {
    const fichas = await this.todas();
    return fichas.filter((f) => f.etapa !== 'CERRADA')
      .sort((a, b) => Date.parse(a.creada) - Date.parse(b.creada));
  }

  async resumen() {
    const abiertas = await this.abiertas();
    return {
      abiertas: abiertas.length,
      sinConfirmar: abiertas.filter((f) => f.resultado && !f.reporte?.confirmado).length,
      porVerificar: abiertas.filter(necesitaVerificacion).length,
      fichas: abiertas.slice(-20).map((f) => ({
        jobId: f.jobId, type: f.type, username: f.username, amount: f.amount,
        etapa: f.etapa, veredicto: f.veredicto, motivo: f.motivo, actualizada: f.actualizada,
      })),
    };
  }

  /**
   * Pasa los `failedReports` viejos (1.0.7 y anteriores) a la libreta, para que se
   * reenvíen con el mismo mecanismo. Se hace una sola vez.
   */
  async migrarReportesViejos() {
    if (this._migrado) return 0;
    return this._enFila(async () => {
      const stored = await chrome.storage.local.get([LEGACY_FAILED_REPORTS_KEY]);
      const viejos = stored[LEGACY_FAILED_REPORTS_KEY] || [];
      this._migrado = true;
      if (viejos.length === 0) return 0;
      const fichas = await this._leer();
      for (const r of viejos) {
        if (!r?.jobId || fichas[r.jobId]) continue;
        fichas[r.jobId] = {
          jobId: r.jobId, type: 'LOAD_CREDITS', username: null, amount: null,
          etapa: 'VEREDICTO', historial: [{ etapa: 'VEREDICTO', at: now(), nota: 'migrada de failedReports' }],
          veredicto: r.result?.success ? 'OK' : null, motivo: null, resultado: r.result,
          reporte: { confirmado: false, intentos: 0, ultimoIntento: null, confirmadoAt: null },
          reintentoPorSesion: 0, cancelada: false, avisoDuplicado: false,
          creada: r.failedAt || now(), actualizada: now(), aceptarAt: null,
        };
      }
      await this._guardar(fichas);
      await chrome.storage.local.remove(LEGACY_FAILED_REPORTS_KEY);
      return viejos.length;
    });
  }

  /** Borra fichas cerradas viejas. Las abiertas no se borran nunca solas. */
  async limpiar() {
    return this._enFila(async () => {
      const fichas = await this._leer();
      const limite = Date.now() - CERRADAS_DIAS * 24 * 60 * 60 * 1000;
      let cerradas = Object.values(fichas).filter((f) => f.etapa === 'CERRADA');
      for (const f of cerradas) {
        if (Date.parse(f.actualizada) < limite) delete fichas[f.jobId];
      }
      cerradas = Object.values(fichas).filter((f) => f.etapa === 'CERRADA')
        .sort((a, b) => Date.parse(a.actualizada) - Date.parse(b.actualizada));
      const sobran = Object.keys(fichas).length - TOPE_FICHAS;
      for (let i = 0; i < sobran && i < cerradas.length; i++) delete fichas[cerradas[i].jobId];
      await this._guardar(fichas);
    });
  }
}

export const JobLedger = new JobLedgerImpl();
