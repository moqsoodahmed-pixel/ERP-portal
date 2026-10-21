import { ok, created } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { makeContext } from '../utils/context.js';
import { NotImplementedError } from '../utils/errors.js';
import { parsePagination, buildPageMeta } from '../utils/pagination.js';
import { serialize } from '../utils/serialize.js';

const ctx = makeContext;

export function createClientController({ clientService }) {
  return {
    list: asyncHandler(async (req, res) => ok(req, res, await clientService.list(req.query))),
    stats: asyncHandler(async (req, res) => ok(req, res, await clientService.stats())),
    get: asyncHandler(async (req, res) => ok(req, res, await clientService.get(req.params.id))),
    create: asyncHandler(async (req, res) => created(req, res, await clientService.create(ctx(req), req.body))),
    update: asyncHandler(async (req, res) => ok(req, res, await clientService.update(ctx(req), req.params.id, req.body))),
    setStatus: asyncHandler(async (req, res) => ok(req, res, await clientService.setStatus(ctx(req), req.params.id, req.body.status, req.body.reason))),
    summary: asyncHandler(async (req, res) => ok(req, res, await clientService.summary(req.params.id))),
    dashboard: asyncHandler(async (req, res) => ok(req, res, await clientService.dashboard())),
  };
}

export const createUserController = ({ userService }) => ({
  list: asyncHandler(async (req, res) => ok(req, res, await userService.list(ctx(req), req.query))),
  create: asyncHandler(async (req, res) => created(req, res, await userService.create(ctx(req), req.body))),
  update: asyncHandler(async (req, res) => ok(req, res, await userService.update(ctx(req), req.params.id, req.body))),
});

const crudController = (service, { archive = true } = {}) => ({
  list: asyncHandler(async (req, res) => ok(req, res, await service.list(ctx(req), req.query))),
  get: asyncHandler(async (req, res) => ok(req, res, await service.get(ctx(req), req.params.id))),
  create: asyncHandler(async (req, res) => created(req, res, await service.create(ctx(req), req.body))),
  update: asyncHandler(async (req, res) => ok(req, res, await service.update(ctx(req), req.params.id, req.body))),
  ...(archive ? { archive: asyncHandler(async (req, res) => ok(req, res, await service.archive(ctx(req), req.params.id), 'Archived')) } : {}),
});

/** Streams a stored image buffer with a safe, server-derived filename — shared by every letterhead asset GET. */
function sendImage(res, buffer, mimeType, fileName) {
  const safeName = String(fileName ?? 'image').replace(/[^A-Za-z0-9-_.]/g, '_');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.status(200).send(buffer);
}

/** Phase 22: one GET/POST/DELETE triple per letterhead asset type, all the same shape as the original logo-only handlers. */
const assetActions = (service, getFn, uploadFn, removeFn, label) => ({
  [getFn]: asyncHandler(async (req, res) => {
    const { buffer, mimeType, fileName } = await service[getFn](ctx(req));
    sendImage(res, buffer, mimeType, fileName);
  }),
  [uploadFn]: asyncHandler(async (req, res) => ok(req, res, await service[uploadFn](ctx(req), req.body), `${label} uploaded`)),
  [removeFn]: asyncHandler(async (req, res) => ok(req, res, await service[removeFn](ctx(req)), `${label} removed`)),
});

