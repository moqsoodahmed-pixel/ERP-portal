# Backup & restore

No backup automation exists in this repository, and no backup has actually been taken or tested as part
of this work — the following is recommended configuration, not a verified, running backup system.

## Recommended backup strategy

### MongoDB Atlas (recommended for both deployment options)

- Enable **Atlas Cloud Backups** (continuous/snapshot backups) on the cluster.
- Frequency: continuous (point-in-time recovery) if on an M10+ tier, or at minimum daily snapshots.
- Retention: keep daily snapshots for 7 days, weekly for 4 weeks, monthly for 12 months — adjust to your
  actual compliance/retention requirements (see `docs/compliance/dpdp/retention-policy.md`).
- Encryption: Atlas backups are encrypted at rest by default; confirm this is enabled for your project.
- Off-site: Atlas stores backups independently of your cluster's region/infrastructure by design;
  additionally exporting periodic snapshots to a separate cloud storage bucket in a different region/
  provider is a reasonable extra safeguard for disaster recovery, not implemented here.

### Self-hosted MongoDB

- Schedule `mongodump --oplog` (consistent snapshot of a replica set) via cron, writing to storage
  separate from the database host.
- Encrypt backup archives at rest (e.g. `gpg` or server-side encryption on the storage bucket) and in
  transit.
- Store off-site (different host/region/provider than the database itself) — a backup on the same disk
  as the database protects against nothing.
- Retention: same guidance as above.

### Document/PDF storage

Local-filesystem-stored documents (see [file-storage.md](./file-storage.md)) should be included in
whatever backup covers the EC2 instance's EBS volume (e.g. automated EBS snapshots), since they are not
currently in MongoDB. This is a separate backup target from the database and must be covered explicitly.

## RPO / RTO (targets, not guarantees — depend on your actual backup configuration above)

- **RPO** (acceptable data loss): with Atlas continuous backup, effectively near-zero; with daily
  snapshots, up to 24 hours.
- **RTO** (acceptable downtime to restore): depends on data volume and whether you've rehearsed the
  restore procedure below — budget at least a few hours for an untested first restore, less once
  practiced.

## Restore testing

**Not performed as part of this phase.** Restore testing requires an actual backup and a disposable
environment to restore into — neither exists yet in this repository's scope. Treat
[restore procedure](#restore-procedure-runbook) below as unverified until it has actually been run once
against a real snapshot.

## Restore procedure (runbook)

1. Provision a clean MongoDB environment (new Atlas cluster or a fresh self-hosted instance).
2. Restore the backup (`mongorestore` for self-hosted dumps, or Atlas's point-in-time/snapshot restore
   UI for Atlas).
3. Validate indexes exist and match `docs/database.md` — Mongoose recreates them automatically on
   application startup via `autoIndex`, but confirm no index build is still in progress before serving
   traffic at scale.
4. Validate the application version being deployed against this restored data matches a known-compatible
   release (check `GET /version` once started).
5. Validate environment configuration points at the restored database (`MONGODB_URI`) and all other
   required variables are set — see [environment-variables.md](./environment-variables.md).
6. Start the backend; confirm `GET /health` returns `200`.
7. Confirm `GET /ready` returns `200` (verifies the restored database is actually reachable).
8. Run the [smoke-test checklist](./smoke-tests.md) against the restored environment end-to-end before
   considering it usable.
9. Only then switch production traffic (DNS/load balancer) to the restored environment.
