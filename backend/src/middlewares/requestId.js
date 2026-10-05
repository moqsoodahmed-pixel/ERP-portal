import crypto from 'node:crypto';
import { HEADERS } from '../constants/pagination.js';

export function requestId(req, res, next) {
  const incoming = req.get(HEADERS.REQUEST_ID);
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
