import React from 'react';

/**
 * LDS v1.0 Chart primitives — dependency-free, high-performance SVG charts.
 */

/**
 * DualBarChart Component for 'Sales & Invoices'.
 * Renders dual rounded gradient bars per month with background gridlines and Y-axis scale.
 */
export function DualBarChart({
  series = [
    { month: 'Apr 2026', taxable: 22, gst: 8 },
    { month: 'May 2026', taxable: 38, gst: 14 },
    { month: 'Jun 2026', taxable: 55, gst: 18 },
    { month: 'Jul 2026', taxable: 55, gst: 24 },
    { month: 'Aug 2026', taxable: 78, gst: 32 },
    { month: 'Sep 2026', taxable: 105, gst: 48 },
  ],
  maxVal = 120,
}) {
  const chartHeight = 150;
  const chartWidth = 440;
  const yTicks = [120, 90, 60, 30, 0];

  return (
    <div className="lds-dual-bar-chart" style={{ width: '100%', position: 'relative' }}>
      <svg
        viewBox={`0 0 ${chartWidth} 190`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="dbc-taxable" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#DDD6FE" />
          </linearGradient>
          <linearGradient id="dbc-gst" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#FDE68A" />
          </linearGradient>
        </defs>

        {/* Y-Axis Gridlines & Labels */}
        {yTicks.map((tick, i) => {
          const y = (i / (yTicks.length - 1)) * chartHeight;
          return (
            <g key={tick}>
              <text
                x="30"
                y={y + 4}
                fill="#94A3B8"
                fontSize="11"
                fontWeight="500"
                textAnchor="end"
              >
                ₹{tick}
              </text>
              <line
                x1="40"
                y1={y}
                x2={chartWidth}
                y2={y}
                stroke="#F1F5F9"
                strokeWidth="1"
              />
            </g>
          );
        })}

        {/* Bar Groups */}
        {series.map((item, idx) => {
          const groupWidth = (chartWidth - 50) / series.length;
          const groupX = 45 + idx * groupWidth;
          const barWidth = 14;
          const gap = 4;

          const taxableH = (item.taxable / maxVal) * chartHeight;
          const gstH = (item.gst / maxVal) * chartHeight;

          const taxableY = chartHeight - taxableH;
          const gstY = chartHeight - gstH;

          return (
            <g key={item.month}>
              {/* Taxable Bar (Purple) */}
              <rect
                x={groupX + groupWidth / 2 - barWidth - gap / 2}
                y={taxableY}
                width={barWidth}
                height={Math.max(2, taxableH)}
                rx="4"
                fill="url(#dbc-taxable)"
              />
              {/* GST Bar (Orange) */}
              <rect
                x={groupX + groupWidth / 2 + gap / 2}
                y={gstY}
                width={barWidth}
                height={Math.max(2, gstH)}
                rx="4"
                fill="url(#dbc-gst)"
              />
              {/* Month Label */}
              <text
                x={groupX + groupWidth / 2}
                y={chartHeight + 20}
                fill="#64748B"
                fontSize="11"
                fontWeight="500"
                textAnchor="middle"
              >
                {item.month}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** DonutChart with rich continuous gradient ring and centered metric matching reference */
export function DonutChart({ data: _data = [], size = 150, thickness = 20, centerLabel, centerValue }) {
  const radius = (size - thickness) / 2;

  return (
    <div className="lds-donut" style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="donut-ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="35%" stopColor="#6366F1" />
            <stop offset="70%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
        </defs>
        {/* Soft background track */}
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F1F5F9" strokeWidth={thickness} />
        {/* Continuous gradient ring matching reference */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#donut-ring-gradient)"
          strokeWidth={thickness}
          strokeLinecap="round"
        />
      </svg>
      <div className="lds-donut__center">
        <strong style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>{centerValue}</strong>
        {centerLabel && <span style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '3px', fontWeight: 500 }}>{centerLabel}</span>}
      </div>
    </div>
  );
}

export function DonutLegend({ data = [] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ul className="lds-donut-legend" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {data.map((d) => (
        <li key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.88rem' }}>
          <span className="lds-donut-legend__dot" style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} aria-hidden="true" />
          <span className="lds-donut-legend__label" style={{ flex: 1, color: '#475569', fontWeight: 500 }}>{d.label}</span>
          <span className="lds-donut-legend__value" style={{ fontWeight: 600, color: '#0F172A', marginRight: '0.5rem' }}>{d.value}</span>
          <span className="lds-donut-legend__pct muted" style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * SingleBarChart for backwards compatibility
 */
export function SingleBarChart({ bars = [], max }) {
  const peak = max ?? Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="lds-bars">
      {bars.map((b) => (
        <div key={b.label} className="lds-bars__row">
          <span className="lds-bars__label">{b.label}</span>
          <div className="lds-bars__track">
            <div className="lds-bars__fill" style={{ width: `${Math.max(2, (b.value / peak) * 100)}%`, background: b.color }} />
          </div>
          <span className="lds-bars__value mono">{b.display ?? b.value}</span>
        </div>
      ))}
    </div>
  );
}

export default { DonutChart, DonutLegend, SingleBarChart, DualBarChart };

