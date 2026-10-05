# Deployment

This is the index for production deployment documentation. Everything here is **documented and
recommended guidance**, not a report of infrastructure that has actually been provisioned — no part of
this repository has been deployed to AWS, Render, or any production MongoDB cluster by this process.
Treat commands as a verified-correct starting point, not a substitute for running them yourself.

- [Local development](./local-development.md)
- [Environment variables](./environment-variables.md)
- [MongoDB / Atlas setup](./mongodb.md)
- [AWS EC2 + PM2 + Nginx](./aws-ec2.md)
- [Render](./render.md)
- [Health checks](./health-checks.md)
- [Backup & restore](./backup-restore.md)
- [Rollback procedure](./rollback.md)
- [File storage limitations](./file-storage.md)

## Supported deployment targets

| | Option A | Option B |
|---|---|---|
| Compute | AWS EC2 | Render |
| Process manager | PM2 | Render's own |
| Reverse proxy / TLS | Nginx (self-managed) | Render (managed) |
| Database | MongoDB (self-hosted) or Atlas | MongoDB Atlas |

Both targets run the same unmodified Node.js/Express backend and the same Vite-built static frontend.
Nothing in the application code is deployment-target-specific.

## Current state vs. what's deferred

Already implemented and verified in this repository: environment validation at startup, ordered startup
(env → DB → HTTP listener), `/health` and `/ready` endpoints, graceful shutdown on SIGTERM/SIGINT,
structured logging with secret redaction, rate limiting, CI (lint/test/build/audit) on every PR.

Deferred / requires action outside this repository: provisioning the actual EC2 instance or Render
service, DNS, TLS certificates, the Atlas cluster itself, configuring the real secret values, and wiring
any of this into a CD pipeline (CI currently does not deploy anywhere — see `.github/workflows/ci.yml`).
