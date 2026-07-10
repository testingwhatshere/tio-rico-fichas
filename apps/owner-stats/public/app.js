/* Tío Rico · Panel del dueño — lógica del dashboard */
(() => {
  const $ = (id) => document.getElementById(id);

  const fmtMoney = new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  });
  const fmtNum = new Intl.NumberFormat('es-AR');
  const money = (v) => fmtMoney.format(v || 0);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const RANGE_LABELS = {
    hoy: { titulo: 'Entradas de hoy', corto: 'hoy', activos: 'Cargaron hoy' },
    '7d': { titulo: 'Entradas de los últimos 7 días', corto: '7 días', activos: 'Cargaron (7 días)' },
    mes: { titulo: 'Entradas de este mes', corto: 'este mes', activos: 'Cargaron este mes' },
    '30d': { titulo: 'Entradas de los últimos 30 días', corto: '30 días', activos: 'Cargaron (30 días)' },
    todo: { titulo: 'Entradas históricas', corto: 'histórico', activos: 'Cargaron alguna vez' },
  };

  let currentRange = 'hoy';
  let charts = {};

  // ---------- Chart.js defaults ----------
  Chart.defaults.font.family = "'Archivo', system-ui, sans-serif";
  Chart.defaults.color = '#8ea396';
  Chart.defaults.borderColor = 'rgba(36, 53, 43, 0.7)';
  Chart.defaults.animation = reduceMotion ? false : { duration: 600 };

  const tooltipStyle = {
    backgroundColor: '#182620',
    borderColor: '#24352b',
    borderWidth: 1,
    titleColor: '#ede7d8',
    bodyColor: '#ede7d8',
    padding: 10,
    cornerRadius: 8,
  };

  // ---------- animación de conteo para el número principal ----------
  function countUp(el, target) {
    if (reduceMotion || target === 0) { el.textContent = money(target); return; }
    const dur = 700;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = money(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- render ----------
  function render(d) {
    const labels = RANGE_LABELS[d.range];
    const p = d.periodo;

    // Asiento principal
    $('ledger-label').textContent = labels.titulo;
    countUp($('entradas-monto'), p.cargas.monto);
    $('ledger-sub').innerHTML = p.cargas.count > 0
      ? `en <strong>${fmtNum.format(p.cargas.count)} cargas</strong> · promedio <strong>${money(p.cargas.promedio)}</strong> por carga`
      : 'Todavía no hubo cargas en este período.';

    $('premios-pagados-monto').textContent = p.premiosPagados.monto > 0 ? `− ${money(p.premiosPagados.monto)}` : money(0);
    const res = $('resultado-monto');
    res.textContent = money(p.resultado);
    res.className = p.resultado >= 0 ? 'win' : 'loss';
    $('jugadores-activos').textContent = fmtNum.format(p.jugadoresActivos);

    // Cargas por panel
    const cont = $('paneles');
    $('panel-periodo').textContent = labels.corto;
    if (!d.porPanel.length) {
      cont.innerHTML = `<p class="vacio">Sin cargas en este período todavía.</p>`;
    } else {
      const max = Math.max(...d.porPanel.map((x) => x.monto), 1);
      cont.innerHTML = d.porPanel.map((x) => `
        <div class="panel-row">
          <div class="panel-top">
            <span class="nombre">${x.panel}</span>
            <span class="monto">${money(x.monto)}</span>
          </div>
          <div class="panel-bar"><i data-w="${Math.max((x.monto / max) * 100, 2)}"></i></div>
          <span class="panel-note">${fmtNum.format(x.cargas)} ${x.cargas === 1 ? 'carga' : 'cargas'}</span>
        </div>`).join('');
      requestAnimationFrame(() => {
        cont.querySelectorAll('.panel-bar i').forEach((el) => { el.style.width = el.dataset.w + '%'; });
      });
    }

    // Premios
    $('premios-periodo').textContent = labels.corto;
    $('premios-pedidos').textContent = fmtNum.format(p.premiosPedidos.count);
    $('premios-pedidos-monto').textContent = p.premiosPedidos.count ? `por ${money(p.premiosPedidos.monto)}` : '';
    $('premios-pagados-count').textContent = fmtNum.format(p.premiosPagados.count);
    $('premios-pagados-monto-2').textContent = p.premiosPagados.count ? `por ${money(p.premiosPagados.monto)}` : '';
    $('premios-proceso').textContent = fmtNum.format(p.premiosEnProceso);
    $('premios-rechazados').textContent = fmtNum.format(p.premiosRechazados);

    // Jugadores
    $('jug-activos-label').textContent = labels.activos;
    $('jug-activos').textContent = fmtNum.format(p.jugadoresActivos);
    $('jug-nuevos').textContent = fmtNum.format(p.jugadoresNuevos);
    $('jug-total').textContent = fmtNum.format(d.totales.jugadores);
    $('ticket-promedio').textContent = p.cargas.count ? money(p.cargas.promedio) : '—';

    renderDiario(d.diario);
    renderHoras(d.horas);
    renderMensual(d.mensual);

    // Footer
    const hora = new Date(d.generatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    $('footer-note').textContent = `Actualizado a las ${hora} · los datos se renuevan solos cada minuto.`;
    $('footer-totals').textContent =
      `Histórico: ${money(d.totales.entradas)} en ${fmtNum.format(d.totales.cargas)} cargas · ${money(d.totales.premios)} en premios pagados`;
  }

  function renderDiario(diario) {
    const labels = diario.map((x) => {
      const [, m, day] = x.fecha.split('-');
      return `${Number(day)}/${Number(m)}`;
    });
    const data = {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Entró',
          data: diario.map((x) => x.entradas),
          backgroundColor: 'rgba(216, 178, 108, 0.75)',
          hoverBackgroundColor: '#ecca8a',
          borderRadius: 3,
          maxBarThickness: 18,
        },
        {
          type: 'line',
          label: 'Premios pagados',
          data: diario.map((x) => x.premios),
          borderColor: '#e08976',
          backgroundColor: '#e08976',
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
          tension: 0.35,
        },
      ],
    };
    upsertChart('diario', 'chart-diario', {
      type: 'bar',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${money(ctx.parsed.y)}`,
              afterBody: (items) => {
                const i = items[0].dataIndex;
                const c = itemsCache[i]?.cargas;
                return c ? `  ${fmtNum.format(c)} cargas` : '';
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { ticks: { callback: (v) => '$' + fmtNum.format(v) }, beginAtZero: true },
        },
      },
    });
    itemsCache = diario;
  }
  let itemsCache = [];

  function renderHoras(horas) {
    upsertChart('horas', 'chart-horas', {
      type: 'bar',
      data: {
        labels: horas.map((x) => `${x.hora} h`),
        datasets: [{
          label: 'Cargas',
          data: horas.map((x) => x.cargas),
          backgroundColor: 'rgba(127, 214, 160, 0.55)',
          hoverBackgroundColor: '#7fd6a0',
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            callbacks: { label: (ctx) => ` ${fmtNum.format(ctx.parsed.y)} cargas` },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  function renderMensual(mensual) {
    const tbody = document.querySelector('#tabla-mensual tbody');
    const actual = mensual[mensual.length - 1].mes;
    const filas = mensual.filter((m) => m.cargas || m.premios || m.mes === actual);
    tbody.innerHTML = filas.map((m) => {
      const [y, mm] = m.mes.split('-');
      const nombre = `${MESES[Number(mm) - 1]} ${y}`;
      const cls = m.resultado >= 0 ? 'win' : 'loss';
      return `<tr${m.mes === actual ? ' class="actual"' : ''}>
        <td>${nombre}</td>
        <td>${fmtNum.format(m.cargas)}</td>
        <td class="entro">${money(m.entradas)}</td>
        <td>${m.premios ? '− ' + money(m.premios) : money(0)}</td>
        <td class="${cls}">${money(m.resultado)}</td>
      </tr>`;
    }).reverse().join('');
  }

  function upsertChart(key, canvasId, config) {
    if (charts[key]) {
      charts[key].data = config.data;
      charts[key].update();
    } else {
      charts[key] = new Chart($(canvasId), config);
    }
  }

  // ---------- data ----------
  async function load(range) {
    const app = $('app');
    app.classList.add('loading');
    app.setAttribute('aria-busy', 'true');
    try {
      const r = await fetch(`/api/summary?range=${range}`);
      if (!r.ok) throw new Error('bad status');
      render(await r.json());
    } catch {
      $('footer-note').textContent = 'No se pudieron cargar los datos. Se reintenta en un minuto.';
    } finally {
      app.classList.remove('loading');
      app.setAttribute('aria-busy', 'false');
    }
  }

  document.querySelectorAll('.ranges button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector('.ranges .active')?.classList.remove('active');
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      load(currentRange);
    });
  });

  load(currentRange);
  setInterval(() => load(currentRange), 60_000);
})();
