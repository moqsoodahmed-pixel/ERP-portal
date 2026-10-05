# API guidelines

- Base path `/api/v1`; OpenAPI at `/api/v1/openapi.json`, Swagger UI at `/api/docs`.
- Envelope: success `{ success, data, message, requestId }`; error `{ success:false, error:{ code, message, details }, requestId }`. Stack traces are never returned; internal errors are logged with the `requestId` (also sent as `X-Request-Id`).
- Error codes: `VALIDATION_ERROR 400`, `AUTHENTICATION_ERROR/TOKEN_* 401`, `AUTHORIZATION_ERROR 403`, `TENANT_ACCESS_ERROR 403`, `NOT_FOUND 404`, `CONFLICT 409`, `PAYLOAD_TOO_LARGE 413`, `RATE_LIMIT_EXCEEDED 429`, `NOT_IMPLEMENTED 501`, `INTEGRATION_ERROR 502`, `INTERNAL_ERROR 500`.
- **Pagination**: `?page=1&limit=20`, `limit` max 100 (values above are rejected). Response `data = { items, pagination:{ page, limit, total, totalPages } }`.
- **Search/filter/sort**: `search` (<= 100 chars, regex-escaped), `status`, `from`/`to` (date range), `sort=-createdAt,name` against a per-resource whitelist.
- **Idempotency**: send `Idempotency-Key` (8-128 chars `[A-Za-z0-9_-]`) on `POST /invoices`. Same key + same body replays the stored response (`Idempotent-Replay: true`); same key + different body -> 409 `IDEMPOTENCY_KEY_REUSED`; failed (non-2xx) requests release the key. Keys expire after 24h. Planned for Tally sync, GST status updates and webhooks.
- **Never send** `tenantId`, `userId`, `role`, `permissions` or computed totals; the server derives or recomputes them.
- **Rate limits** (per IP, configurable in `config/rateLimits.js`): general 600/15m, login 10/15m, refresh 60/15m, password change 5/h, upload 60/15m, integration 60/min.
- **Audit**: security-sensitive and business-critical mutations are recorded with actor, role, tenant, resource, IP, user agent, request id and before/after status.
- Placeholders return `501 NOT_IMPLEMENTED` and are flagged in OpenAPI.

## Phase 9: dashboards, reports, notifications
- **Dashboards.** `GET /dashboard` (tenant), `GET /master/dashboard` (Phase 2 fields plus filing/Tally/security aggregates) and `GET /vendors/me/dashboard` (ACTIVE assignments to ACTIVE tenants only) are all MongoDB aggregations.
  - `range=today|this_week|this_month|previous_month|this_quarter|custom` (`from`/`to`), with UTC boundaries. A custom range must have from <= to and span at most 731 days, else 400.
  - A metric that is not applicable is `{available:false, reason}`, never a fabricated zero. Payments are always not applicable because no payment workflow exists.
- **Reports.** `invoice-summary`, `gst-summary`, `tally-sync`, `gst-filing-status`, `gst-filing-issues`, `customer-summary`.
  - Routes: `/reports/:type` (tenant via resolveTenant), `/master/reports/:type` (filing reports, cross-tenant, MASTER_ADMIN only) and `/vendors/me/clients/:tenantId/reports/:type` (requireVendorAssignment chain).
  - Access needs `reports.view` plus the report's module permission. Query parameters are strict: an unknown parameter returns 400.
  - Totals are one aggregation over the full filtered set, never the sum of the returned page.
- **CSV.** `/reports/:type/export` and `/invoices/export` (formerly a 501 placeholder) are synchronous.
  - RFC 4180 quoting; OWASP formula-injection neutralisation (leading `'` on `= + - @ TAB CR` cells; plain numbers untouched).
  - A result over 10,000 rows returns `422 EXPORT_ROW_LIMIT_EXCEEDED`; it is never truncated.
  - Every export is audited as `DATA_EXPORT`. No job queue is involved.
- **Notifications.** `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`.
  - These require authentication only; every query is scoped to `req.auth.userId`, and another user's id returns 404.
  - Notifications are generated only inside services, after the authoritative transition: invoice issue/cancel, Tally sync success/failure, filing ready/submit/filed, issue opened/resolved, client status change, vendor assignment change.
  - Generation is idempotent through a unique `(recipientUserId, dedupKey)` index.
  - Email/SMS delivery remains the unimplemented `integrations/notifications` port.
