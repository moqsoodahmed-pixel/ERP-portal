import { serialize } from './serialize.js';

export function ok(req, res, data = null, message = 'Operation completed successfully', status = 200) {
  return res.status(status).json({ success: true, data: serialize(data), message, requestId: req.id });
}
export const created = (req, res, data, message = 'Resource created successfully') => ok(req, res, data, message, 201);
export const errorBody = (req, code, message, details = []) => ({
  success: false, error: { code, message, details }, requestId: req.id,
});
