import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { makeContext } from '../utils/context.js';

export function createGSTBillController({ gstBillService }) {
  return {
    get: asyncHandler(async (req, res) => ok(req, res, await gstBillService.get(makeContext(req), req.filing))),
    vendorList: asyncHandler(async (req, res) => ok(req, res, await gstBillService.vendorList(makeContext(req), req.query))),
    save: asyncHandler(async (req, res) => ok(req, res, await gstBillService.save(makeContext(req), req.filing, req.body), 'Bill saved')),
    addDocuments: asyncHandler(async (req, res) => ok(req, res, await gstBillService.addDocuments(makeContext(req), req.filing, req.body.documents), 'Document uploaded')),
    getDocument: asyncHandler(async (req, res) => {
      const { buffer, mimeType, fileName } = await gstBillService.getDocument(makeContext(req), req.filing, req.params.docId);
      const safeName = String(fileName ?? 'document').replace(/[^A-Za-z0-9-_.]/g, '_');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.status(200).send(buffer);
    }),
    addFinalDocument: asyncHandler(async (req, res) => ok(req, res, await gstBillService.addFinalDocument(makeContext(req), req.filing, req.body.documents), 'Final document uploaded')),
    getFinalDocuments: asyncHandler(async (req, res) => ok(req, res, await gstBillService.getFinalDocuments(makeContext(req), req.filing))),
    getFinalDocument: asyncHandler(async (req, res) => {
      const { buffer, mimeType, fileName } = await gstBillService.getFinalDocument(makeContext(req), req.filing, req.params.docId);
      const safeName = String(fileName ?? 'document').replace(/[^A-Za-z0-9-_.]/g, '_');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.status(200).send(buffer);
    }),
  };
}
