// PM2 process manager config for the AWS EC2 deployment target (Option A).
// Usage: pm2 start ecosystem.config.js --env production
//
// Instance strategy: fork mode, 1 instance. NOT cluster mode. Rationale (do not change without first
// adding shared/object storage - see docs/deployment/file-storage.md):
//   - Document/PDF storage is local-disk (backend/src/services/storage.service.js). Multiple instances
//     on the same host would each have separate in-memory login-attempt lockout counters are DB-backed
//     (fine), but a PDF written by instance A would 404 when served by instance B behind a round-robin
//     load balancer - that's the blocking constraint, not CPU headroom.
//   - If horizontal scaling is needed later, migrate storage.service.js to an S3-compatible adapter
//     first, then raise `instances` and switch `exec_mode` to 'cluster'.
//
// No secrets live in this file. All configuration is read from the environment (backend/.env in
// development, your process manager / secret manager's injected environment in production).
module.exports = {
  apps: [
    {
      name: 'erp-backend',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // SIGTERM is handled gracefully by src/server.js (closes the HTTP server, disconnects MongoDB,
      // hard-exits after 10s). Give PM2 a slightly longer window before it force-kills.
      kill_timeout: 12_000,
      // Crash-loop protection: PM2 won't restart more than this many times within min_uptime.
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 2_000,
      // Guards against a slow memory leak taking down the host; restarts the process, not the host.
      max_memory_restart: '400M',
      // stdout/stderr are structured JSON (pino). Pair with the `pm2-logrotate` module in production:
      //   pm2 install pm2-logrotate
      //   pm2 set pm2-logrotate:max_size 50M
      //   pm2 set pm2-logrotate:retain 14
      //   pm2 set pm2-logrotate:compress true
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
