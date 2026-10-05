import { sanitizeInPlace } from '../utils/sanitize.js';

/** Strips Mongo operator keys ($...) and dotted keys from body, query and params before any validation or query building. */
export function sanitizeInput(req, res, next) {
  sanitizeInPlace(req.body); sanitizeInPlace(req.query); sanitizeInPlace(req.params);
  next();
}
