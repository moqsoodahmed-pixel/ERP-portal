# Frontend

React + Vite. `npm run dev` (proxies `/api` to the backend), `npm run build`, `npm test`, `npm run lint`.
Access token is held in memory only; the refresh token is an httpOnly cookie managed by the API. The UI never sends tenant/user/role identifiers. Route guards and permission-aware navigation are UX only; the server enforces access.
