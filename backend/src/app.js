import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { isDatabaseReady } from './config/database.js';
import { requestId } from './middlewares/requestId.js';
import { httpLogger } from './middlewares/httpLogger.js';
import { sanitizeInput } from './middlewares/sanitize.js';
import { createRateLimiters } from './middlewares/rateLimiters.js';
import { createAccessMiddlewares } from './middlewares/access.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { createV1Router } from './routes/v1.js';
import { openApiDocument } from './docs/openapi.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require('../package.json');
const MAX_BODY = '100kb';

export function createApp(container, { rateLimits = {}, isReady = isDatabaseReady } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(httpLogger);
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
    credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'X-Admin-Tenant-Id'],
  }));
  // Phase 15: bill document uploads are base64-encoded JSON (no multipart/multer stack exists in this
  // backend yet — see validators/billIntake.validators.js). A dedicated, larger body-size limit is scoped
  // to that one path only; every other route keeps the conservative 100kb default.
  app.use('/api/v1/bills', express.json({ limit: '30mb' }));
  app.use(express.json({ limit: MAX_BODY }));
  app.use(cookieParser());
  app.use(sanitizeInput);

  // Liveness / readiness: no infrastructure details are exposed.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/ready', (req, res) => (isReady() ? res.json({ status: 'ready' }) : res.status(503).json({ status: 'not_ready' })));
  // Deployment verification only: version + environment name, never secrets or dependency internals.
  app.get('/version', (req, res) => res.json({ version: APP_VERSION, env: env.NODE_ENV }));

  const limiters = createRateLimiters(rateLimits, { securityService: container.services.securityService });
  const access = createAccessMiddlewares({
    authService: container.services.authService, tenantRepo: container.repos.tenants, assignmentRepo: container.repos.assignments,
    invoiceRepo: container.repos.invoices, securityService: container.services.securityService, auditService: container.services.auditService,
    gstFilingRepo: container.repos.gstFilings, billRepo: container.repos.bills,
  });

  app.get('/api/v1/openapi.json', (req, res) => res.json(openApiDocument));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: 'ERP Platform API' }));
  app.use('/api/v1', limiters.general, createV1Router({ container, access, limiters }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
