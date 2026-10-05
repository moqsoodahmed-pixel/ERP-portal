import { ValidationError } from './errors.js';

/** Upper bound on any custom reporting window: keeps every aggregation's scanned range bounded. */
export const MAX_RANGE_DAYS = 731; // ~2 years
export const RANGE_PRESETS = Object.freeze(['today', 'this_week', 'this_month', 'previous_month', 'this_quarter', 'custom']);
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const endOfDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

/**
 * Resolves a dashboard/report date window. All boundaries are computed in UTC, matching how invoiceDate is
 * stored (date-only values parsed as UTC midnight) and the Phase 8 filing periodBounds() convention.
 * `to` is inclusive (end of day). Custom ranges must have from <= to and span at most MAX_RANGE_DAYS.
 */
export function resolveDateRange({ range, from, to } = {}, { now = new Date(), defaultPreset = 'this_month' } = {}) {
  const preset = range ?? (from || to ? 'custom' : defaultPreset);
  if (!RANGE_PRESETS.includes(preset)) throw new ValidationError(`range must be one of ${RANGE_PRESETS.join(', ')}`);
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  let start; let end;
  switch (preset) {
    case 'today': start = startOfDay(now); end = endOfDay(now); break;
    case 'this_week': {
      const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
      start = new Date(startOfDay(now).getTime() - dow * DAY_MS);
      end = new Date(start.getTime() + 7 * DAY_MS - 1);
      break;
    }
    case 'this_month': start = new Date(Date.UTC(y, m, 1)); end = new Date(Date.UTC(y, m + 1, 1) - 1); break;
    case 'previous_month': start = new Date(Date.UTC(y, m - 1, 1)); end = new Date(Date.UTC(y, m, 1) - 1); break;
    case 'this_quarter': {
      const q = Math.floor(m / 3) * 3; // calendar quarters coincide with Indian FY quarters (Apr-Jun = FY Q1)
      start = new Date(Date.UTC(y, q, 1)); end = new Date(Date.UTC(y, q + 3, 1) - 1);
      break;
    }
    default: {
      if (!from || !to) throw new ValidationError('A custom range requires both from and to');
      const f = new Date(from); const t = new Date(to);
      if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw new ValidationError('from/to must be valid dates');
      start = startOfDay(f); end = endOfDay(t);
      if (start > end) throw new ValidationError('from must be on or before to');
      if ((end - start) / DAY_MS > MAX_RANGE_DAYS) throw new ValidationError(`Date range may not exceed ${MAX_RANGE_DAYS} days`);
    }
  }
  return { preset, from: start, to: end };
}
