// Custom SVG Charts for AutoBot Extension
// CSP-compliant charts without external libraries

/**
 * Create a donut/ring chart
 * @param {Object} options
 * @param {number} options.success - Number of successful jobs
 * @param {number} options.failed - Number of failed jobs
 * @param {number} options.size - Chart size in pixels
 * @param {number} options.strokeWidth - Thickness of the ring
 * @param {boolean} options.showLabel - Show percentage in center
 * @param {boolean} options.showLegend - Show legend below chart
 * @returns {string} SVG HTML string
 */
function createDonutChart(options) {
  const {
    success = 0,
    failed = 0,
    size = 120,
    strokeWidth = 12,
    showLabel = true,
    showLegend = false,
    compact = false
  } = options;

  const total = success + failed;
  const successPercent = total > 0 ? (success / total) * 100 : 0;
  const failedPercent = total > 0 ? (failed / total) * 100 : 0;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Calculate stroke dash for each segment
  const successDash = (successPercent / 100) * circumference;
  const failedDash = (failedPercent / 100) * circumference;

  // Colors
  const successColor = '#10b981'; // emerald-500
  const failedColor = '#ef4444';  // red-500
  const bgColor = 'rgba(255, 255, 255, 0.1)';

  const labelSize = compact ? 'text-lg' : 'text-2xl';
  const subLabelSize = compact ? 'text-xs' : 'text-sm';

  let svg = `
    <div class="flex flex-col items-center">
      <div class="relative" style="width: ${size}px; height: ${size}px;">
        <svg width="${size}" height="${size}" class="transform -rotate-90">
          <!-- Background circle -->
          <circle
            cx="${center}"
            cy="${center}"
            r="${radius}"
            fill="none"
            stroke="${bgColor}"
            stroke-width="${strokeWidth}"
          />
          ${total > 0 ? `
          <!-- Success segment -->
          <circle
            cx="${center}"
            cy="${center}"
            r="${radius}"
            fill="none"
            stroke="${successColor}"
            stroke-width="${strokeWidth}"
            stroke-dasharray="${successDash} ${circumference}"
            stroke-linecap="round"
            class="transition-all duration-500"
          />
          <!-- Failed segment -->
          <circle
            cx="${center}"
            cy="${center}"
            r="${radius}"
            fill="none"
            stroke="${failedColor}"
            stroke-width="${strokeWidth}"
            stroke-dasharray="${failedDash} ${circumference}"
            stroke-dashoffset="${-successDash}"
            stroke-linecap="round"
            class="transition-all duration-500"
          />
          ` : ''}
        </svg>
        ${showLabel ? `
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="${labelSize} font-bold text-white">${Math.round(successPercent)}%</span>
          <span class="${subLabelSize} text-white/50">éxito</span>
        </div>
        ` : ''}
      </div>
      ${showLegend ? `
      <div class="flex gap-4 mt-4">
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full" style="background: ${successColor}"></div>
          <span class="text-sm text-white/70">Exitosos (${success})</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full" style="background: ${failedColor}"></div>
          <span class="text-sm text-white/70">Fallidos (${failed})</span>
        </div>
      </div>
      ` : ''}
    </div>
  `;

  return svg;
}

/**
 * Create a sparkline chart (mini line chart)
 * @param {Object} options
 * @param {number[]} options.data - Array of values
 * @param {number} options.width - Chart width
 * @param {number} options.height - Chart height
 * @param {string} options.color - Line color
 * @param {boolean} options.fill - Fill area under line
 * @returns {string} SVG HTML string
 */
function createSparkline(options) {
  const {
    data = [],
    width = 120,
    height = 40,
    color = '#a855f7',
    fill = true
  } = options;

  if (data.length < 2) {
    return `
      <div class="flex items-center justify-center" style="width: ${width}px; height: ${height}px;">
        <span class="text-white/30 text-xs">Sin datos</span>
      </div>
    `;
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const padding = 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Generate path points
  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y };
  });

  // Create line path
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Create fill path (closed area)
  const fillPath = fill
    ? `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`
    : '';

  const gradientId = `sparkline-gradient-${Math.random().toString(36).substr(2, 9)}`;

  return `
    <svg width="${width}" height="${height}" class="overflow-visible">
      <defs>
        <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color: ${color}; stop-opacity: 0.3" />
          <stop offset="100%" style="stop-color: ${color}; stop-opacity: 0" />
        </linearGradient>
      </defs>
      ${fill ? `
      <path
        d="${fillPath}"
        fill="url(#${gradientId})"
      />
      ` : ''}
      <path
        d="${linePath}"
        fill="none"
        stroke="${color}"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <!-- End dot -->
      <circle
        cx="${points[points.length - 1].x}"
        cy="${points[points.length - 1].y}"
        r="3"
        fill="${color}"
      />
    </svg>
  `;
}

