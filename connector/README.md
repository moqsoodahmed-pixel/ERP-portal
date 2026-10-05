# Tally Connector (Phase 16, Side B)

A standalone Windows-runnable Node.js process that bridges the ERP's Tally Queue to a local TallyPrime
instance. It is NOT part of the ERP backend/frontend workspace and is never exposed to the public internet;
it only makes outbound connections (to the ERP cloud and to localhost/LAN TallyPrime).

See `../docs/integrations/tally-connector.md` for the full architecture, security model, and the exact
checklist for a first real TallyPrime test. **Real TallyPrime/TDL integration testing was not performed in
this environment** — `TALLY_MODE=mock` (the default) simulates a successful Tally import so the rest of the
pipeline (poll/claim/report, retry, idempotency) can be exercised and tested without a real Tally instance.

## Quick start

```bash
cp .env.example .env
# edit .env: set ERP_BASE_URL and TALLY_CONNECTOR_SECRET (from the ERP admin UI's "Register Connector")
npm start
```

## Scripts

- `npm start` — run the connector
- `npm test` — run the unit tests (mock Tally + mock ERP HTTP server, no real TallyPrime required)
- `npm run lint` — syntax-check every source file (zero-dependency project; no ESLint config bundled)
- `npm run build` — syntax-check the entrypoint (pure Node.js — no bundling step)

## Layout

```
src/
  api/erpClient.js        ERP-facing HTTP client (poll/claim/result/heartbeat)
  tally/tallyClient.js     Local TallyPrime XML-over-HTTP transport (protocol matches backend Phase 6)
  tally/localTallyAdapter.js  Builds the fixed voucher XML + mock/http submit modes
  jobs/runner.js           Poll -> claim -> submit -> report loop (no ERP business logic)
  config/index.js          All configuration, env-driven
  logger/index.js          Structured logging with secret redaction
  index.js                 Entrypoint
tests/                     Unit tests (mock ERP + mock Tally)
```
