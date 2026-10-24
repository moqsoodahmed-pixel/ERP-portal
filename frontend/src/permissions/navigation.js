import { ROLES } from '../constants/roles.js';

export const NAVIGATION = {
  master: {
    roles: [ROLES.MASTER_ADMIN, ROLES.MASTER_ASSISTANT_ADMIN],
    title: 'Platform',
    items: [
      { to: '/master/dashboard', label: 'Dashboard', permission: 'dashboard.view' },
      { to: '/master/clients', label: 'Clients', permission: 'clients.view' },
      { to: '/master/vendors', label: 'GST vendors', permission: 'vendors.view' },
      { to: '/master/filings', label: 'GST filings', permission: 'gst_filings.view' },
      { to: '/master/bills', label: 'Client bills', permission: 'bills.view' },
      { to: '/master/tally-queue', label: 'Tally queue', permission: 'tally_queue.view' },
      { to: '/master/tally-connectors', label: 'Tally connectors', permission: 'tally.connector.view' },
      { to: '/master/reports', label: 'Reports', permission: 'reports.view' },
      { to: '/master/audit-logs', label: 'Audit logs', permission: 'audit_logs.view' },
      { to: '/master/settings/developer/api-integrations/tally', label: 'API Integrations', permission: 'dashboard.view' },
    ],
  },
  client: {
    roles: [ROLES.CLIENT_ADMIN, ROLES.CLIENT_USER],
    title: 'Workspace',
    items: [
      { to: '/client/dashboard', label: 'Dashboard', permission: 'dashboard.view' },
      { to: '/client/business', label: 'Business profile', permission: 'business.view' },
      { to: '/client/letterhead', label: 'Letterhead builder', permission: 'business.view' },
      { to: '/client/products', label: 'Products & services', permission: 'products.view' },
      { to: '/client/customers', label: 'Customers', permission: 'customers.view' },
      { to: '/client/invoices', label: 'Invoices', permission: 'invoices.view' },
      // Phase 22: "GST filing" is the single, consolidated client entry point for the whole GST workflow
      // (New Filing, Bill Builder, Tally matching, final document, progress tracking) — the separate
      // "GST filing workflow" (/client/gst-filings list page) nav entry is intentionally removed to avoid
      // exposing two client-facing items for the same workflow; the route itself is untouched and still
      // used internally (e.g. "View Filing"/"GST Billing Dashboard" links from the GST Filing page).
      { to: '/client/gst', label: 'GST filing', permission: 'gst.view' },
      { to: '/client/bills', label: 'My bills', permission: 'bills.view' },
      { to: '/client/tally', label: 'Tally sync', permission: 'tally.view' },
      { to: '/client/tally-connectors', label: 'Tally connectors', permission: 'tally.connector.view' },
      { to: '/client/reports', label: 'Reports', permission: 'reports.view' },
    ],
  },
  vendor: {
    roles: [ROLES.GST_VENDOR],
    title: 'Filing desk',
    items: [
      { to: '/vendor/dashboard', label: 'Dashboard', permission: 'dashboard.view' },
      { to: '/vendor/clients', label: 'Assigned clients', permission: 'gst.view' },
      { to: '/vendor/filings', label: 'Filings', permission: 'gst_filings.view' },
      { to: '/vendor/gst-bills', label: 'Client GST bills', permission: 'gst_bills.view' },
      { to: '/vendor/bills', label: 'Client bills', permission: 'bills.view' },
      { to: '/vendor/reports', label: 'Reports', permission: 'reports.view' },
    ],
  },
};