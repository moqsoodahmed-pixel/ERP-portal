import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  TALLY_API_URL: z.string().optional().default(''),
  TALLY_API_KEY: z.string().optional().default(''),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY (base64, 32 bytes) is required'),
  ENCRYPTION_KEY_PREVIOUS: z.string().optional().default(''),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  COOKIE_SECURE: bool.optional(),
  RATE_LIMIT_DISABLED: bool.default('false'),
  /** Private, non-publicly-served root directory for generated documents (invoice PDFs, etc). Never on a static path. */
  DOCUMENT_STORAGE_PATH: z.string().optional().default(''),
  /** Phase 16.1 offline monitor: how long without a heartbeat before an ACTIVE connector is considered stale. */
  TALLY_CONNECTOR_OFFLINE_AFTER_SECONDS: z.coerce.number().int().positive().default(120),
  /** Phase 16.1 offline monitor: sweep interval. Single-instance in-process setInterval (see docs/integrations/tally-connector.md). */
  TALLY_CONNECTOR_MONITOR_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration (copy .env.example to .env):\n${issues}`);
}

const raw = parsed.data;
const isProd = raw.NODE_ENV === 'production';

if (isProd) {
  const secrets = [raw.JWT_ACCESS_SECRET, raw.JWT_REFRESH_SECRET, raw.ENCRYPTION_KEY];
  if (secrets.some((s) => /^(change-?me|dev-only|replace)/i.test(s))) {
    throw new Error('Production refuses to start with placeholder secrets');
  }
  if (raw.JWT_ACCESS_SECRET === raw.JWT_REFRESH_SECRET) throw new Error('JWT secrets must differ');
  if (raw.CORS_ORIGIN.includes('*')) throw new Error('Wildcard CORS origin is not allowed in production');
  if (raw.RATE_LIMIT_DISABLED) throw new Error('Rate limiting cannot be disabled in production');
}

export const env = Object.freeze({
  ...raw,
  isProd,
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  cookieSecure: raw.COOKIE_SECURE ?? isProd,
});
