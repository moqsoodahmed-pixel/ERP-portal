# MongoDB / Atlas

## Connection configuration (already implemented)

`backend/src/config/database.js`:
- `serverSelectionTimeoutMS: 5000` — fails fast if no server is reachable at startup, instead of hanging.
- `socketTimeoutMS: 45000` — bounds how long an individual operation can hang on a dead/partitioned socket.
- `maxPoolSize: 20` — connection pool cap per backend process.
- Runtime `error` / `disconnected` / `reconnected` events on `mongoose.connection` are logged (never with
  the connection string) so a network partition or replica-set failover is visible in logs instead of
  silently failing requests.
- `/ready` reflects `mongoose.connection.readyState === 1`, so a load balancer or orchestrator can detect
  "process is up but DB isn't reachable" and route around it.

## Recommended Atlas configuration (for Option B, and optionally Option A)

- **Cluster tier**: M10+ for production (free/shared tiers have connection and throughput limits
  unsuitable for a multi-tenant ERP under real load).
- **Replica set**: Atlas clusters are replica sets by default — required for the automatic failover that
  `socketTimeoutMS`/`serverSelectionTimeoutMS` above are written to tolerate.
- **Network access**: restrict to the specific EC2/Render egress IP ranges, not `0.0.0.0/0`.
- **Database user**: a dedicated user scoped to the application database only (not an Atlas admin user),
  with a generated (not memorable) password stored in your secret manager, not in `.env` committed
  anywhere.
- **Encryption at rest**: enabled by default on Atlas; verify it's on for self-hosted MongoDB instead
  (see below).
- **TLS**: Atlas connection strings use TLS by default; keep it enabled.
- **Backups**: see [backup-restore.md](./backup-restore.md).

## Self-hosted MongoDB (if not using Atlas)

- Enable authentication (`--auth`) and encryption at rest.
- Run as a replica set even with one data-bearing member, so the driver's retry/failover behavior
  (already configured above) functions as intended and so `mongodump --oplog` snapshots are consistent.
- Restrict network access to the application host(s) only (security group / firewall, not public).
- Automate backups — see [backup-restore.md](./backup-restore.md); nothing in this repository backs up
  the database for you.

## Indexes

All required indexes are declared directly on the Mongoose schemas (see `docs/database.md` for the full
list) and are created automatically via Mongoose's default `autoIndex` behavior when models are first
registered at startup. This is appropriate at this project's current scale. For a large existing
production dataset, consider setting `autoIndex: false` and running `Model.ensureIndexes()` as a
controlled, observed step during deployment instead of implicitly on every boot — not necessary today,
noted here for when data volume grows.
