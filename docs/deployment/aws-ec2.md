# AWS EC2 + PM2 + Nginx (Option A)

This is a runbook, not a record of an environment that was actually provisioned. Replace every
`<placeholder>` before use.

## 1. Provision the instance

- Ubuntu 22.04 LTS (or similar), sized for expected load — start with a small instance and scale up;
  this application is a single Node.js process today (see [file-storage.md](./file-storage.md) for why
  it isn't horizontally scaled yet).
- Security group: allow 443 (and 80, for the HTTP→HTTPS redirect) from the internet; allow 22 (SSH) only
  from your own IP range; do **not** expose port 4000 (the backend) publicly — only Nginx should reach it,
  over `127.0.0.1`.
- Attach a persistent EBS volume (not instance store) if using local document storage, so generated
  PDFs survive an instance stop/start.

## 2. Install dependencies

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
```

## 3. Deploy the backend

```sh
git clone <your-repo-url> /var/www/erp
cd /var/www/erp/backend
npm ci --omit=dev
cp .env.example .env   # fill in real production values — see environment-variables.md
```

Set `NODE_ENV=production` and `TRUST_PROXY=1` in `.env` (Nginx is the single proxy hop in front).

```sh
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # follow the printed instructions to start PM2 on boot
```

`ecosystem.config.js` runs a single fork-mode instance (see the comment at the top of that file for why
not cluster mode yet), restarts on crash with backoff, and caps memory at 400MB before restarting.

## 4. Deploy the frontend

```sh
cd /var/www/erp/frontend
npm ci
VITE_API_BASE_URL=/api/v1 npm run build
sudo mkdir -p /var/www/erp-frontend
sudo cp -r dist/* /var/www/erp-frontend/
```

(Or build `frontend/Dockerfile.prod` and extract `dist/` from the image — same output either way.)

## 5. Configure Nginx

```sh
sudo cp infrastructure/nginx/nginx.conf.example /etc/nginx/sites-available/erp.conf
# edit: replace erp.example.com, set `root` to /var/www/erp-frontend (or wherever you copied dist/)
sudo ln -s /etc/nginx/sites-available/erp.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. TLS

```sh
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erp.example.com
```

Certbot edits the Nginx config in place and sets up auto-renewal; re-run `nginx -t` after.

## 7. Verify

```sh
curl https://erp.example.com/health
curl https://erp.example.com/ready
curl https://erp.example.com/version
```

Then run through the [smoke-test checklist](./smoke-tests.md) against the real domain before
considering the deployment live.

## Log rotation

```sh
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

## Redeploying (new version)

```sh
cd /var/www/erp
git pull
cd backend && npm ci --omit=dev && pm2 reload erp-backend   # reload = graceful, not restart
cd ../frontend && npm ci && npm run build && sudo cp -r dist/* /var/www/erp-frontend/
```

`pm2 reload` sends SIGTERM to the old process (which the app handles gracefully — see
`backend/src/server.js`) and starts the new one, so in-flight requests on the old process get a chance
to finish. With a single instance this is a brief interruption, not zero-downtime — see
[rollback.md](./rollback.md) for what "zero downtime" would actually require here.
