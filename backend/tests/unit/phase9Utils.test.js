import '../helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../../src/utils/csv.js';
import { resolveDateRange, MAX_RANGE_DAYS } from '../../src/utils/dateRange.js';

test('csvCell: RFC 4180 quoting for comma, quote, CR/LF', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell('x\r\ny'), '"x\r\ny"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(new Date('2026-04-01T00:00:00Z')), '2026-04-01T00:00:00.000Z');
});

test('csvCell: OWASP formula-injection neutralisation (=, +, -, @, TAB, CR) but plain numbers untouched', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+SUM(A1)'), "'+SUM(A1)");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('\tTAB'), "'\tTAB");
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell('-12.50'), '-12.50');
  assert.equal(csvCell('236.00'), '236.00');
  assert.equal(csvCell(0), '0');
});

test('toCsv: header + CRLF rows + value accessors', () => {
  const out = toCsv([{ key: 'a', header: 'A' }, { key: 'b', header: 'B, total', value: (r) => r.b * 2 }], [{ a: 'x', b: 2 }]);
  assert.equal(out, 'A,"B, total"\r\nx,4\r\n');
});

test('resolveDateRange: presets computed in UTC relative to a fixed now', () => {
  const now = new Date('2026-10-03T15:30:00Z'); // a Saturday
  const iso = (r) => [r.from.toISOString(), r.to.toISOString()];
  assert.deepEqual(iso(resolveDateRange({ range: 'today' }, { now })), ['2026-10-03T00:00:00.000Z', '2026-10-03T23:59:59.999Z']);
  assert.deepEqual(iso(resolveDateRange({ range: 'this_week' }, { now })), ['2026-09-28T00:00:00.000Z', '2026-10-04T23:59:59.999Z']);
  assert.deepEqual(iso(resolveDateRange({ range: 'this_month' }, { now })), ['2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z']);
  assert.deepEqual(iso(resolveDateRange({ range: 'previous_month' }, { now })), ['2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z']);
  assert.deepEqual(iso(resolveDateRange({ range: 'this_quarter' }, { now })), ['2026-10-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z']);
  assert.deepEqual(iso(resolveDateRange({}, { now })), ['2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z'], 'default preset');
  const jan = new Date('2026-01-15T00:00:00Z');
  assert.deepEqual(iso(resolveDateRange({ range: 'previous_month' }, { now: jan })), ['2025-12-01T00:00:00.000Z', '2025-12-31T23:59:59.999Z'], 'year rollover');
  assert.deepEqual(iso(resolveDateRange({ range: 'custom', from: '2026-04-01', to: '2026-04-30' }, { now })), ['2026-04-01T00:00:00.000Z', '2026-04-30T23:59:59.999Z']);
  assert.equal(resolveDateRange({ from: '2026-04-01', to: '2026-04-02' }, { now }).preset, 'custom', 'from/to imply custom');
});

test('resolveDateRange: rejects inverted, incomplete, unbounded and unknown ranges', () => {
  assert.throws(() => resolveDateRange({ range: 'custom', from: '2026-05-01', to: '2026-04-01' }), /on or before/);
  assert.throws(() => resolveDateRange({ range: 'custom', from: '2026-05-01' }), /both from and to/);
  assert.throws(() => resolveDateRange({ range: 'custom', from: '2023-01-01', to: '2026-01-01' }), new RegExp(`${MAX_RANGE_DAYS} days`));
  assert.throws(() => resolveDateRange({ range: 'forever' }), /range must be one of/);
  assert.doesNotThrow(() => resolveDateRange({ range: 'custom', from: '2024-04-01', to: '2026-03-31' }));
});
