const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
export function durationToMs(value) {
  const m = /^(\d+)\s*([smhd])$/.exec(String(value).trim());
  if (!m) throw new Error(`Invalid duration "${value}" (use e.g. 15m, 7d)`);
  return Number(m[1]) * UNITS[m[2]];
}
