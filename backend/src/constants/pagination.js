export const PAGINATION = Object.freeze({ DEFAULT_PAGE: 1, DEFAULT_LIMIT: 20, MAX_LIMIT: 100, MAX_SEARCH_LENGTH: 100 });
export const HEADERS = Object.freeze({
  REQUEST_ID: 'x-request-id',
  ADMIN_TENANT: 'x-admin-tenant-id',
  IDEMPOTENCY_KEY: 'idempotency-key',
});
export const ID_PREFIX = Object.freeze({
  product: 'PROD', customer: 'CUST', invoice: 'INV', vendor: 'VEND', tenant: 'TNT', creditNote: 'CN', debitNote: 'DN',
});
