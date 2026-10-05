# Authentication

- **Login** `POST /api/v1/auth/login` -> short-lived access JWT (15m default, HS256, `iss`/`aud` pinned, algorithm allow-list) in the response body, opaque refresh token in an **httpOnly, SameSite=Strict, Secure (prod)** cookie scoped to `/api/v1/auth`.
- **Access token content**: `sub` and a revocation counter `tv` only. Role, tenant, vendor and permissions are **re-read from the database on every request**; a forged/stale claim has no effect.
- **Refresh rotation**: every refresh atomically claims the presented token (`revokedAt` set) and issues a new one in the same *family*. Presenting an already-rotated token is treated as theft: the whole family is revoked and a `REFRESH_TOKEN_REUSE` security event (HIGH) is recorded.
- **Storage**: refresh tokens are stored only as HMAC-SHA256 (keyed by `JWT_REFRESH_SECRET`); a TTL index purges expired rows.
- **Revocation**: logout revokes the family; password change bumps `tokenVersion` (kills access tokens) and revokes all refresh tokens; disabling a user or suspending a tenant blocks the next request.
- **Passwords**: bcrypt (cost 12, configurable), policy >= 12 chars with upper/lower/digit, never returned or logged.
- **Brute force**: generic error for unknown user / wrong password / locked / inactive; dummy hash comparison equalises timing; N failures (default 5) lock the account for 15 minutes; login endpoint has its own rate limit; failures create audit + security events.
- **CSRF**: the only cookie is the refresh cookie (SameSite=Strict, path-scoped). All other calls use the `Authorization` header, which browsers do not attach cross-site.
- **Not implemented yet**: password reset (needs an email provider), MFA, SSO, device/session listing.
