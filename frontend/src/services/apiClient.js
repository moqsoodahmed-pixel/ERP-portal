const BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

let accessToken = null;
let refreshing = null;
let onAuthFailure = () => {};

export const setAccessToken = (token) => { accessToken = token; };
export const setAuthFailureHandler = (fn) => { onAuthFailure = fn; };

export class ApiError extends Error {
  constructor(status, code, message, details = [], requestId) {
    super(message);
    this.name = 'ApiError';
    Object.assign(this, { status, code, details, requestId });
  }
}

export function refreshAccessToken() {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return false;
        const json = await res.json();
        accessToken = json.data.accessToken;
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function request(path, { method = 'GET', body, retry = true, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshAccessToken()) return request(path, { method, body, retry: false, headers });
    onAuthFailure();
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN_ERROR', e?.message ?? 'Something went wrong', e?.details, json?.requestId);
  }
  return json;
}

/** For binary responses (e.g. PDFs). Returns { blob, fileName } or throws ApiError on failure. */
async function requestBlob(path, { method = 'GET', retry = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
  });
  if (res.status === 401 && retry) {
    if (await refreshAccessToken()) return requestBlob(path, { method, retry: false });
    onAuthFailure();
  }
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN_ERROR', e?.message ?? 'Something went wrong', e?.details, json?.requestId);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const blob = await res.blob();
  return { blob, fileName: match?.[1] ?? 'invoice.pdf' };
}

/** The client never sends tenantId, userId, role or permissions: the server derives them from the session. */
export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body, opts) => request(path, { method: 'POST', body, ...opts }),
  put: (path, body, opts) => request(path, { method: 'PUT', body, ...opts }),
  patch: (path, body, opts) => request(path, { method: 'PATCH', body, ...opts }),
  delete: (path, opts) => request(path, { method: 'DELETE', ...opts }),
  getBlob: (path) => requestBlob(path),
  postBlob: (path) => requestBlob(path, { method: 'POST' }),
};

/** Master Admin's explicit per-request tenant context header (Phase 2 mechanism) — never a default global header. */
export const adminTenantHeaders = (tenantId) => ({ headers: { 'X-Admin-Tenant-Id': String(tenantId) } });

export const toQuery = (params) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
  const s = q.toString();
  return s ? `?${s}` : '';
};
