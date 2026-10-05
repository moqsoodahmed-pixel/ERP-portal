/**
 * Phase 16 — ERP-facing HTTP client (Side B -> Side A). Uses the Node 18+ global `fetch`; no extra
 * dependency. Every call sends the connector secret in the `X-Tally-Connector-Secret` header (never a
 * query param, never logged) and never sends any other tenant's identifier — the ERP resolves tenant
 * identity from the credential itself (spec Step 8).
 */
export class ErpClient {
  constructor({
    baseUrl, connectorSecret, timeoutMs = 10_000, logger,
  }) {
    this.baseUrl = baseUrl;
    this.connectorSecret = connectorSecret;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  async #request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Tally-Connector-Secret': this.connectorSecret,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let json;
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      if (!res.ok) {
        const err = new Error(json?.error?.message ?? `ERP request failed (${res.status})`);
        err.status = res.status;
        err.code = json?.error?.code;
        throw err;
      }
      return json?.data ?? json;
    } finally {
      clearTimeout(timer);
    }
  }

  status() { return this.#request('GET', '/api/v1/tally/connector/status'); }

  heartbeat(payload) { return this.#request('POST', '/api/v1/tally/connector/heartbeat', payload); }

  listJobs() { return this.#request('GET', '/api/v1/tally/connector/jobs'); }

  claimJob(jobId) { return this.#request('POST', `/api/v1/tally/connector/jobs/${jobId}/claim`); }

  reportResult(jobId, result) { return this.#request('POST', `/api/v1/tally/connector/jobs/${jobId}/result`, result); }
}
