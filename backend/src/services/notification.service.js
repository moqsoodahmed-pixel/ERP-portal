import { NotFoundError } from '../utils/errors.js';
import { NOTIFICATION_TYPE as T, NOTIFICATION_SEVERITY as S, TALLY_SYNC_STATUS } from '../constants/statuses.js';
import { ROLES } from '../constants/roles.js';
import { parsePagination, buildPageMeta } from '../utils/pagination.js';
import { logger } from '../utils/logger.js';

const ms = (d) => new Date(d ?? Date.now()).getTime();

/**
 * Phase 9 — persistent IN_APP notifications.
 *
 * GENERATION (the only code path that ever writes `recipientUserId`): called by the services that own the
 * authoritative transitions (InvoiceService, TallySyncService, GSTFilingService, ClientService,
 * VendorService) strictly AFTER their conditional update succeeded. Recipients are resolved here from the
 * User / VendorClientAssignment collections — never from request input.
 *
 * IDEMPOTENCY: each notification carries a `dedupKey` naming the event occurrence (e.g.
 * `INVOICE_ISSUED:<invoiceId>`, `TALLY_SYNC_FAILED:<invoiceId>:attempt-2`). The unique
 * (recipientUserId, dedupKey) index turns a repeated trigger into a no-op insert. Repeatable events
 * (client status, assignment changes, issue resolution) key on the persisted timestamp of the change, and
 * their callers only emit on a real state change.
 *
 * FAILURE ISOLATION: generation never throws into the business operation (same trade-off as AuditService).
 *
 * SELF-SERVICE API: every read/mark-read is scoped by the authenticated user's id (NotificationRepository
 * applies it inside the filter), so another user's notification id is indistinguishable from a missing one.
 */
export class NotificationService {
  constructor({ notificationRepo, userRepo, assignmentRepo }) {
    Object.assign(this, { notificationRepo, userRepo, assignmentRepo });
  }

  // ---------------------------------------------------------------- recipients
  /** All ACTIVE, non-deleted CLIENT_ADMINs of the tenant (never assumes a single admin). */
  async tenantAdmins(tenantId) {
    return this.userRepo.model.find({
      tenantId: String(tenantId), role: ROLES.CLIENT_ADMIN, status: 'ACTIVE', isDeleted: { $ne: true },
    }).lean();
  }

  /** A filing's assigned vendor user — only if that user is still ACTIVE and its vendor still holds an ACTIVE assignment to the tenant. */
  async assignedVendorUser(filing) {
    if (!filing?.vendorUserId) return null;
    const user = await this.userRepo.findById(filing.vendorUserId);
    if (!user || user.isDeleted || user.status !== 'ACTIVE' || user.role !== ROLES.GST_VENDOR) return null;
    const assignment = await this.assignmentRepo.findActive(user.vendorId, filing.tenantId);
    return assignment ? user : null;
  }

  async vendorUsers(vendorId) {
    return this.userRepo.model.find({ vendorId: String(vendorId), role: ROLES.GST_VENDOR, status: 'ACTIVE', isDeleted: { $ne: true } }).lean();
  }

  // ---------------------------------------------------------------- core writer
  /**
   * recipients: [{ user, actionUrl }]. Returns the number of NEW notifications created (duplicates are skipped).
   * Swallows and logs errors: a notification failure must never undo or fail the authoritative transition.
   */
  async notify({ tenantId, type, severity = S.INFO, title, message, entityType, entityId, dedupKey, recipients }) {
    let created = 0;
    try {
      const seen = new Set();
      for (const { user, actionUrl } of recipients) {
        if (!user?._id || seen.has(String(user._id))) continue;
        seen.add(String(user._id));
        const doc = await this.notificationRepo.createOnce({
          tenantId: String(tenantId), recipientUserId: String(user._id), channel: 'IN_APP', type, severity,
          title: String(title).slice(0, 200), message: message ? String(message).slice(0, 1000) : undefined,
          entityType, entityId: entityId ? String(entityId) : undefined, actionUrl, isRead: false, readAt: null, dedupKey,
        });
        if (doc) created += 1;
      }
    } catch (err) {
      logger.error({ event: 'notification.write_failed', type, err: err.message }, 'Notification write failed');
    }
    return created;
  }

