import { ValidationError } from '../utils/errors.js';

/** validate({ body, query, params }) — parsed (coerced, stripped) values replace the originals. */
export const validate = (schemas) => (req, res, next) => {
  const details = [];
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (result.success) {
      if (part === 'query') { for (const k of Object.keys(req.query)) delete req.query[k]; Object.assign(req.query, result.data); }
      else req[part] = result.data;
    } else {
      details.push(...result.error.issues.map((i) => ({ in: part, path: i.path.join('.'), message: i.message })));
    }
  }
  return details.length ? next(new ValidationError('Invalid request', details)) : next();
};
