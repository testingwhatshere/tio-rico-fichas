/* Tío Rico · Panel del dueño — lógica del dashboard.
 *
 * Estructura: leer estado de la URL → pedir /api/summary → pintar por secciones.
 * Cada sección se pinta sola y tolera que su dato venga en null (el backend
 * devuelve las secciones que fallaron por separado en vez de tumbar todo).
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (sel, raiz = document) => raiz.querySelector(sel);

  // ---------- formato ----------
  const fmtMoney = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const fmtNum = new Intl.NumberFormat('es-AR');
  const money = (v) => fmtMoney.format(Number(v) || 0);
  const numero = (v) => fmtNum.format(Number(v) || 0);
  const pct = (v, dec = 0) => (v == null ? '—' : `${(v * 100).toFixed(dec)}%`);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Segundos → "3 min", "2 h 10 min", "4 días". Nadie quiere leer 8340 s. */
  function duracion(seg) {
    if (seg == null) return '—';
    const s = Math.round(seg);
    if (s < 60) return `${s} seg`;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    if (s < 86400) {
      const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
      return m ? `${h} h ${m} min` : `${h} h`;
    }
    const d = Math.floor(s / 86400), h = Math.round((s % 86400) / 3600);
    return h ? `${d} d ${h} h` : `${d} días`;
  }

  function hace(iso) {
    if (!iso) return 'nunca';
    const min = (Date.now() - new Date(iso).getTime()) / 60000;
    if (min < 1) return 'recién';
    if (min < 60) return `hace ${Math.round(min)} min`;
    if (min < 1440) return `hace ${Math.round(min / 60)} h`;
    return `hace ${Math.round(min / 1440)} días`;
  }

  const fechaCorta = (iso) => (iso
    ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
    : '—');

  const escapar = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- colores (los mismos tokens que el CSS) ----------
  const css = getComputedStyle(document.documentElement);
  const C = {
    s1: css.getPropertyValue('--s1').trim() || '#bd8a1e',
    s2: css.getPropertyValue('--s2').trim() || '#cf4a44',
    s3: css.getPropertyValue('--s3').trim() || '#2aa87c',
    s4: css.getPropertyValue('--s4').trim() || '#5b8ede',
    linea: css.getPropertyValue('--line').trim() || '#24352b',
    texto: css.getPropertyValue('--muted').trim() || '#8ea396',
    superficie: css.getPropertyValue('--card').trim() || '#131d17',
  };
  const alfa = (hex, a) => {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(v, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  // ---------- estado ----------
  const estado = {
    rango: 'hoy', panel: '', desde: '', hasta: '', tab: 'resumen', datos: null,
  };
  let charts = {};
  let timerRefresco = null;

  // ---------- Chart.js: defaults ----------
  Chart.defaults.font.family = "'Archivo', system-ui, sans-serif";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = C.texto;
  Chart.defaults.borderColor = alfa(C.linea, 0.75);
  Chart.defaults.animation = reduceMotion ? false : { duration: 500 };
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.responsive = true;

  const tooltipBase = {
    backgroundColor: '#182620',
    borderColor: C.linea,
    borderWidth: 1,
    titleColor: '#ede7d8',
    bodyColor: '#ede7d8',
    padding: 10,
    cornerRadius: 8,
    displayColors: true,
    boxPadding: 4,
  };
  const leyenda = { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14 } };
  const ejeY = (fmt) => ({ beginAtZero: true, border: { display: false }, ticks: { callback: fmt } });
  const ejeXlimpio = { grid: { display: false }, border: { display: false } };

  function upsert(clave, canvasId, config) {
    const nodo = $(canvasId);
    if (!nodo) return;
    if (charts[clave]) {
      charts[clave].data = config.data;
      charts[clave].options = config.options;
      charts[clave].update();
    } else {
      charts[clave] = new Chart(nodo, config);
    }
  }

  // ---------- helpers de render ----------
  /**
   * Comparación contra el período anterior.
   *
   * Arriba de +300% el porcentaje deja de decir nada: cuando el período previo
   * tenía casi cero (la plataforma recién arrancaba, o hubo una migración), sale
   * un "▲75999%" que impresiona y no informa. En esos casos se muestra contra
   * qué se está comparando, que es lo que realmente hace falta para entenderlo.
   */
  const TOPE_PCT = 3;

  function deltaHTML(d, opciones = {}) {
    if (!d || d.pct == null) return '';
    const ref = opciones.ref || 'el período anterior';
    const sube = d.cambio > 0;
    const bueno = opciones.invertir ? !sube : sube;

    if (Math.abs(d.pct) < 0.005) return `<span class="delta-igual">sin cambios vs ${escapar(ref)}</span>`;

    const clase = bueno ? 'delta-sube' : 'delta-baja';
    const flecha = sube ? '▲' : '▼';

    if (Math.abs(d.pct) > TOPE_PCT) {
      const previo = opciones.formato ? opciones.formato(d.previo) : numero(d.previo);
      return `<span class="${clase}">${flecha}</span>
              <span class="delta-igual">contra ${previo} en ${escapar(ref)}</span>`;
    }
    return `<span class="${clase}">${flecha} ${Math.abs(d.pct * 100).toFixed(0)}%</span>
            <span class="delta-igual">vs ${escapar(ref)}</span>`;
  }

  function kpi(dt, dd, nota, clase = '') {
    return `<div class="kpi"><dt>${escapar(dt)}</dt><dd class="${clase}">${dd}</dd>${
      nota ? `<span class="nota">${nota}</span>` : ''}</div>`;
  }

  const vacio = (msg) => `<p class="vacio">${escapar(msg)}</p>`;
  const rota = (nombre) => `<p class="seccion-rota">No se pudo calcular ${escapar(nombre)}. El resto del panel sigue siendo válido.</p>`;

  // ============================================================
  //  RENDER
  // ============================================================
  function render(d) {
    estado.datos = d;
    const r = d.rango;

    pintarBanda(d);
    pintarAlertas(d.alertas);
    pintarLedger(d);
    pintarKpis(d);
    pintarSerie(d);
    pintarEmbudo(d);
    pintarEstadoActual(d);
    pintarMensual(d);
    pintarHeatmap(d);
    pintarDistribucion(d);
    pintarJugadoresSerie(d);
    pintarJugadores(d);
    pintarOperacion(d);
    pintarCanales(d);

    // subtítulos que dependen del período elegido
    const corto = r.corto;
    [['serie-sub', etiquetaBucket(r)], ['embudo-sub', corto], ['heat-sub', corto],
     ['distrib-sub', corto], ['comp-sub', corto], ['frec-sub', corto], ['top-sub', corto],
     ['tiempos-sub', corto], ['bot-sub', corto], ['errores-sub', corto],
     ['premios-sub', corto], ['valid-sub', corto], ['panel-sub', corto], ['wallet-sub', corto]]
      .forEach(([id, txt]) => { const n = $(id); if (n) n.textContent = txt; });

    const hora = new Date(d.generadoEn).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    $('footer-note').textContent = `Actualizado a las ${hora} · se renueva solo cada minuto.`;
    if (d.totales) {
      $('footer-totals').textContent =
        `Histórico: ${money(d.totales.entradas)} en ${numero(d.totales.cargas)} cargas · ` +
        `${money(d.totales.premios)} pagados en premios · ${numero(d.totales.jugadores)} jugadores`;
    }
  }

  const etiquetaBucket = (r) => ({
    hour: 'por hora', day: 'por día', week: 'por semana', month: 'por mes',
  }[r.bucket] || '');

  // ---------- banda de estado ----------
  function pintarBanda(d) {
    const b = $('banda-estado');
    const problemas = [];
    // Datos vencidos mientras se recalculan es lo normal y no se avisa: solo
    // importa cuando la base efectivamente no contestó.
    if (d.fallo) {
      problemas.push({ clase: 'viejo', txt: `La base no respondió al último intento. Estos números son de ${hace(new Date(Date.now() - (d.cacheEdadMs || 0)).toISOString())}.` });
    }
    if (d.errores) {
      problemas.push({ clase: 'error', txt: `Algunas secciones no se pudieron calcular: ${Object.keys(d.errores).join(', ')}.` });
    }
    if (!problemas.length) { b.hidden = true; return; }
    b.hidden = false;
    b.className = `banda ${problemas[0].clase}`;
    b.textContent = problemas.map((p) => p.txt).join(' ');
  }

  // ---------- alertas ----------
  const ICONO = { critico: '🔴', aviso: '🟡', info: '⚪' };
  const unaAlerta = (a) => `
      <div class="alerta ${escapar(a.nivel)}">
        <span class="alerta-icono" aria-hidden="true">${ICONO[a.nivel] || '•'}</span>
        <div class="alerta-texto">
          <strong>${escapar(a.titulo)}</strong>
          <span class="detalle">${escapar(a.detalle)}</span>
          ${a.accion ? `<span class="accion">→ ${escapar(a.accion)}</span>` : ''}
        </div>
      </div>`;

  /**
   * Se muestran sueltas las críticas (y hasta 3 en total); el resto queda
   * plegado. Con todas abiertas, los números del negocio caían abajo del
   * pliegue y había que scrollear para ver la plata.
   */
  function pintarAlertas(alertas) {
    const c = $('alertas');
    if (!alertas || !alertas.length) { c.innerHTML = ''; return; }

    const criticas = alertas.filter((a) => a.nivel === 'critico');
    const corte = Math.max(criticas.length, Math.min(3, alertas.length));
    const visibles = alertas.slice(0, corte);
    const ocultas = alertas.slice(corte);

    c.innerHTML = visibles.map(unaAlerta).join('') + (ocultas.length ? `
      <details class="alertas-mas">
        <summary>y ${ocultas.length} ${ocultas.length === 1 ? 'aviso más' : 'avisos más'} ▾</summary>
        <div class="lista">${ocultas.map(unaAlerta).join('')}</div>
      </details>` : '');
  }

  // ---------- asiento principal ----------
  function countUp(nodo, destino) {
    if (reduceMotion || !destino) { nodo.textContent = money(destino); return; }
    const dur = 600, ini = performance.now();
    const paso = (ahora) => {
      const p = Math.min((ahora - ini) / dur, 1);
      nodo.textContent = money(destino * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  function pintarLedger(d) {
    const p = d.periodo;
    const ref = d.rango.prevLabel;
    $('ledger-label').textContent = `Entradas · ${d.rango.label.toLowerCase()}`;

    if (!p) { $('entradas-monto').textContent = '—'; return; }

    countUp($('entradas-monto'), p.cargas.monto);
    $('ledger-sub').innerHTML = p.cargas.count > 0
      ? `en <strong>${numero(p.cargas.count)} ${p.cargas.count === 1 ? 'carga' : 'cargas'}</strong> · ` +
        `típica de <strong>${money(p.cargas.mediana)}</strong> · la más grande, ${money(p.cargas.maximo)}`
      : 'Todavía no hubo cargas en este período.';
    $('entradas-delta').innerHTML = deltaHTML(d.deltas?.entradas, { ref, formato: money });

    $('premios-pagados-monto').textContent = p.premiosPagados.monto > 0 ? `− ${money(p.premiosPagados.monto)}` : money(0);
    $('premios-delta').innerHTML = `${numero(p.premiosPagados.count)} premios · ` + deltaHTML(d.deltas?.premios, { ref, invertir: true, formato: money });

    const res = $('resultado-monto');
    res.textContent = money(p.resultado);
    res.className = p.resultado >= 0 ? 'win' : 'loss';
    $('resultado-delta').innerHTML = deltaHTML(d.deltas?.resultado, { ref, formato: money });

    $('payout-ratio').textContent = pct(p.payoutRatio);
    $('payout-nota').textContent = p.payoutRatio == null
      ? 'sin cargas para comparar'
      : p.payoutRatio > 0.9 ? 'muy alto — se está yendo casi todo'
      : p.payoutRatio > 0.7 ? 'alto, pero dentro de lo esperable'
      : 'margen sano';
  }

  function pintarKpis(d) {
    const p = d.periodo;
    const ref = d.rango.prevLabel;
    if (!p) { $('kpis').innerHTML = rota('los indicadores'); return; }
    $('kpis').innerHTML = [
      kpi(d.rango.activos, numero(p.jugadoresActivos), deltaHTML(d.deltas?.jugadoresActivos, { ref })),
      kpi('Jugadores nuevos', numero(p.jugadoresNuevos), deltaHTML(d.deltas?.jugadoresNuevos, { ref })),
      kpi('Carga promedio', money(p.cargas.promedio), `mediana ${money(p.cargas.mediana)}`),
      kpi('Cargas por jugador', p.cargasPorJugador.toFixed(1), `${money(p.montoPorJugador)} cada uno`),
      kpi('Pedidos iniciados', numero(p.solicitudes.count), `${pct(p.solicitudes.tasaExito)} terminó en fichas`),
      kpi('Premios pedidos', numero(p.premiosPedidos.count), `por ${money(p.premiosPedidos.monto)}`),
    ].join('');
  }

  // ---------- serie temporal ----------
  function etiquetasSerie(serie, bucket) {
    return serie.map((x) => {
      const f = new Date(x.bucket);
      if (bucket === 'hour') return `${String(f.getHours()).padStart(2, '0')}:00`;
      if (bucket === 'month') return f.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
      return `${f.getDate()}/${f.getMonth() + 1}`;
    });
  }

  function pintarSerie(d) {
    if (!d.serie) return;
    const labels = etiquetasSerie(d.serie, d.rango.bucket);
    upsert('serie', 'chart-serie', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar', label: 'Entró', data: d.serie.map((x) => x.entradas),
            backgroundColor: alfa(C.s1, 0.85), hoverBackgroundColor: C.s1,
            borderRadius: 4, maxBarThickness: 26, order: 2,
          },
          {
            type: 'line', label: 'Premios pagados', data: d.serie.map((x) => x.premios),
            borderColor: C.s2, backgroundColor: C.s2, borderWidth: 2,
            pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2,
            pointHoverBorderColor: C.superficie, tension: 0.3, order: 1,
          },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { ...leyenda, reverse: true },
          tooltip: {
            ...tooltipBase,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${money(ctx.parsed.y)}`,
              afterBody: (items) => {
                const p = d.serie[items[0].dataIndex];
                const partes = [];
                if (p.cargas) partes.push(`${numero(p.cargas)} cargas · ${numero(p.jugadores)} jugadores`);
                partes.push(`Resultado: ${money(p.resultado)}`);
                return partes.join('\n');
              },
            },
          },
        },
        scales: { x: { ...ejeXlimpio, ticks: { maxTicksLimit: 12, autoSkip: true } },
                  y: ejeY((v) => '$' + fmtNum.format(v)) },
      },
    });
  }

  function pintarJugadoresSerie(d) {
    if (!d.serie) return;
    upsert('jugSerie', 'chart-jugadores-serie', {
      type: 'line',
      data: {
        labels: etiquetasSerie(d.serie, d.rango.bucket),
        datasets: [{
          label: 'Jugadores que cargaron',
          data: d.serie.map((x) => x.jugadores),
          borderColor: C.s3, backgroundColor: alfa(C.s3, 0.14), fill: true,
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.3,
        }],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipBase, callbacks: { label: (c) => ` ${numero(c.parsed.y)} jugadores` } },
        },
        scales: { x: { ...ejeXlimpio, ticks: { maxTicksLimit: 10 } }, y: ejeY((v) => numero(v)) },
      },
    });
  }

  // ---------- embudo ----------
  function pintarEmbudo(d) {
    const c = $('embudo');
    if (!d.embudo) { c.innerHTML = rota('el embudo'); return; }
    const e = d.embudo;
    if (!e.total) { c.innerHTML = vacio('No hubo pedidos nuevos en este período.'); return; }

    const base = e.etapas[0].cantidad || 1;
    c.innerHTML = e.etapas.map((et) => `
      <div class="embudo-fila">
        <div class="embudo-top">
          <span class="nombre">${escapar(et.etapa)}</span>
          <span class="valor">${numero(et.cantidad)} <span class="embudo-nota">(${pct(et.cantidad / base)})</span></span>
        </div>
        <div class="embudo-barra"><i data-w="${Math.max((et.cantidad / base) * 100, 1)}"></i></div>
        <span class="embudo-nota">${escapar(et.nota)}</span>
      </div>`).join('') +
      `<p class="leyenda-nota">De cada 100 pedidos que se abren, <strong>${(e.conversion * 100).toFixed(0)}</strong> terminan en fichas cargadas.</p>`;
    animarBarras(c, '.embudo-barra i');
  }

  function animarBarras(cont, sel) {
    requestAnimationFrame(() => {
      cont.querySelectorAll(sel).forEach((i) => { i.style.width = i.dataset.w + '%'; });
    });
  }

  // ---------- estado actual ----------
  function pintarEstadoActual(d) {
    const c = $('estado-actual');
    if (!d.estadoActual) { c.innerHTML = rota('el estado actual'); return; }
    const e = d.estadoActual;
    const fila = (etiqueta, valor, malo = false) =>
      `<div class="estado-fila"><span class="etiqueta">${escapar(etiqueta)}</span>
       <span class="valor ${malo ? 'alerta-si' : ''}">${valor}</span></div>`;

    const b = e.bot24h || {};
    const filas = [
      fila('Última carga', hace(e.ultimaCarga)),
      fila('Esperando al bot', numero(e.enCola), e.enCola > 5),
      fila('Validando comprobante', numero(e.validando)),
      fila('Comprobantes sin resolver (48 h)', numero(e.validacionFallida), e.validacionFallida > 0),
      fila('Cargas fallidas (24 h)', numero(e.fallidas24h), e.fallidas24h >= 5),
      fila('El bot en las últimas 24 h',
        b.tasaExito == null ? 'sin trabajo' : `${pct(b.tasaExito)} de ${numero(b.ok + b.fallados)}`,
        b.tasaExito != null && b.tasaExito < 0.7 && b.fallados >= 5),
      fila('Premios por pagar (7 días)',
        `${numero(e.premiosPorPagar)} · ${money(e.premiosPorPagarMonto)}`, e.premiosPorPagar > 0),
    ];

    // El residuo va aparte y en gris: son pedidos viejos que quedaron colgados
    // en estados intermedios. Contarlos como "cola de hoy" hacía que el panel
    // avisara de una urgencia que no existe.
    const r = e.residuo || {};
    if (r.pedidos || r.premios) {
      filas.push(`<div class="estado-fila residuo">
        <span class="etiqueta">Colgados de hace más de 7 días</span>
        <span class="valor">${numero(r.pedidos)} pedidos${r.premios ? ` · ${numero(r.premios)} premios` : ''}</span>
      </div>`);
    }
    c.innerHTML = filas.join('');
  }

  // ---------- mensual ----------
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const nombreMes = (m) => { const [y, mm] = m.split('-'); return `${MESES[Number(mm) - 1]} ${y}`; };

  function pintarMensual(d) {
    const tbody = el('#tabla-mensual tbody');
    if (!d.mensual) { tbody.innerHTML = `<tr><td colspan="8">${rota('el mes a mes')}</td></tr>`; return; }

    const actual = d.mensual[d.mensual.length - 1]?.mes;
    const filas = d.mensual.filter((m) => m.cargas || m.premios || m.mes === actual);
    tbody.innerHTML = filas.slice().reverse().map((m) => `
      <tr${m.mes === actual ? ' class="actual"' : ''}>
        <td class="nombre-celda">${escapar(nombreMes(m.mes))}</td>
        <td>${numero(m.cargas)}</td>
        <td class="entro">${money(m.entradas)}</td>
        <td>${m.premios ? '− ' + money(m.premios) : money(0)}</td>
        <td class="${m.resultado >= 0 ? 'win' : 'loss'}">${money(m.resultado)}</td>
        <td>${pct(m.payoutRatio)}</td>
        <td>${numero(m.jugadores)}</td>
        <td>${numero(m.nuevos)}</td>
      </tr>`).join('') || `<tr><td colspan="8">${vacio('Todavía no hay meses con movimiento.')}</td></tr>`;

    upsert('mensual', 'chart-mensual', {
      type: 'bar',
      data: {
        labels: d.mensual.map((m) => nombreMes(m.mes).replace(' 20', ' ')),
        datasets: [
          { label: 'Entró', data: d.mensual.map((m) => m.entradas),
            backgroundColor: alfa(C.s1, 0.85), hoverBackgroundColor: C.s1, borderRadius: 4, maxBarThickness: 34 },
          { label: 'Premios pagados', data: d.mensual.map((m) => -m.premios),
            backgroundColor: alfa(C.s2, 0.85), hoverBackgroundColor: C.s2, borderRadius: 4, maxBarThickness: 34 },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: leyenda,
          tooltip: {
            ...tooltipBase,
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${money(Math.abs(c.parsed.y))}`,
              afterBody: (items) => `Resultado: ${money(d.mensual[items[0].dataIndex].resultado)}`,
            },
          },
        },
        scales: {
          x: { ...ejeXlimpio, stacked: false },
          y: { border: { display: false }, ticks: { callback: (v) => '$' + fmtNum.format(Math.abs(v)) } },
        },
      },
    });
  }

  // ---------- heatmap ----------
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  function pintarHeatmap(d) {
    const c = $('heatmap');
    if (!d.heatmap) { c.innerHTML = rota('el mapa de horarios'); return; }
    const max = Math.max(...d.heatmap.map((x) => x.cargas), 1);
    if (max <= 1 && !d.heatmap.some((x) => x.cargas)) {
      c.innerHTML = vacio('Sin cargas en este período.'); return;
    }

    let html = '';
    for (let dia = 1; dia <= 7; dia++) {
      const celdas = d.heatmap.filter((x) => x.dia === dia);
      html += `<div class="heat-fila"><span class="heat-dia">${DIAS[dia - 1]}</span>` +
        celdas.map((x) => {
          // Rampa secuencial de un solo tono (oro), de tenue a lleno.
          const t = x.cargas / max;
          const fondo = x.cargas ? alfa(C.s1, 0.12 + Math.pow(t, 0.6) * 0.88) : '';
          return `<div class="heat-celda" ${fondo ? `style="background:${fondo}"` : ''}
                    title="${DIAS[dia - 1]} ${x.hora}:00 — ${numero(x.cargas)} cargas · ${money(x.monto)}"></div>`;
        }).join('') + '</div>';
    }
    html += '<div class="heat-horas"><span></span>' +
      Array.from({ length: 24 }, (_, h) => `<span class="heat-hora">${h % 3 === 0 ? h : ''}</span>`).join('') +
      '</div>';
    c.innerHTML = html;
  }

  // ---------- distribución ----------
  function pintarDistribucion(d) {
    if (!d.distribucion) return;
    upsert('distrib', 'chart-distribucion', {
      type: 'bar',
      data: {
        labels: d.distribucion.map((x) => x.etiqueta.replace('menos de ', '< ').replace('más de ', '> ')),
        datasets: [{
          label: 'Cargas', data: d.distribucion.map((x) => x.cargas),
          backgroundColor: alfa(C.s1, 0.8), hoverBackgroundColor: C.s1, borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipBase,
            callbacks: {
              label: (c) => ` ${numero(c.parsed.x)} cargas`,
              afterLabel: (c) => `por ${money(d.distribucion[c.dataIndex].monto)}`,
            },
          },
        },
        scales: { x: ejeY((v) => numero(v)), y: { ...ejeXlimpio, ticks: { font: { size: 11 } } } },
      },
    });
  }

  // ---------- jugadores ----------
  function pintarJugadores(d) {
    // KPIs
    const cont = $('kpis-jugadores');
    const rec = d.recurrencia, comp = d.composicion, p = d.periodo;
    cont.innerHTML = [
      p ? kpi(d.rango.activos, numero(p.jugadoresActivos), '') : '',
      p ? kpi('Nuevos en el período', numero(p.jugadoresNuevos), '') : '',
      comp ? kpi('La plata viene de los de siempre', pct(comp.participacionRecurrentes),
        `${numero(comp.recurrentes.jugadores)} ya habían cargado antes`) : '',
      rec ? kpi('Vuelven mes a mes', pct(rec.tasa),
        `${numero(rec.volvieron)} de ${numero(rec.mesPrevio)} del mes pasado`) : '',
      d.totales ? kpi('Jugadores en total', numero(d.totales.jugadores), 'histórico') : '',
    ].filter(Boolean).join('');

    // composición
    const cc = $('composicion');
    if (!comp) { cc.innerHTML = rota('la composición'); }
    else {
      const total = comp.recurrentes.monto + comp.nuevos.monto;
      if (!total) cc.innerHTML = vacio('Sin cargas en este período.');
      else {
        const pr = (comp.recurrentes.monto / total) * 100;
        cc.innerHTML = `
          <div class="comp-barra">
            <span class="rec" style="width:${pr}%"></span>
            <span class="nue" style="width:${100 - pr}%"></span>
          </div>
          <div class="comp-leyenda">
            <div class="comp-item"><span class="punto" style="background:${C.s3}"></span>
              Ya habían cargado antes <span class="cifra">${money(comp.recurrentes.monto)}</span></div>
            <div class="comp-item"><span class="punto" style="background:${C.s4}"></span>
              Cargaron por primera vez <span class="cifra">${money(comp.nuevos.monto)}</span></div>
          </div>
          <p class="leyenda-nota">En ${escapar(d.rango.corto)} cargaron
            ${numero(comp.recurrentes.jugadores)} conocidos y ${numero(comp.nuevos.jugadores)}
            que debutaron. Ojo: "debutar" es la primera carga, no el alta —
            un jugador puede haberse registrado hace meses y recién cargar ahora.</p>`;
      }
    }

    // frecuencia
    if (d.frecuencia) {
      upsert('frec', 'chart-frecuencia', {
        type: 'bar',
        data: {
          labels: d.frecuencia.map((x) => x.etiqueta),
          datasets: [{
            label: 'Jugadores', data: d.frecuencia.map((x) => x.jugadores),
            backgroundColor: alfa(C.s3, 0.8), hoverBackgroundColor: C.s3, borderRadius: 4,
          }],
        },
        options: {
          plugins: {
            legend: { display: false },
            tooltip: {
              ...tooltipBase,
              callbacks: {
                label: (c) => ` ${numero(c.parsed.y)} jugadores`,
                afterLabel: (c) => `cargaron ${money(d.frecuencia[c.dataIndex].monto)}`,
              },
            },
          },
          scales: { x: ejeXlimpio, y: ejeY((v) => numero(v)) },
        },
      });
    }

    // top jugadores
    const tb = el('#tabla-top tbody');
    if (!d.topJugadores) tb.innerHTML = `<tr><td colspan="6">${rota('el top de jugadores')}</td></tr>`;
    else if (!d.topJugadores.length) tb.innerHTML = `<tr><td colspan="6">${vacio('Nadie cargó en este período.')}</td></tr>`;
    else tb.innerHTML = d.topJugadores.map((j) => `
      <tr>
        <td class="nombre-celda">${escapar(j.jugador)}</td>
        <td>${numero(j.cargas)}</td>
        <td class="entro">${money(j.monto)}</td>
        <td>${j.premios ? '− ' + money(j.premios) : '—'}</td>
        <td class="${j.neto >= 0 ? 'win' : 'loss'}">${money(j.neto)}</td>
        <td>${escapar(hace(j.ultima))}</td>
      </tr>`).join('');

    // en riesgo
    const tr = el('#tabla-riesgo tbody');
    if (!d.enRiesgo) tr.innerHTML = `<tr><td colspan="5">${rota('los jugadores en riesgo')}</td></tr>`;
    else if (!d.enRiesgo.length) tr.innerHTML = `<tr><td colspan="5">${vacio('Ninguno de los habituales se alejó. Buena señal.')}</td></tr>`;
    else tr.innerHTML = d.enRiesgo.map((j) => `
      <tr>
        <td class="nombre-celda">${escapar(j.jugador)}</td>
        <td>${numero(j.cargas)}</td>
        <td class="entro">${money(j.monto)}</td>
        <td>${escapar(fechaCorta(j.ultima))}</td>
        <td class="loss">${numero(j.dias)} días</td>
      </tr>`).join('');

    // cohortes
    pintarCohortes(d.cohortes);
  }

  function pintarCohortes(cohortes) {
    const c = $('cohortes');
    if (!cohortes) { c.innerHTML = rota('las cohortes'); return; }
    if (!cohortes.length) { c.innerHTML = vacio('Todavía no hay grupos con historia suficiente.'); return; }

    const cab = `<div class="cohorte-fila">
      <span class="cohorte-cab">Debutaron en</span><span class="cohorte-cab">Cuántos</span>` +
      Array.from({ length: 6 }, (_, i) => `<span class="cohorte-cab">${i === 0 ? 'ese mes' : `+${i}`}</span>`).join('') +
      '</div>';

    c.innerHTML = `<div class="cohorte-grid">${cab}` + cohortes.map((co) => `
      <div class="cohorte-fila">
        <span class="cohorte-mes">${escapar(nombreMes(co.cohorte).replace(' 20', " '"))}</span>
        <span class="cohorte-base">${numero(co.base)}</span>
        ${co.celdas.map((cel) => {
          if (!cel) return '<span class="cohorte-celda">·</span>';
          const fondo = alfa(C.s3, 0.12 + (cel.tasa || 0) * 0.72);
          const claro = (cel.tasa || 0) > 0.45;
          return `<span class="cohorte-celda" style="background:${fondo};color:${claro ? '#0c1310' : '#ede7d8'}"
                    title="${numero(cel.jugadores)} jugadores">${pct(cel.tasa)}</span>`;
        }).join('')}
      </div>`).join('') + '</div>';
  }

  // ---------- operación ----------
  function pintarOperacion(d) {
    const t = d.tiempos, b = d.bot, v = d.validacion;

    $('kpis-operacion').innerHTML = [
      t ? kpi('Tarda una carga', duracion(t.cicloP50), `9 de cada 10, menos de ${duracion(t.cicloP90)}`) : '',
      t ? kpi('Espera en la cola', duracion(t.esperaColaP50), `pico ${duracion(t.esperaColaP90)}`) : '',
      b ? kpi('El bot acierta', pct(b.tasaExito),
            `${numero(b.fallados)} fallas sobre ${numero(b.ok + b.fallados)} terminados`,
            b.tasaExito != null && b.tasaExito < 0.85 ? 'loss' : '') : '',
      v ? kpi('Sin tocar nada', pct(v.tasaAutomatica), `${numero(v.manuales)} necesitaron un operador`) : '',
      t && t.premioMuestras ? kpi('Tarda un premio', duracion(t.premioP50), `del pedido al pago`) : '',
    ].filter(Boolean).join('');

    // tiempos detallados
    const ct = $('tiempos');
    if (!t) ct.innerHTML = rota('los tiempos');
    else if (!t.muestras) ct.innerHTML = vacio('No hubo cargas completadas para medir.');
    else {
      const fila = (etiqueta, p50, p90, nota) => `
        <div class="tiempo-fila">
          <div class="tiempo-top"><span class="etiqueta">${escapar(etiqueta)}</span>
            <span class="valor">${duracion(p50)}</span></div>
          <span class="tiempo-nota">${escapar(nota)} · los peores casos, ${duracion(p90)}</span>
        </div>`;
      ct.innerHTML =
        fila('Del pedido a las fichas', t.cicloP50, t.cicloP90, `medido sobre ${numero(t.muestras)} cargas`) +
        fila('Esperando turno en la cola', t.esperaColaP50, t.esperaColaP90, 'desde que se aprueba hasta que el bot arranca') +
        fila('El bot trabajando', t.ejecucionP50, t.ejecucionP90, 'lo que tarda en el panel') +
        (t.premioMuestras
          ? fila('Del premio pedido al pago', t.premioP50, t.premioP90, `sobre ${numero(t.premioMuestras)} premios`)
          : '');
    }

    // tabla bot
    const tb = el('#tabla-bot tbody');
    const NOMBRE_JOB = {
      LOAD_CREDITS: 'Cargar fichas', WITHDRAW_CHIPS: 'Retirar fichas',
      CHANGE_PASSWORD: 'Cambiar contraseña', CREATE_USER: 'Crear usuario',
      OUTBOUND_PAYMENT: 'Pagar', BUY_CRYPTO: 'Comprar cripto',
    };
    if (!b) tb.innerHTML = `<tr><td colspan="5">${rota('el trabajo del bot')}</td></tr>`;
    else if (!b.porTipo.length) tb.innerHTML = `<tr><td colspan="5">${vacio('El bot no tuvo trabajo en este período.')}</td></tr>`;
    else tb.innerHTML = b.porTipo.map((x) => `
      <tr>
        <td class="nombre-celda">${escapar(NOMBRE_JOB[x.tipo] || x.tipo)}</td>
        <td>${numero(x.total)}</td>
        <td class="win">${numero(x.ok)}</td>
        <td class="${x.fallados ? 'loss' : ''}">${numero(x.fallados)}</td>
        <td class="${x.tasaExito != null && x.tasaExito < 0.85 ? 'loss' : ''}">${pct(x.tasaExito)}</td>
      </tr>`).join('');

    // errores
    const te = el('#tabla-errores tbody');
    if (!b) te.innerHTML = `<tr><td colspan="3">${rota('los errores')}</td></tr>`;
    else if (!b.errores.length) te.innerHTML = `<tr><td colspan="3">${vacio('Ninguna falla en este período.')}</td></tr>`;
    else te.innerHTML = b.errores.map((e) => `
      <tr>
        <td class="nombre-celda">${escapar(e.motivo)}</td>
        <td class="loss">${numero(e.cantidad)}</td>
        <td>${escapar(hace(e.ultima))}</td>
      </tr>`).join('');

    // pipeline premios
    const cp = $('premios-pipeline');
    if (!d.premios) cp.innerHTML = rota('el estado de los premios');
    else if (!d.premios.porEstado.length) cp.innerHTML = vacio('No se pidieron premios en este período.');
    else cp.innerHTML = d.premios.porEstado.map((e) => `
      <div class="pipe-fila ${e.pendiente ? 'pendiente' : ''}">
        <span class="etiqueta">${e.pendiente ? '<span class="punto" style="background:' + C.s1 + '"></span>' : ''}${escapar(e.etiqueta)}</span>
        <span class="cantidad">${numero(e.cantidad)}</span>
        <span class="monto">${money(e.monto)}</span>
      </div>`).join('');

    // validación
    const cv = $('validacion');
    if (!v) cv.innerHTML = rota('la validación');
    else if (!v.conComprobante) cv.innerHTML = vacio('No hubo comprobantes en este período.');
    else cv.innerHTML = `
      <div class="medidor">
        <div class="medidor-top">
          <span>Se resolvió sin operador</span>
          <span class="valor">${pct(v.tasaAutomatica)}</span>
        </div>
        <div class="medidor-barra"><i data-w="${(v.tasaAutomatica || 0) * 100}"></i></div>
      </div>
      <div class="estado-actual">
        <div class="estado-fila"><span class="etiqueta">Comprobantes recibidos</span><span class="valor">${numero(v.conComprobante)}</span></div>
        <div class="estado-fila"><span class="etiqueta">Los aprobó un operador a mano</span><span class="valor">${numero(v.manuales)}</span></div>
        <div class="estado-fila"><span class="etiqueta">La IA no pudo validarlos</span><span class="valor ${v.validacionFallida ? 'alerta-si' : ''}">${numero(v.validacionFallida)}</span></div>
        <div class="estado-fila"><span class="etiqueta">Confianza típica de la IA</span><span class="valor">${v.scoreMediana == null ? '—' : pct(v.scoreMediana)}</span></div>
      </div>`;
    animarBarras(cv, '.medidor-barra i');
  }

  // ---------- paneles y billeteras ----------
  const NOMBRE_WALLET = {
    MERCADOPAGO: 'Mercado Pago', CBU: 'CBU', CVU: 'CVU',
    RIPIO: 'Ripio', FIWIND: 'Fiwind', PREX: 'Prex',
  };

  function pintarCanales(d) {
    const cp = $('paneles');
    if (!d.porPanel) cp.innerHTML = rota('los paneles');
    else if (!d.porPanel.length) cp.innerHTML = vacio('Sin cargas en este período.');
    else {
      const max = Math.max(...d.porPanel.map((x) => x.monto), 1);
      cp.innerHTML = d.porPanel.map((x) => `
        <div class="panel-row">
          <div class="panel-top">
            <span class="nombre">${escapar(x.panel)}
              ${x.activo === false ? '<span class="tag off">apagado</span>' : ''}</span>
            <span class="monto">${money(x.monto)}</span>
          </div>
          <div class="panel-bar"><i data-w="${Math.max((x.monto / max) * 100, 1.5)}"></i></div>
          <span class="panel-note">
            ${numero(x.cargas)} ${x.cargas === 1 ? 'carga' : 'cargas'} ·
            ${numero(x.jugadores)} jugadores ·
            ${x.premios ? `${money(x.premios)} en premios · resultado ${money(x.resultado)}` : 'sin premios pagados'}
            ${x.fallidas ? ` · <span class="loss">${numero(x.fallidas)} fallidas</span>` : ''}
          </span>
        </div>`).join('');
      animarBarras(cp, '.panel-bar i');
    }

    const tw = el('#tabla-wallets tbody');
    if (!d.wallets) tw.innerHTML = `<tr><td colspan="7">${rota('las billeteras')}</td></tr>`;
    else if (!d.wallets.length) tw.innerHTML = `<tr><td colspan="7">${vacio('No hay billeteras configuradas.')}</td></tr>`;
    else tw.innerHTML = d.wallets.map((w) => `
      <tr>
        <td class="nombre-celda">${escapar(w.label)}</td>
        <td>${escapar(NOMBRE_WALLET[w.tipo] || w.tipo)}</td>
        <td>${escapar(w.titular || '—')}</td>
        <td>${numero(w.cargas)}</td>
        <td class="entro">${money(w.monto)}</td>
        <td>${w.limite
          ? `${money(w.acumulado)} / ${money(w.limite)} <span class="${w.usoLimite >= 0.85 ? 'loss' : ''}">(${pct(w.usoLimite)})</span>`
          : money(w.acumulado)}</td>
        <td>${w.seleccionada ? '<span class="tag">en uso</span>'
             : w.activa ? '<span class="tag">activa</span>'
             : '<span class="tag off">apagada</span>'}</td>
      </tr>`).join('');
  }

  // ============================================================
  //  DATOS Y NAVEGACIÓN
  // ============================================================
  function paramsActuales() {
    const p = new URLSearchParams();
    p.set('range', estado.rango);
    if (estado.rango === 'custom' && estado.desde && estado.hasta) {
      p.set('from', estado.desde); p.set('to', estado.hasta);
    }
    if (estado.panel) p.set('panel', estado.panel);
    return p;
  }

  function sincronizarURL() {
    const p = paramsActuales();
    if (estado.tab !== 'resumen') p.set('tab', estado.tab);
    history.replaceState(null, '', `?${p}`);
  }

  async function cargar({ silencioso = false } = {}) {
    const app = $('app');
    if (!silencioso) { app.classList.add('loading'); app.setAttribute('aria-busy', 'true'); }
    try {
      const r = await fetch(`/api/summary?${paramsActuales()}`);
      if (!r.ok) throw new Error(`estado ${r.status}`);
      render(await r.json());
    } catch (err) {
      const b = $('banda-estado');
      b.hidden = false;
      b.className = 'banda error';
      b.textContent = 'No se pudieron cargar los datos. Se vuelve a intentar en un minuto.';
      $('footer-note').textContent = 'Sin conexión con la base.';
    } finally {
      app.classList.remove('loading');
      app.setAttribute('aria-busy', 'false');
    }
  }

  function programarRefresco() {
    clearInterval(timerRefresco);
    timerRefresco = setInterval(() => {
      if (!document.hidden) cargar({ silencioso: true });
    }, 60_000);
  }

  function mostrarTab(nombre) {
    estado.tab = nombre;
    document.querySelectorAll('.tabs button').forEach((b) => {
      const activo = b.dataset.tab === nombre;
      b.classList.toggle('active', activo);
      b.setAttribute('aria-selected', String(activo));
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('activo', p.dataset.panel === nombre);
    });
    // Los gráficos de una pestaña oculta se crean sobre un canvas de ancho 0 y
    // quedan con barras de 4px. Al mostrarla hay que redimensionar Y redibujar:
    // solo con resize() los ejes se reacomodan pero las barras conservan el
    // ancho viejo.
    requestAnimationFrame(() => Object.values(charts).forEach((c) => {
      c.resize();
      c.update('none');
    }));
    sincronizarURL();
  }

  const EXPORTS = [
    ['resumen', 'Resumen del período'],
    ['serie', 'Movimiento día por día'],
    ['mensual', 'Mes a mes'],
    ['paneles', 'Cargas por panel'],
    ['wallets', 'Billeteras'],
    ['jugadores', 'Los que más cargaron'],
    ['riesgo', 'Jugadores que se apagan'],
    ['errores', 'Errores del bot'],
  ];

  function pintarMenuExport() {
    $('menu-export').innerHTML = EXPORTS.map(([tipo, txt]) =>
      `<a href="#" data-tipo="${tipo}">${escapar(txt)}</a>`).join('');
    $('menu-export').addEventListener('click', (ev) => {
      const a = ev.target.closest('a[data-tipo]');
      if (!a) return;
      ev.preventDefault();
      const p = paramsActuales();
      p.set('tipo', a.dataset.tipo);
      window.location.href = `/api/export.csv?${p}`;
      el('.menu').open = false;
    });
  }

  async function inicializar() {
    // estado desde la URL (permite guardar la vista en favoritos)
    const q = new URLSearchParams(location.search);
    estado.rango = q.get('range') || 'hoy';
    estado.panel = q.get('panel') || '';
    estado.desde = q.get('from') || '';
    estado.hasta = q.get('to') || '';
    const tabInicial = q.get('tab') || 'resumen';

    // opciones de período y export desde el backend
    try {
      const meta = await (await fetch('/api/meta')).json();
      $('sel-rango').innerHTML = meta.rangos.map((r) =>
        `<option value="${r.key}">${escapar(r.label)}</option>`).join('') +
        '<option value="custom">Elegir fechas…</option>';
    } catch {
      $('sel-rango').innerHTML = '<option value="hoy">Hoy</option>';
    }
    $('sel-rango').value = estado.rango;
    $('filtro-fechas').hidden = estado.rango !== 'custom';
    if (estado.desde) $('fecha-desde').value = estado.desde;
    if (estado.hasta) $('fecha-hasta').value = estado.hasta;

    // paneles
    try {
      const paneles = await (await fetch('/api/paneles')).json();
      if (Array.isArray(paneles)) {
        $('sel-panel').innerHTML = '<option value="">Todos</option>' + paneles.map((p) =>
          `<option value="${escapar(p.id)}">${escapar(p.nombre)}${p.activo ? '' : ' (apagado)'}</option>`).join('');
        $('sel-panel').value = estado.panel;
      }
    } catch { /* el filtro queda en "Todos" */ }

    pintarMenuExport();
    mostrarTab(tabInicial);

    // eventos
    $('sel-rango').addEventListener('change', (e) => {
      estado.rango = e.target.value;
      const esCustom = estado.rango === 'custom';
      $('filtro-fechas').hidden = !esCustom;
      if (esCustom) {
        if (!$('fecha-hasta').value) {
          const hoy = new Date();
          const antes = new Date(Date.now() - 29 * 86400000);
          $('fecha-hasta').value = hoy.toISOString().slice(0, 10);
          $('fecha-desde').value = antes.toISOString().slice(0, 10);
        }
        return; // espera a que toque "Ver"
      }
      sincronizarURL(); cargar();
    });

    $('btn-aplicar').addEventListener('click', () => {
      estado.desde = $('fecha-desde').value;
      estado.hasta = $('fecha-hasta').value;
      if (!estado.desde || !estado.hasta) return;
      if (estado.desde > estado.hasta) { [estado.desde, estado.hasta] = [estado.hasta, estado.desde]; }
      sincronizarURL(); cargar();
    });

    $('sel-panel').addEventListener('change', (e) => {
      estado.panel = e.target.value; sincronizarURL(); cargar();
    });

    $('btn-refrescar').addEventListener('click', () => cargar());

    document.querySelectorAll('.tabs button').forEach((b) => {
      b.addEventListener('click', () => mostrarTab(b.dataset.tab));
    });

    // cerrar el menú de descargas al hacer clic afuera
    document.addEventListener('click', (ev) => {
      const m = el('.menu');
      if (m?.open && !m.contains(ev.target)) m.open = false;
    });

    // al volver a la pestaña, refrescar si pasó tiempo
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && estado.datos &&
          Date.now() - new Date(estado.datos.generadoEn).getTime() > 60_000) {
        cargar({ silencioso: true });
      }
    });

    await cargar();
    programarRefresco();
  }

  inicializar();
})();