  async #toTenantAdmins(tenantId, urlFor) {
    return (await this.tenantAdmins(tenantId)).map((user) => ({ user, actionUrl: urlFor(user) }));
  }

  // ---------------------------------------------------------------- event hooks
  async invoiceIssued(invoice) {
    return this.notify({
      tenantId: invoice.tenantId, type: T.INVOICE_ISSUED, severity: S.INFO,
      title: `Invoice ${invoice.invoiceNumber} issued`, message: 'The invoice is now final and can be synced to Tally.',
      entityType: 'Invoice', entityId: invoice._id, dedupKey: `${T.INVOICE_ISSUED}:${invoice._id}`,
      recipients: await this.#toTenantAdmins(invoice.tenantId, () => `/client/invoices/${invoice._id}`),
    });
  }

  async invoiceCancelled(invoice) {
    return this.notify({
      tenantId: invoice.tenantId, type: T.INVOICE_CANCELLED, severity: S.WARNING,
      title: `Invoice ${invoice.invoiceNumber} cancelled`, message: invoice.cancellationReason ? `Reason: ${invoice.cancellationReason}` : undefined,
      entityType: 'Invoice', entityId: invoice._id, dedupKey: `${T.INVOICE_CANCELLED}:${invoice._id}`,
      recipients: await this.#toTenantAdmins(invoice.tenantId, () => `/client/invoices/${invoice._id}`),
    });
  }

  /** One notification per failed attempt (retries are manual; there is no background retry job). */
  async tallySyncFailed(tenantId, invoice, record) {
    const final = record.status === TALLY_SYNC_STATUS.FAILED;
    return this.notify({
      tenantId, type: T.TALLY_SYNC_FAILED, severity: final ? S.CRITICAL : S.WARNING,
      title: `Tally sync failed for invoice ${invoice.invoiceNumber}`,
      message: `${final ? 'Retry limit reached.' : 'You can retry the sync.'} Error: ${record.errorCode ?? 'UNKNOWN'}`,
      entityType: 'Invoice', entityId: invoice._id, dedupKey: `${T.TALLY_SYNC_FAILED}:${invoice._id}:attempt-${record.attempt ?? 1}`,
      recipients: await this.#toTenantAdmins(tenantId, () => `/client/invoices/${invoice._id}`),
    });
  }

  async tallySyncSucceeded(tenantId, invoice, record) {
    return this.notify({
      tenantId, type: T.TALLY_SYNC_SUCCEEDED, severity: S.INFO,
      title: `Invoice ${invoice.invoiceNumber} synced to Tally`, message: record?.voucherNumber ? `Voucher ${record.voucherNumber}` : undefined,
      entityType: 'Invoice', entityId: invoice._id, dedupKey: `${T.TALLY_SYNC_SUCCEEDED}:${invoice._id}`,
      recipients: await this.#toTenantAdmins(tenantId, () => `/client/invoices/${invoice._id}`),
    });
  }

  async #filingRecipients(filing) {
    const recipients = await this.#toTenantAdmins(filing.tenantId, () => `/client/gst-filings/${filing._id}`);
    const vendorUser = await this.assignedVendorUser(filing);
    if (vendorUser) recipients.push({ user: vendorUser, actionUrl: `/vendor/filings/${filing._id}` });
    return recipients;
  }

  /** transition: 'ready' | 'submit' | 'markFiled' (the Phase 8 state machine is forward-only, so each is one-time per filing). */
  async filingTransitioned(filing, transition) {
    const map = {
      ready: [T.GST_FILING_READY, 'is ready for review', S.INFO],
      submit: [T.GST_FILING_SUBMITTED, 'was marked submitted (manually recorded)', S.INFO],
      markFiled: [T.GST_FILING_FILED, 'was marked filed (manually recorded, not portal-verified)', S.INFO],
    };
    const entry = map[transition];
    if (!entry) return 0;
    const [type, verb, severity] = entry;
    return this.notify({
      tenantId: filing.tenantId, type, severity,
      title: `GST filing ${filing.periodKey} ${String(filing.returnType).replace('_', '')} ${verb}`,
      entityType: 'GSTFiling', entityId: filing._id, dedupKey: `${type}:${filing._id}`,
      recipients: await this.#filingRecipients(filing),
    });
  }

  async filingIssueOpened(filing, issue) {
    return this.notify({
      tenantId: filing.tenantId, type: T.GST_FILING_ISSUE_OPENED,
      severity: ['HIGH', 'CRITICAL'].includes(issue.severity) ? S.CRITICAL : S.WARNING,
      title: `New ${String(issue.severity).toLowerCase()} issue on GST filing ${filing.periodKey}`, message: issue.title,
      entityType: 'GSTFilingIssue', entityId: issue._id, dedupKey: `${T.GST_FILING_ISSUE_OPENED}:${issue._id}`,
      recipients: await this.#filingRecipients(filing),
    });
  }

  async filingIssueResolved(filing, issue) {
    return this.notify({
      tenantId: filing.tenantId, type: T.GST_FILING_ISSUE_RESOLVED, severity: S.INFO,
      title: `Issue resolved on GST filing ${filing.periodKey}`, message: issue.title,
      entityType: 'GSTFilingIssue', entityId: issue._id, dedupKey: `${T.GST_FILING_ISSUE_RESOLVED}:${issue._id}:${ms(issue.resolvedAt)}`,
      recipients: await this.#filingRecipients(filing),
    });
  }

  async clientStatusChanged(tenant, previous, next) {
    return this.notify({
      tenantId: tenant._id, type: T.CLIENT_STATUS_CHANGED, severity: next === 'ACTIVE' ? S.INFO : S.CRITICAL,
      title: `Your business account status changed to ${next}`, message: `Previous status: ${previous}`,
      entityType: 'Tenant', entityId: tenant._id, dedupKey: `${T.CLIENT_STATUS_CHANGED}:${tenant._id}:${next}:${ms(tenant.updatedAt)}`,
      recipients: await this.#toTenantAdmins(tenant._id, () => '/client/dashboard'),
    });
  }

  /** action: 'ASSIGNED' | 'UNASSIGNED' | 'REACTIVATED'. Notifies the vendor's users (internal only, never leaks vendor to client). */
  async vendorAssignmentChanged(assignment, action, { vendorName, tenantName } = {}) {
    const at = assignment.reactivatedAt ?? assignment.unassignedAt ?? assignment.assignedAt ?? assignment.updatedAt;
    const vendorRecipients = (await this.vendorUsers(assignment.vendorId)).map((user) => ({ user, actionUrl: '/vendor/clients' }));
    const verb = { ASSIGNED: 'assigned to', UNASSIGNED: 'unassigned from', REACTIVATED: 're-assigned to' }[action] ?? 'changed for';
    return this.notify({
      tenantId: assignment.tenantId, type: T.VENDOR_ASSIGNMENT_CHANGED, severity: action === 'UNASSIGNED' ? S.WARNING : S.INFO,
      title: `GST vendor ${vendorName ?? ''} ${verb} ${tenantName ?? 'a client'}`.replace(/\s+/g, ' ').trim(),
      entityType: 'VendorClientAssignment', entityId: assignment._id,
      dedupKey: `${T.VENDOR_ASSIGNMENT_CHANGED}:${assignment._id}:${action}:${ms(at)}`,
      recipients: vendorRecipients,
    });
  }

  // ---------------------------------------------------------------- Phase 15: bill intake + Tally queue
  /** The uploading client user + the tenant's other admins (so any CLIENT_ADMIN can see the submission). */
  async #billClientRecipients(bill) {
    const recipients = await this.#toTenantAdmins(bill.tenantId, () => `/client/bills/${bill._id}`);
    if (bill.clientUserId && !recipients.some((r) => String(r.user._id) === String(bill.clientUserId))) {
      const uploader = await this.userRepo.findById(bill.clientUserId);
      if (uploader && !uploader.isDeleted && uploader.status === 'ACTIVE') recipients.push({ user: uploader, actionUrl: `/client/bills/${bill._id}` });
    }
    return recipients;
  }

  async billSubmitted(bill) {
    return this.notify({
      tenantId: bill.tenantId, type: T.BILL_SUBMITTED, severity: S.INFO,
      title: `Bill ${bill.billNumber ?? bill._id} submitted for review`,
      entityType: 'BillIntake', entityId: bill._id, dedupKey: `${T.BILL_SUBMITTED}:${bill._id}`,
      recipients: await this.#billClientRecipients(bill),
    });
  }

  async billRejected(bill) {
    return this.notify({
      tenantId: bill.tenantId, type: T.BILL_REJECTED, severity: S.WARNING,
      title: `Bill ${bill.billNumber ?? bill._id} was rejected`, message: bill.rejectionReason,
      entityType: 'BillIntake', entityId: bill._id, dedupKey: `${T.BILL_REJECTED}:${bill._id}`,
      recipients: await this.#billClientRecipients(bill),
    });
  }

  async billReadyForTally(bill) {
    const created = await this.notify({
      tenantId: bill.tenantId, type: T.BILL_READY_FOR_TALLY, severity: S.INFO,
      title: `Bill ${bill.billNumber ?? bill._id} is ready for Tally`,
      entityType: 'BillIntake', entityId: bill._id, dedupKey: `${T.BILL_READY_FOR_TALLY}:${bill._id}`,
      recipients: await this.#billClientRecipients(bill),
    });
    const vendorUsers = await this.#assignedVendorUsersForTenant(bill.tenantId);
    const vendorCreated = await this.notify({
      tenantId: bill.tenantId, type: T.NEW_BILL_READY_FOR_TALLY, severity: S.INFO,
      title: `New bill ${bill.billNumber ?? bill._id} ready for Tally processing`,
      entityType: 'BillIntake', entityId: bill._id, dedupKey: `${T.NEW_BILL_READY_FOR_TALLY}:${bill._id}`,
      recipients: vendorUsers.map((user) => ({ user, actionUrl: '/vendor/tally-queue' })),
    });
    return created + vendorCreated;
  }

  async tallyProcessing(bill) {
    return this.notify({
      tenantId: bill.tenantId, type: T.TALLY_PROCESSING, severity: S.INFO,
      title: `Bill ${bill.billNumber ?? bill._id} is being processed in Tally`,
      entityType: 'BillIntake', entityId: bill._id, dedupKey: `${T.TALLY_PROCESSING}:${bill._id}:${ms(bill.lastSyncAttemptAt)}`,
      recipients: await this.#billClientRecipients(bill),
    });
  }

  async tallyFailed(bill) {
    const clientRecipients = await this.#billClientRecipients(bill);
    await this.notify({
      tenantId: bill.tenantId, type: T.TALLY_FAILED, severity: S.CRITICAL,
      title: `Tally processing failed for bill ${bill.billNumber ?? bill._id}`, message: bill.tallyFailureReason,
      entityType: 'BillIntake', entityId: bill._id, dedupKey: `${T.TALLY_FAILED}:${bill._id}`,
      recipients: clientRecipients,
    });
    const vendorUsers = await this.#assignedVendorUsersForTenant(bill.tenantId);
    await this.notify({
      tenantId: bill.tenantId, type: T.TALLY_FAILED, severity: S.CRITICAL,
      title: `Tally failure on bill ${bill.billNumber ?? bill._id}`, message: bill.tallyFailureReason,
      entityType: 'BillIntake', entityId: bill._id, dedupKey: `${T.TALLY_FAILED}:${bill._id}:vendor`,
      recipients: vendorUsers.map((user) => ({ user, actionUrl: '/vendor/tally-queue' })),
    });
    const admins = await this.#masterAdminRecipients();
    return this.notify({
      tenantId: bill.tenantId, type: T.IMPORTANT_TALLY_FAILURE, severity: S.CRITICAL,
      title: `Important: Tally processing failed for a client bill`, message: bill.tallyFailureReason,
      entityType: 'BillIntake', entityId: bill._id, dedupKey: `${T.IMPORTANT_TALLY_FAILURE}:${bill._id}`,
      recipients: admins,
    });
  }

  async billCompleted(bill) {
    return this.notify({
      tenantId: bill.tenantId, type: T.BILL_COMPLETED, severity: S.INFO,
      title: `Bill ${bill.billNumber ?? bill._id} processing completed`,
      entityType: 'BillIntake', entityId: bill._id, dedupKey: `${T.BILL_COMPLETED}:${bill._id}`,
      recipients: await this.#billClientRecipients(bill),
    });
  }

  // ---------------------------------------------------------------- Phase 16: Tally connector bridge
  /** Admin/Super Admin notification when a connector is detected offline with pending jobs (spec Step 21/29). */
  async connectorOffline(connector) {
    const admins = await this.#masterAdminRecipients();
    return this.notify({
      tenantId: connector.tenantId, type: T.CONNECTOR_OFFLINE, severity: S.WARNING,
      title: `Tally connector "${connector.name}" appears to be offline`,
      entityType: 'TallyConnector', entityId: connector._id,
      dedupKey: `${T.CONNECTOR_OFFLINE}:${connector._id}:${new Date().toISOString().slice(0, 13)}`,
      recipients: admins,
    });
  }

  async #assignedVendorUsersForTenant(tenantId) {
    const assignments = await this.assignmentRepo.listForTenant(tenantId);
    const active = assignments.filter((a) => a.status === 'ACTIVE');
    const users = await Promise.all(active.map((a) => this.vendorUsers(a.vendorId)));
    return users.flat();
  }

  async #masterAdminRecipients() {
    const admins = await this.userRepo.model.find({ role: ROLES.MASTER_ADMIN, status: 'ACTIVE', isDeleted: { $ne: true } }).lean();
    return admins.map((user) => ({ user, actionUrl: '/master/dashboard' }));
  }

  async #masterAndAssistantAdminRecipients(tenantId) {
    const users = await this.userRepo.model.find({
      $or: [
        { role: ROLES.MASTER_ADMIN, status: 'ACTIVE', isDeleted: { $ne: true } },
        { role: ROLES.MASTER_ASSISTANT_ADMIN, assignedTenantIds: String(tenantId), status: 'ACTIVE', isDeleted: { $ne: true } },
      ],
    }).lean();
    return users.map((user) => ({ user, actionUrl: '/master/bills' }));
  }

  async billUploaded(bill, companyCode) {
    const admins = await this.#masterAndAssistantAdminRecipients(bill.tenantId);
    return this.notify({
      tenantId: bill.tenantId,
      type: T.NEW_BILL_READY_FOR_TALLY,
      severity: S.INFO,
      title: `New bill ${bill.billId ?? bill.billNumber ?? bill._id} uploaded`,
      message: `Organization ${companyCode ?? 'Client'} uploaded a bill. Added to internal Tally sync queue.`,
      entityType: 'BillIntake',
      entityId: bill._id,
      dedupKey: `BILL_UPLOADED:${bill._id}`,
      recipients: admins,
    });
  }

  // ---------------------------------------------------------------- Enterprise Tally Notification Center
  async validationFailed(tenantId, bill, errors = [], actor = null) {
    const adminRecipients = await this.#masterAndAssistantAdminRecipients(tenantId);
    const clientRecipients = await this.#toTenantAdmins(tenantId, () => '/client/bills');
    const billDisplay = bill.billId || bill.billNumber || bill.invoiceNumber || 'Document';

    // 1. Notify Master Admin & Assigned Assistant Admin (operational view)
    await this.notify({
      tenantId,
      type: 'TALLY_VALIDATION_FAILED',
      severity: S.WARNING,
      title: `Validation failed for bill ${billDisplay}`,
      message: `Validation failed with ${errors.length} issue(s): ${errors.map((e) => e.message).join('; ')}`,
      entityType: 'TallyBillSync',
      entityId: bill._id || bill.id,
      dedupKey: `VALIDATION_FAILED:${tenantId}:${billDisplay}:${Date.now()}`,
      recipients: adminRecipients,
    });

    // 2. Notify Client Admin (safe friendly view — NEVER exposes internal routing or vendors)
    return this.notify({
      tenantId,
      type: 'TALLY_VALIDATION_FAILED',
      severity: S.WARNING,
      title: `Bill validation failed: ${billDisplay}`,
      message: errors.map((e) => e.message).join('; '),
      entityType: 'BillIntake',
      entityId: bill._id || bill.id,
      dedupKey: `VALIDATION_FAILED_CLIENT:${tenantId}:${billDisplay}:${Date.now()}`,
      recipients: clientRecipients,
    });
  }

  async deadLetterQueueAlert(tenantId, record) {
    const adminRecipients = await this.#masterAndAssistantAdminRecipients(tenantId);
    return this.notify({
      tenantId,
      type: 'DEAD_LETTER_QUEUE_ENTRY',
      severity: S.CRITICAL,
      title: `Dead Letter Queue: Bill ${record.billId || record.uuid} requires review`,
      message: `Bill exceeded maximum retry attempts (${record.retryCount}). Error: ${record.errorMessage || 'Unknown failure'}`,
      entityType: 'TallyBillSync',
      entityId: record._id || record.id,
      actionUrl: '/master/bills',
      dedupKey: `DLQ_ENTRY:${record.billId || record.uuid}:${record.retryCount}`,
      recipients: adminRecipients,
    });
  }

  async syncFailed(tenantId, record, error) {
    const adminRecipients = await this.#masterAndAssistantAdminRecipients(tenantId);
    return this.notify({
      tenantId,
      type: 'TALLY_SYNC_FAILED',
      severity: S.WARNING,
      title: `Sync attempt failed for bill ${record.billId || record.uuid}`,
      message: `Attempt ${record.retryCount || 1} failed: ${error}`,
      entityType: 'TallyBillSync',
      entityId: record._id || record.id,
      dedupKey: `SYNC_FAILED:${record.billId || record.uuid}:${record.retryCount || 1}`,
      recipients: adminRecipients,
    });
  }

  async credentialExpiringAlert(tenantId, integration) {
    const admins = await this.#masterAdminRecipients();
    return this.notify({
      tenantId,
      type: 'CREDENTIAL_EXPIRING',
      severity: S.WARNING,
      title: `Tally integration "${integration.name}" credentials expiring soon`,
      message: `Integration "${integration.name}" is scheduled to expire on ${new Date(integration.expiresAt).toLocaleDateString()}`,
      entityType: 'TallyExternalIntegration',
      entityId: integration.id || integration._id,
      dedupKey: `CREDENTIAL_EXPIRING:${integration.integrationId || integration.id}`,
      recipients: admins,
    });
  }

  async queueBacklogAlert(backlogCount) {
    const admins = await this.#masterAdminRecipients();
    return this.notify({
      tenantId: 'system',
      type: 'QUEUE_BACKLOG',
      severity: S.WARNING,
      title: `Tally queue backlog warning`,
      message: `Current synchronization queue backlog has reached ${backlogCount} pending bills`,
      entityType: 'TallySyncQueue',
      dedupKey: `QUEUE_BACKLOG:${new Date().toISOString().slice(0, 13)}`,
      recipients: admins,
    });
  }

  async apiAbuseAlert(tenantId, details) {
    const admins = await this.#masterAdminRecipients();
    return this.notify({
      tenantId,
      type: 'API_ABUSE_DETECTED',
      severity: S.CRITICAL,
      title: `Security alert: Tally API abuse detected`,
      message: details.reason || 'Unusual rate of failed signatures or invalid requests detected',
      entityType: 'SecurityAlert',
      dedupKey: `API_ABUSE:${tenantId}:${Date.now()}`,
      recipients: admins,
    });
  }

  // ---------------------------------------------------------------- self-service API (recipient = authenticated user)
  async listOwn(userId, query) {
    const p = parsePagination(query);
    const unreadOnly = query.unread === true || query.unread === 'true';
    const r = await this.notificationRepo.findPageForRecipient(userId, { unreadOnly, skip: p.skip, limit: p.limit });
    return { items: r.items, pagination: buildPageMeta(p, r.total) };
  }

  async unreadCount(userId) { return { unread: await this.notificationRepo.countUnread(userId) }; }

  /** Idempotent: an already-read notification is returned unchanged (readAt is never overwritten). */
  async markRead(userId, id) {
    const updated = await this.notificationRepo.markRead(userId, id);
    if (updated) return updated;
    const existing = await this.notificationRepo.findOneForRecipient(userId, id);
    if (!existing) throw new NotFoundError('Notification not found');
    return existing;
  }

  async markAllRead(userId) {
    const r = await this.notificationRepo.markAllRead(userId);
    return { updated: r.modifiedCount ?? 0 };
  }
}
