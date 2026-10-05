# Rollback procedure

## Deployment sequence (both targets)

1. Build the new frontend bundle and backend (no build step for the backend beyond `npm ci`).
2. Run the full test suite, lint, and `npm audit` — CI (`.github/workflows/ci.yml`) already does this on
   every PR; treat a red CI run as a hard stop, not something to deploy past.
3. Deploy (EC2: `pm2 reload` + copy `dist/`; Render: push/merge triggers its own build+deploy).
4. Run health checks (`/health`, then `/ready`) against the newly deployed instance.
5. Run the [smoke-test checklist](./smoke-tests.md) against the live environment.
6. If any of steps 4-5 fail, roll back immediately using the procedure below rather than debugging in
   production.

## Rolling back

**EC2/PM2**:
```sh
cd /var/www/erp
git checkout <previous-release-tag-or-commit>
cd backend && npm ci --omit=dev && pm2 reload erp-backend
cd ../frontend && npm ci && npm run build && sudo cp -r dist/* /var/www/erp-frontend/
curl https://<domain>/health && curl https://<domain>/ready
```
Tag releases (`git tag vX.Y.Z`) before deploying so "the previous release" is an unambiguous, known-good
commit rather than "whatever HEAD was an hour ago".

**Render**: use the dashboard's built-in rollback to redeploy a previous successful build — this is
simpler and safer than reproducing it manually, since Render tracks exact build artifacts per deploy.

## Database compatibility

This application has never introduced a breaking schema change requiring an explicit migration (Mongoose
schemas are additive; see [mongodb.md](./mongodb.md) on index creation). Before rolling back application
code, confirm the previous version doesn't depend on a field/shape that a newer version's data writes
might have changed — check the diff between the two versions' Mongoose schemas. If a future change ever
does require a real data migration, write it as an explicit, idempotent script (never an automatic
destructive migration) and document the rollback path for that specific change at that time.

## What this repository does NOT implement

No automatic rollback trigger exists (e.g. auto-revert on failed health check) — rollback is always a
deliberate, manual action by an operator, per the instruction not to implement automation that could
damage production data on a false signal.