export const createBusinessProfileController = ({ businessProfileService }) => ({
  get: asyncHandler(async (req, res) => ok(req, res, await businessProfileService.get(ctx(req)))),
  create: asyncHandler(async (req, res) => created(req, res, await businessProfileService.create(ctx(req), req.body))),
  update: asyncHandler(async (req, res) => ok(req, res, await businessProfileService.update(ctx(req), req.body))),
  resetLetterhead: asyncHandler(async (req, res) => ok(req, res, await businessProfileService.resetLetterhead(ctx(req)), 'Letterhead reset to default')),
  uploadLogo: asyncHandler(async (req, res) => ok(req, res, await businessProfileService.uploadLogo(ctx(req), req.body), 'Logo uploaded')),
  removeLogo: asyncHandler(async (req, res) => ok(req, res, await businessProfileService.removeLogo(ctx(req)), 'Logo removed')),
  getLogo: asyncHandler(async (req, res) => {
    const { buffer, mimeType, fileName } = await businessProfileService.getLogo(ctx(req));
    sendImage(res, buffer, mimeType, fileName);
  }),
  previewLetterheadPdf: asyncHandler(async (req, res) => {
    const buffer = await businessProfileService.previewLetterheadPdf(ctx(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="letterhead-preview.pdf"');
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).send(buffer);
  }),
  ...assetActions(businessProfileService, 'getBackground', 'uploadBackground', 'removeBackground', 'Letterhead background'),
  ...assetActions(businessProfileService, 'getWatermark', 'uploadWatermark', 'removeWatermark', 'Watermark'),
  ...assetActions(businessProfileService, 'getSignature', 'uploadSignature', 'removeSignature', 'Signature'),
  ...assetActions(businessProfileService, 'getSeal', 'uploadSeal', 'removeSeal', 'Company seal'),
  ...assetActions(businessProfileService, 'getQrCode', 'uploadQrCode', 'removeQrCode', 'QR code'),
});

export const createProductController = ({ productService }) => crudController(productService);
export const createCustomerController = ({ customerService }) => crudController(customerService);

/** Streams a generated PDF buffer with a safe, server-derived filename — never a raw user-supplied path. */
function sendPdf(res, buffer, fileName) {
  const safeName = String(fileName ?? 'invoice.pdf').replace(/[^A-Za-z0-9-_.]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.status(200).send(buffer);
}

export const createInvoiceController = ({ invoiceService, documentService }) => ({
  list: asyncHandler(async (req, res) => ok(req, res, await invoiceService.list(ctx(req), req.query))),
  get: asyncHandler(async (req, res) => ok(req, res, await invoiceService.get(ctx(req), req.params.id))),
  create: asyncHandler(async (req, res) => created(req, res, await invoiceService.create(ctx(req), req.body), 'Invoice created as draft')),
  update: asyncHandler(async (req, res) => ok(req, res, await invoiceService.update(ctx(req), req.params.id, req.body), 'Invoice updated')),
  issue: asyncHandler(async (req, res) => ok(req, res, await invoiceService.issue(ctx(req), req.params.id), 'Invoice issued')),
  cancel: asyncHandler(async (req, res) => ok(req, res, await invoiceService.cancel(ctx(req), req.params.id, req.body.reason), 'Invoice cancelled')),

  /** GET: view/download. Generates on first request for ISSUED/CANCELLED invoices, otherwise reuses the persisted PDF. */
  viewPdf: asyncHandler(async (req, res) => {
    const c = ctx(req);
    const invoice = serialize(await invoiceService.get(c, req.params.id));
    if (invoice.invoiceStatus === 'DRAFT') {
      const { buffer, fileName } = await documentService.previewDraft(c, invoice);
      return sendPdf(res, buffer, fileName);
    }
    const { buffer, fileName } = await documentService.getOrGenerate(c, invoice);
    return sendPdf(res, buffer, fileName);
  }),

  /** POST: explicit (re)generate. Same idempotent rendering, but always re-renders and overwrites the stored copy. */
  regeneratePdf: asyncHandler(async (req, res) => {
    const c = ctx(req);
    const invoice = serialize(await invoiceService.get(c, req.params.id));
    if (invoice.invoiceStatus === 'DRAFT') {
      const { buffer, fileName } = await documentService.previewDraft(c, invoice);
      return sendPdf(res, buffer, fileName);
    }
    const { buffer, fileName } = await documentService.getOrGenerate(c, invoice, { forceRegenerate: true });
    return sendPdf(res, buffer, fileName);
  }),
});

export const createCreditDebitNoteController = ({ creditDebitNoteService }) => ({
  list: asyncHandler(async (req, res) => ok(req, res, await creditDebitNoteService.list(ctx(req), req.query))),
  get: asyncHandler(async (req, res) => ok(req, res, await creditDebitNoteService.get(ctx(req), req.params.id))),
  listForInvoice: asyncHandler(async (req, res) => ok(req, res, await creditDebitNoteService.listByInvoice(ctx(req), req.params.id))),
  createCreditNote: asyncHandler(async (req, res) => created(req, res, await creditDebitNoteService.createCreditNote(ctx(req), req.params.id, req.body), 'Credit note issued')),
  createDebitNote: asyncHandler(async (req, res) => created(req, res, await creditDebitNoteService.createDebitNote(ctx(req), req.params.id, req.body), 'Debit note issued')),
  cancel: asyncHandler(async (req, res) => ok(req, res, await creditDebitNoteService.cancel(ctx(req), req.params.id, req.body.reason), 'Note cancelled')),
});

export const createVendorController = ({ vendorService }) => ({
  list: asyncHandler(async (req, res) => ok(req, res, await vendorService.list(req.query))),
  create: asyncHandler(async (req, res) => created(req, res, await vendorService.create(ctx(req), req.body))),
  get: asyncHandler(async (req, res) => ok(req, res, await vendorService.get(req.params.vendorId))),
  update: asyncHandler(async (req, res) => ok(req, res, await vendorService.update(ctx(req), req.params.vendorId, req.body), 'Vendor updated')),
  listAssignments: asyncHandler(async (req, res) => ok(req, res, await vendorService.listAssignments(req.params.vendorId))),
  assign: asyncHandler(async (req, res) => created(req, res, await vendorService.assign(ctx(req), req.params.vendorId, req.body.tenantId), 'Vendor assigned')),
  unassign: asyncHandler(async (req, res) => ok(req, res, await vendorService.unassign(ctx(req), req.params.vendorId, req.params.tenantId), 'Vendor unassigned')),
  assignmentLifecycle: asyncHandler(async (req, res) => ok(req, res, await vendorService.setAssignmentLifecycle(ctx(req), req.params.vendorId, req.params.assignmentId, req.body), 'Assignment updated')),
  myClients: asyncHandler(async (req, res) => ok(req, res, await vendorService.myClients(ctx(req)))),
  clientInvoices: asyncHandler(async (req, res) => ok(req, res, await vendorService.assignedClientInvoices(ctx(req), req.query))),
  clientVendors: asyncHandler(async (req, res) => ok(req, res, await vendorService.clientVendors(ctx(req)))),
});

export const createAuditController = ({ auditService }) => ({
  list: asyncHandler(async (req, res) => {
    const p = parsePagination(req.query);
    const r = await auditService.list({ ...p, tenantId: req.query.tenantId, action: req.query.action, actorId: req.query.actorId, from: req.query.from, to: req.query.to });
    ok(req, res, { items: r.items, pagination: buildPageMeta(p, r.total) });
  }),
});

export const createTallyController = ({ tallyConfigService, tallySyncService }) => ({
  getConfig: asyncHandler(async (req, res) => ok(req, res, await tallyConfigService.getConfig(ctx(req)))),
  upsertConfig: asyncHandler(async (req, res) => ok(req, res, await tallyConfigService.upsertConfig(ctx(req), req.body), 'Tally configuration saved')),
  testConnection: asyncHandler(async (req, res) => ok(req, res, await tallyConfigService.testConnection(ctx(req)))),
  syncInvoice: asyncHandler(async (req, res) => ok(req, res, await tallySyncService.sync(ctx(req), req.params.id), 'Tally sync requested')),
  syncStatus: asyncHandler(async (req, res) => ok(req, res, await tallySyncService.getStatus(ctx(req), req.params.id))),
});

/** Explicit placeholder: documented in OpenAPI, returns 501 rather than pretending to work. */
export const notImplemented = (feature) => (req, res, next) => next(new NotImplementedError(feature));