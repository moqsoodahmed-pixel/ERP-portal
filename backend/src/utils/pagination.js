import { PAGINATION } from '../constants/pagination.js';

export function parsePagination(query = {}) {
  const page = Math.max(PAGINATION.DEFAULT_PAGE, Number.parseInt(query.page, 10) || PAGINATION.DEFAULT_PAGE);
  const requested = Number.parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, requested), PAGINATION.MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

/** sort=-createdAt,name -> {createdAt:-1,name:1}, restricted to a whitelist. */
export function parseSort(sort, allowed, fallback = { createdAt: -1 }) {
  if (typeof sort !== 'string' || !sort) return fallback;
  const out = {};
  for (const part of sort.split(',').slice(0, 3)) {
    const desc = part.startsWith('-');
    const field = desc ? part.slice(1) : part;
    if (allowed.includes(field)) out[field] = desc ? -1 : 1;
  }
  return Object.keys(out).length ? out : fallback;
}

export const buildPageMeta = ({ page, limit }, total) => ({
  page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)),
});

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
