const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const err = (description) => ({ description, content: json(ref('Error')) });
const std = { 401: err('Unauthenticated'), 403: err('Forbidden (role, permission or tenant)'), 429: err('Rate limited') };
const secured = [{ bearerAuth: [] }];
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, description: 'Maximum 100 (enforced server-side)' },
  { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } },
  { name: 'status', in: 'query', schema: { type: 'string' } },
  { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
  { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
  { name: 'sort', in: 'query', schema: { type: 'string', example: '-createdAt' }, description: 'Whitelisted fields only' },
];
const adminTenant = { name: 'X-Admin-Tenant-Id', in: 'header', required: false, schema: { type: 'string' }, description: 'MASTER_ADMIN only: explicit, audited tenant context. Ignored/forbidden for other roles — tenant is derived server-side.' };
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const op = (tag, summary, extra = {}) => ({ tags: [tag], summary, security: secured, responses: { 200: { description: 'OK', content: json(ref('Success')) }, ...std }, ...extra });
const placeholder = (tag, summary) => op(tag, `${summary} — PLACEHOLDER (not implemented)`, { responses: { 501: err('NOT_IMPLEMENTED'), ...std } });
const body = (name) => ({ requestBody: { required: true, content: json(ref(name)) } });
const q = (name, schema, description) => ({ name, in: 'query', schema, ...(description ? { description } : {}) });
const rangeParams = [
  q('range', { type: 'string', enum: ['today', 'this_week', 'this_month', 'previous_month', 'this_quarter', 'custom'] }, 'Default this_month (dashboards). UTC boundaries.'),
  q('from', { type: 'string', format: 'date' }, 'Required with range=custom (or implies custom)'),
  q('to', { type: 'string', format: 'date' }, 'Inclusive. Custom ranges: from <= to and at most 731 days, else 400'),
];
const reportType = { name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['invoice-summary', 'gst-summary', 'tally-sync', 'gst-filing-status', 'gst-filing-issues', 'customer-summary'] } };
const reportParams = [reportType, ...rangeParams, q('page', { type: 'integer' }), q('limit', { type: 'integer', maximum: 100 }), q('status', { type: 'string' }), q('returnType', { type: 'string' }), q('severity', { type: 'string' }), q('issueType', { type: 'string' })];
const csv = (summary, extra = {}) => op('Reports', summary, {
  responses: { 200: { description: 'text/csv attachment (RFC 4180, formula-injection neutralised)', content: { 'text/csv': { schema: { type: 'string' } } } }, 422: err('EXPORT_ROW_LIMIT_EXCEEDED (more than 10,000 rows; never silently truncated)'), ...std },
  ...extra,
});

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'ERP Platform API', version: '0.1.0',
    description: 'Foundation API. Endpoints marked PLACEHOLDER return 501 NOT_IMPLEMENTED. Designed for DPDP compliance readiness and ISO/IEC 27001:2022 alignment; no certification or legal compliance is claimed.',
  },
  servers: [{ url: '/api/v1' }],
  tags: ['Auth', 'Users', 'Clients', 'Products', 'Customers', 'Invoices', 'GST', 'Vendors', 'Tally', 'Dashboards', 'Reports', 'Notifications', 'Audit logs', 'Data requests'].map((name) => ({ name })),
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Success: { type: 'object', properties: { success: { type: 'boolean', example: true }, data: {}, message: { type: 'string' }, requestId: { type: 'string' } } },
      Error: { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'object' } } } }, requestId: { type: 'string' } } },
      LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } },
      ChangePasswordRequest: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 12 } } },
      ProductRequest: { type: 'object', required: ['productName', 'sellingPrice'], properties: { productName: { type: 'string' }, type: { enum: ['PRODUCT', 'SERVICE'] }, hsnSacCode: { type: 'string' }, unit: { type: 'string' }, sellingPrice: { type: 'string', example: '1499.00' }, gstRate: { type: 'number' }, isGstApplicable: { type: 'boolean' } } },
      CustomerRequest: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, gstin: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } } },
      InvoiceRequest: { type: 'object', required: ['customerId', 'invoiceDate', 'gstApplicable', 'items'], properties: { customerId: { type: 'string' }, invoiceDate: { type: 'string', format: 'date' }, gstApplicable: { type: 'boolean' }, interState: { type: 'boolean' }, items: { type: 'array', items: { type: 'object', required: ['productId', 'quantity'], properties: { productId: { type: 'string' }, quantity: { type: 'string', example: '2' }, unitPrice: { type: 'string' }, discount: { type: 'string' }, gstRate: { type: 'number' } } } } } },
      ClientRequest: { type: 'object', required: ['businessName'], properties: { businessName: { type: 'string' }, gstin: { type: 'string' }, email: { type: 'string' }, admin: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' } } } } },
    },
  },
  paths: {
    '/auth/login': { post: { tags: ['Auth'], summary: 'Login (sets httpOnly refresh cookie, returns short-lived access token)', ...body('LoginRequest'), responses: { 200: { description: 'OK', content: json(ref('Success')) }, 401: err('Invalid credentials'), 429: err('Rate limited') } } },
    '/auth/refresh': { post: { tags: ['Auth'], summary: 'Rotate refresh token (cookie). Reuse of a rotated token revokes the whole token family.', responses: { 200: { description: 'OK' }, 401: err('Invalid refresh token') } } },
    '/auth/logout': { post: { tags: ['Auth'], summary: 'Revoke refresh token family', responses: { 200: { description: 'OK' } } } },
    '/auth/me': { get: op('Auth', 'Current user profile and effective permissions') },
    '/auth/change-password': { post: op('Auth', 'Change password (revokes all sessions)', body('ChangePasswordRequest')) },
    '/users': { get: op('Users', 'List tenant users', { parameters: [...pageParams, adminTenant] }), post: op('Users', 'Create tenant user', { parameters: [adminTenant] }) },
    '/clients': { get: op('Clients', 'List clients (MASTER_ADMIN)', { parameters: pageParams }), post: op('Clients', 'Create client + optional initial admin (MASTER_ADMIN)', body('ClientRequest')) },
    '/clients/stats': { get: op('Clients', 'Client counts by status (MASTER_ADMIN)') },
    '/clients/{id}': { get: op('Clients', 'Get client', { parameters: [idParam] }), patch: op('Clients', 'Update client', { parameters: [idParam] }) },
    '/clients/{id}/status': { patch: op('Clients', 'Activate / suspend / deactivate client', { parameters: [idParam] }) },
    '/products': { get: op('Products', 'List products (tenant-scoped)', { parameters: [...pageParams, adminTenant] }), post: op('Products', 'Create product (unique code PROD-000001 per tenant)', { parameters: [adminTenant], ...body('ProductRequest') }) },
    '/products/{id}': { get: op('Products', 'Get product', { parameters: [idParam] }), patch: op('Products', 'Update product', { parameters: [idParam] }), delete: op('Products', 'Archive product (soft delete)', { parameters: [idParam] }) },
    '/customers': { get: op('Customers', 'List customers', { parameters: [...pageParams, adminTenant] }), post: op('Customers', 'Create customer', { parameters: [adminTenant], ...body('CustomerRequest') }) },
    '/customers/{id}': { get: op('Customers', 'Get customer', { parameters: [idParam] }), patch: op('Customers', 'Update customer', { parameters: [idParam] }), delete: op('Customers', 'Archive customer', { parameters: [idParam] }) },
    '/invoices': {
      get: op('Invoices', 'List invoices', { parameters: [...pageParams, adminTenant] }),
      post: op('Invoices', 'Create DRAFT invoice (supports Idempotency-Key). GST maths is a foundation implementation pending review.', {
        parameters: [adminTenant, { name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }], ...body('InvoiceRequest'),
      }),
    },
    '/invoices/export': { get: csv('Invoice export (Phase 9): the invoice-summary report as CSV; requires invoices.export; audited', { tags: ['Invoices'], parameters: [...rangeParams, q('status', { type: 'string' }), adminTenant] }) },
    '/invoices/{id}': {
      get: op('Invoices', 'Get invoice', { parameters: [idParam] }),
      patch: op('Invoices', 'Edit a DRAFT invoice (recomputed server-side; rejected once ISSUED/CANCELLED)', { parameters: [idParam], ...body('InvoiceRequest') }),
    },
    '/invoices/{id}/issue': { post: op('Invoices', 'DRAFT -> ISSUED. Recomputes authoritative totals and freezes the invoice.', { parameters: [idParam] }) },
    '/invoices/{id}/cancel': { post: op('Invoices', 'Cancel invoice from DRAFT or ISSUED (never deleted); requires a reason', { parameters: [idParam] }) },
    '/vendors': { get: op('Vendors', 'List GST vendors (MASTER_ADMIN)', { parameters: pageParams }), post: op('Vendors', 'Create vendor + vendor login (MASTER_ADMIN)') },
    '/vendors/{vendorId}/assignments': { post: op('Vendors', 'Assign vendor to client (MASTER_ADMIN)', { parameters: [{ name: 'vendorId', in: 'path', required: true, schema: { type: 'string' } }] }) },
    '/vendors/{vendorId}/assignments/{tenantId}': { delete: op('Vendors', 'Unassign vendor from client (MASTER_ADMIN)', { parameters: [{ name: 'vendorId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } }] }) },
    '/vendors/me/clients': { get: op('Vendors', 'Clients assigned to the authenticated vendor') },
    '/vendors/me/clients/{tenantId}/invoices': { get: op('Vendors', 'Invoices of an ASSIGNED client (403 if not assigned)', { parameters: [...pageParams, { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } }] }) },
    '/gst/filings': { get: placeholder('GST', 'List GST filings') },
    '/gst/filings/{id}/status': { patch: placeholder('GST', 'Update GST filing status') },
    '/tally/status': { get: op('Tally', 'Tally integration status (always reports not implemented in this phase)', { parameters: [adminTenant] }) },
    '/tally/sync': { post: placeholder('Tally', 'Request Tally sync') },
    '/dashboard': { get: op('Dashboards', 'Client dashboard (tenant from session / X-Admin-Tenant-Id). Server-side aggregation; not-applicable metrics are {available:false, reason}.', { parameters: [...rangeParams, adminTenant] }) },
    '/master/dashboard': { get: op('Dashboards', 'Master Admin platform dashboard (Phase 2 fields + filing pipeline, open issues, Tally sync health, security event counts). MASTER_ADMIN only.', { parameters: rangeParams }) },
    '/vendors/me/dashboard': { get: op('Dashboards', "GST vendor dashboard: filing pipeline/open issues across the vendor's ACTIVE assignments to ACTIVE tenants only") },
    '/reports': { get: op('Reports', 'Report catalog: report types the caller may run (reports.view + per-report module permission)') },
    '/reports/{type}': { get: op('Reports', 'Tenant-scoped report: paginated rows + server-side summary over the full filtered set', { parameters: [...reportParams, adminTenant] }) },
    '/reports/{type}/export': { get: csv('Tenant-scoped synchronous CSV export (reports.export; max 10,000 rows; audited as DATA_EXPORT)', { parameters: [...reportParams, adminTenant] }) },
    '/master/reports/{type}': { get: op('Reports', 'Cross-tenant filing reports (gst-filing-status / gst-filing-issues only). MASTER_ADMIN only.', { parameters: [...reportParams, q('clientId', { type: 'string' })] }) },
    '/master/reports/{type}/export': { get: csv('Cross-tenant filing report CSV export. MASTER_ADMIN only.', { parameters: [...reportParams, q('clientId', { type: 'string' })] }) },
    '/vendors/me/clients/{tenantId}/reports/{type}': { get: op('Reports', 'Vendor report for ONE assigned client (requires an ACTIVE assignment to an ACTIVE tenant; 403 otherwise). No customer-summary, no export.', { parameters: [{ name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } }, ...reportParams] }) },
    '/notifications': { get: op('Notifications', "Caller's own notifications, newest first (recipient always derived from the session)", { parameters: [q('page', { type: 'integer' }), q('limit', { type: 'integer', maximum: 50 }), q('unread', { type: 'string', enum: ['true', 'false'] })] }) },
    '/notifications/unread-count': { get: op('Notifications', "Unread count for the caller's own notifications") },
    '/notifications/read-all': { patch: op('Notifications', "Mark all of the caller's own notifications read") },
    '/notifications/{id}/read': { patch: op('Notifications', "Mark one of the caller's own notifications read (idempotent). Another user's id -> 404.", { parameters: [idParam], responses: { 200: { description: 'OK' }, 404: err('Not found (or not yours)'), ...std } }) },
    '/data-requests': { get: placeholder('Data requests', 'Data principal request workflows'), post: placeholder('Data requests', 'Create data request') },
    '/audit-logs': { get: op('Audit logs', 'List audit logs (MASTER_ADMIN)', { parameters: [...pageParams, { name: 'tenantId', in: 'query', schema: { type: 'string' } }, { name: 'action', in: 'query', schema: { type: 'string' } }] }) },
  },
};
