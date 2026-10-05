# Backend

See the root README for setup. Useful commands: `npm run dev | start | seed | lint | test | test:unit | test:integration | audit:deps`.
API docs: `/api/docs` (Swagger UI) and `/api/v1/openapi.json`. Health: `GET /health`, `GET /ready`.
Tests: `tests/unit` (pure logic), `tests/api` (HTTP via supertest on an in-memory fake DB injected through `src/container.js`), `tests/integration` (real MongoDB; skipped unless available).
