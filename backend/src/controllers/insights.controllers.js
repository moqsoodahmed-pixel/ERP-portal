import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { makeContext } from '../utils/context.js';

/**
 * Phase 9 controllers (dashboards, reports, notifications). Thin by design: every tenant id comes from
 * req.tenantId (set by resolveTenant / requireVendorAssignment) and every recipient id from req.auth.userId —
 * never from the query string or body.
 */
export const createDashboardController = ({ dashboardService }) => ({
  client: asyncHandler(async (req, res) => ok(req, res, await dashboardService.client(makeContext(req), req.query))),
  master: asyncHandler(async (req, res) => ok(req, res, await dashboardService.master(req.query, makeContext(req)))),
  vendor: asyncHandler(async (req, res) => ok(req, res, await dashboardService.vendor(makeContext(req)))),
});

function sendCsv(res, { csv, fileName, rowCount }) {
  const safeName = String(fileName).replace(/[^A-Za-z0-9-_.]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('X-Row-Count', String(rowCount));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(csv);
}

/** scopeOf(req) is supplied by the router: it is the ONLY place a report scope is built. */
export const createReportController = ({ reportService }, scopeOf, catalogOptions = {}) => ({
  catalog: asyncHandler(async (req, res) => ok(req, res, reportService.catalog(req.auth.permissions, catalogOptions))),
  run: asyncHandler(async (req, res) => ok(req, res, await reportService.run(req.params.type, scopeOf(req), req.query))),
  exportCsv: asyncHandler(async (req, res) => sendCsv(res, await reportService.exportCsv(makeContext(req), req.params.type, scopeOf(req), req.query))),
});

export const createNotificationController = ({ notificationService }) => ({
  list: asyncHandler(async (req, res) => ok(req, res, await notificationService.listOwn(req.auth.userId, req.query))),
  unreadCount: asyncHandler(async (req, res) => ok(req, res, await notificationService.unreadCount(req.auth.userId))),
  markRead: asyncHandler(async (req, res) => ok(req, res, await notificationService.markRead(req.auth.userId, req.params.id), 'Notification marked as read')),
  markAllRead: asyncHandler(async (req, res) => ok(req, res, await notificationService.markAllRead(req.auth.userId), 'All notifications marked as read')),
});