/**
 * Create a full area chart with labels
 * @param {Object} options
 * @param {Array} options.data - Array of {label, value} objects
 * @param {number} options.width - Chart width
 * @param {number} options.height - Chart height
 * @param {string} options.color - Line/fill color
 * @returns {string} SVG HTML string
 */
function createAreaChart(options) {
  const {
    data = [],
    width = 400,
    height = 200,
    color = '#a855f7'
  } = options;

  if (data.length < 2) {
    return `
      <div class="flex items-center justify-center bg-white/5 rounded-xl" style="width: ${width}px; height: ${height}px;">
        <span class="text-white/30 text-sm">No hay suficientes datos para mostrar</span>
      </div>
    `;
  }

  const values = data.map(d => d.value);
  const max = Math.max(...values, 1);

  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Generate points
  const points = values.map((value, index) => {
    const x = paddingLeft + (index / (values.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - (value / max) * chartHeight;
    return { x, y, value };
  });

  // Create paths
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const fillPath = `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${paddingLeft} ${paddingTop + chartHeight} Z`;

  // Y-axis labels
  const yLabels = [0, Math.round(max / 2), max];

  const gradientId = `area-gradient-${Math.random().toString(36).substr(2, 9)}`;

  return `
    <svg width="${width}" height="${height}" class="overflow-visible">
      <defs>
        <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color: ${color}; stop-opacity: 0.4" />
          <stop offset="100%" style="stop-color: ${color}; stop-opacity: 0" />
        </linearGradient>
      </defs>

      <!-- Grid lines -->
      ${yLabels.map((label, i) => {
        const y = paddingTop + chartHeight - (label / max) * chartHeight;
        return `
          <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="rgba(255,255,255,0.1)" stroke-dasharray="4" />
          <text x="${paddingLeft - 8}" y="${y + 4}" fill="rgba(255,255,255,0.4)" font-size="10" text-anchor="end">${label}</text>
        `;
      }).join('')}

      <!-- Fill area -->
      <path d="${fillPath}" fill="url(#${gradientId})" />

      <!-- Line -->
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Data points -->
      ${points.map((p, i) => `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}" class="transition-all hover:r-6" />
        <title>${data[i].label}: ${p.value}</title>
      `).join('')}

      <!-- X-axis labels -->
      ${data.map((d, i) => {
        const x = paddingLeft + (i / (data.length - 1)) * chartWidth;
        return `<text x="${x}" y="${height - 10}" fill="rgba(255,255,255,0.4)" font-size="10" text-anchor="middle">${d.label}</text>`;
      }).join('')}
    </svg>
  `;
}

/**
 * Create a bar chart
 * @param {Object} options
 * @param {Array} options.data - Array of {label, value, color?} objects
 * @param {number} options.width - Chart width
 * @param {number} options.height - Chart height
 * @returns {string} SVG HTML string
 */
function createBarChart(options) {
  const {
    data = [],
    width = 400,
    height = 200
  } = options;

  if (data.length === 0) {
    return `
      <div class="flex items-center justify-center bg-white/5 rounded-xl" style="width: ${width}px; height: ${height}px;">
        <span class="text-white/30 text-sm">Sin datos disponibles</span>
      </div>
    `;
  }

  const max = Math.max(...data.map(d => d.value), 1);

  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const barWidth = Math.min(40, (chartWidth / data.length) * 0.6);
  const barGap = (chartWidth - barWidth * data.length) / (data.length + 1);

  const defaultColor = '#a855f7';

  return `
    <svg width="${width}" height="${height}">
      <!-- Y-axis line -->
      <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + chartHeight}" stroke="rgba(255,255,255,0.2)" />

      <!-- Bars -->
      ${data.map((d, i) => {
        const barHeight = (d.value / max) * chartHeight;
        const x = paddingLeft + barGap + i * (barWidth + barGap);
        const y = paddingTop + chartHeight - barHeight;
        const color = d.color || defaultColor;

        return `
          <rect
            x="${x}"
            y="${y}"
            width="${barWidth}"
            height="${barHeight}"
            fill="${color}"
            rx="4"
            class="transition-all hover:opacity-80"
          />
          <text x="${x + barWidth / 2}" y="${y - 8}" fill="white" font-size="11" text-anchor="middle" font-weight="600">${d.value}</text>
          <text x="${x + barWidth / 2}" y="${height - 10}" fill="rgba(255,255,255,0.4)" font-size="10" text-anchor="middle">${d.label}</text>
        `;
      }).join('')}
    </svg>
  `;
}

// Export functions for use in popup and options
if (typeof window !== 'undefined') {
  window.Charts = {
    createDonutChart,
    createSparkline,
    createAreaChart,
    createBarChart
  };
}
