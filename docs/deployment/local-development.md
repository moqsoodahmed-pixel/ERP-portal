# Local development

## Option 1: Docker Compose (recommended)

```sh
docker compose up
```

Starts MongoDB, the backend (`node --watch`, hot reload), and the frontend (Vite dev server) together.
The throw-away dev secrets in `docker-compose.yml` are public and must never be reused anywhere else.

- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- MongoDB: localhost:27017

## Option 2: Run backend and frontend directly

```sh
# Terminal 1 — MongoDB must already be running locally or reachable via MONGODB_URI
cd backend
cp .env.example .env   # fill in values; see environment-variables.md
npm install
npm run seed            # optional: creates demo tenants/users, safe to re-run
npm run dev

# Terminal 2
cd frontend
cp .env.example .env
npm install
npm run dev
```

## Verifying the setup

```sh
curl http://localhost:4000/health   # {"status":"ok"}
curl http://localhost:4000/ready    # {"status":"ready"}  (503 if MongoDB isn't reachable)
curl http://localhost:4000/version  # {"version":"0.1.0","env":"development"}
```

Log in at http://localhost:5173 with one of the seeded accounts printed by `npm run seed`.
