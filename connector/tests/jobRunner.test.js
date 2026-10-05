import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ErpClient } from '../src/api/erpClient.js';
import { LocalTallyAdapter } from '../src/tally/localTallyAdapter.js';
import { JobRunner } from '../src/jobs/runner.js';

const noopLogger = {
  info() {}, warn() {}, error() {},
};

/** A tiny mock ERP (Side A) that exercises the SAME HTTP contract the real ERP exposes under
 * /api/v1/tally/connector/*, so JobRunner + ErpClient can be tested without the full backend harness. */
function startMockErp({ jobs, onClaim, onResult }) {
  const calls = { heartbeats: 0, claims: [], results: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: status < 400, data, error: status >= 400 ? { code: 'ERR', message: 'error' } : undefined })); };
      if (req.url === '/api/v1/tally/connector/jobs' && req.method === 'GET') return send(200, jobs);
      if (req.url === '/api/v1/tally/connector/heartbeat' && req.method === 'POST') { calls.heartbeats += 1; return send(200, { ok: true }); }
      const claimMatch = /^\/api\/v1\/tally\/connector\/jobs\/([^/]+)\/claim$/.exec(req.url);
      if (claimMatch && req.method === 'POST') {
        calls.claims.push(claimMatch[1]);
        const result = onClaim(claimMatch[1]);
        return result ? send(200, result) : send(409, null);
      }
      const resultMatch = /^\/api\/v1\/tally\/connector\/jobs\/([^/]+)\/result$/.exec(req.url);
      if (resultMatch && req.method === 'POST') {
        calls.results.push({ jobId: resultMatch[1], body: JSON.parse(body) });
        onResult?.(resultMatch[1], JSON.parse(body));
        return send(200, { status: JSON.parse(body).status });
      }
      return send(404, null);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls })));
}

test('JobRunner: polls, claims, submits to mock Tally, and reports SUCCEEDED', async () => {
  const mock = await startMockErp({
    jobs: [{ id: 'job-1', type: 'SYNC_BILL_TO_TALLY', billIntakeId: 'bill-1' }],
    onClaim: (id) => ({ id, type: 'SYNC_BILL_TO_TALLY', payload: { billIntakeId: 'bill-1', billNumber: 'BILL-1', amount: '100.00' } }),
  });
  try {
    const erpClient = new ErpClient({ baseUrl: `http://127.0.0.1:${mock.port}`, connectorSecret: 'tconn_live_test', timeoutMs: 2000 });
    const tallyAdapter = new LocalTallyAdapter({ mode: 'mock', companyName: 'Co', logger: noopLogger });
    const runner = new JobRunner({ erpClient, tallyAdapter, logger: noopLogger });
    const processed = await runner.pollOnce();
    assert.equal(processed, 1);
    assert.deepEqual(mock.calls.claims, ['job-1']);
    assert.equal(mock.calls.results.length, 1);
    assert.equal(mock.calls.results[0].body.status, 'SUCCEEDED');
  } finally {
    mock.server.close();
  }
});

test('JobRunner: a claim conflict (409, lost the race) is handled safely without throwing', async () => {
  const mock = await startMockErp({ jobs: [{ id: 'job-2', type: 'SYNC_BILL_TO_TALLY', billIntakeId: 'bill-2' }], onClaim: () => null });
  try {
    const erpClient = new ErpClient({ baseUrl: `http://127.0.0.1:${mock.port}`, connectorSecret: 'tconn_live_test', timeoutMs: 2000 });
    const tallyAdapter = new LocalTallyAdapter({ mode: 'mock', companyName: 'Co', logger: noopLogger });
    const runner = new JobRunner({ erpClient, tallyAdapter, logger: noopLogger });
    await assert.doesNotReject(() => runner.pollOnce());
    assert.equal(mock.calls.results.length, 0);
  } finally {
    mock.server.close();
  }
});

test('JobRunner: never sends the connector secret in the request body, only the header', async () => {
  let sawSecretInBody = false;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (body.includes('tconn_live_')) sawSecretInBody = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: [] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const erpClient = new ErpClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, connectorSecret: 'tconn_live_SUPER_SECRET', timeoutMs: 2000 });
    await erpClient.listJobs();
    assert.equal(sawSecretInBody, false);
  } finally {
    server.close();
  }
});

test('JobRunner: heartbeatOnce swallows ERP errors rather than crashing the loop', async () => {
  const erpClient = { heartbeat: async () => { throw new Error('ERP down'); } };
  const tallyAdapter = new LocalTallyAdapter({ mode: 'mock', companyName: 'Co', logger: noopLogger });
  const runner = new JobRunner({ erpClient, tallyAdapter, logger: noopLogger });
  await assert.doesNotReject(() => runner.heartbeatOnce());
});
