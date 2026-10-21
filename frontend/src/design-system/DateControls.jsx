import React from 'react';

/**
 * LDS v1.0 DatePicker Component
 */
export function DatePicker({
  id,
  value,
  defaultValue,
  onChange,
  disabled = false,
  min,
  max,
  className = '',
  ...props
}) {
  return (
    <input
      id={id}
      type="date"
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      disabled={disabled}
      min={min}
      max={max}
      className={`input input--date ${className}`.trim()}
      {...props}
    />
  );
}

/**
 * LDS v1.0 DateRangePicker Component
 */
export function DateRangePicker({
  startDate,
  endDate,
  onRangeChange,
  presets = [
    { label: 'Today', days: 0 },
    { label: 'Last 7 Days', days: 7 },
    { label: 'Last 30 Days', days: 30 },
    { label: 'This Month', type: 'month' },
  ],
  className = '',
}) {
  const applyPreset = (preset) => {
    const today = new Date();
    const end = today.toISOString().split('T')[0];
    let start = end;

    if (preset.days) {
      const past = new Date();
      past.setDate(today.getDate() - preset.days);
      start = past.toISOString().split('T')[0];
    } else if (preset.type === 'month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      start = firstDay.toISOString().split('T')[0];
    }

    onRangeChange?.({ startDate: start, endDate: end });
  };

  return (
    <div className={`lds-date-range-picker ${className}`.trim()} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {presets.map((p, idx) => (
          <button
            key={idx}
            type="button"
            className="btn btn--sm"
            onClick={() => applyPreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <input
          type="date"
          value={startDate}
          onChange={(e) => onRangeChange?.({ startDate: e.target.value, endDate })}
          className="input input--sm"
        />
        <span className="muted" style={{ fontSize: '12px' }}>to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => onRangeChange?.({ startDate, endDate: e.target.value })}
          className="input input--sm"
        />
      </div>
    </div>
  );
}

export default {
  DatePicker,
  DateRangePicker,
};
