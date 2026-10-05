/**
 * RFC 4180 CSV generation with OWASP CSV-injection neutralisation.
 *  - A cell whose text begins with =, +, -, @, TAB or CR is prefixed with a single quote so spreadsheet
 *    applications treat it as text, never as a formula. Plain numeric values (e.g. "-12.50", "236.00") are
 *    left untouched because they cannot carry a formula payload.
 *  - Any cell containing a comma, double quote, CR or LF is wrapped in double quotes with quotes doubled.
 * Lines are CRLF-terminated.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** columns: [{ key, header, value?: (row) => any }] */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value ? c.value(row) : row[c.key])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
