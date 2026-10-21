import { Route, Routes } from 'react-router-dom';
import { ROLES } from '../constants/roles.js';
import { HomeRedirect, RequirePermission, RoleGuard } from './guards.jsx';
import MasterAdminLayout from '../layouts/MasterAdminLayout.jsx';
import ClientLayout from '../layouts/ClientLayout.jsx';
import VendorLayout from '../layouts/VendorLayout.jsx';
import LoginPage from '../features/auth/LoginPage.jsx';
import { ClientDashboard, MasterDashboard, VendorDashboard } from '../features/dashboard/dashboards.jsx';
import ClientsPage from '../features/clients/ClientsPage.jsx';
import CreateClientPage from '../features/clients/CreateClientPage.jsx';
import ClientDetailsPage from '../features/clients/ClientDetailsPage.jsx';
import ProductsPage from '../features/products/ProductsPage.jsx';
import ProductFormPage from '../features/products/ProductFormPage.jsx';
import CustomersPage from '../features/customers/CustomersPage.jsx';
import CustomerFormPage from '../features/customers/CustomerFormPage.jsx';
import BusinessProfilePage from '../features/business/BusinessProfilePage.jsx';
import InvoicesPage from '../features/invoices/InvoicesPage.jsx';
import InvoiceFormPage from '../features/invoices/InvoiceFormPage.jsx';
import InvoiceDetailPage from '../features/invoices/InvoiceDetailPage.jsx';
import GstPage from '../features/gst/GstPage.jsx';
import TallyPage from '../features/tally/TallyPage.jsx';
import AuditLogsPage from '../features/audit/AuditLogsPage.jsx';
import VendorClientsPage from '../features/vendors/VendorClientsPage.jsx';
import VendorClientDetailPage from '../features/vendors/VendorClientDetailPage.jsx';
import VendorInvoiceDetailPage from '../features/vendors/VendorInvoiceDetailPage.jsx';
import VendorsAdminPage from '../features/vendors/VendorsAdminPage.jsx';
import VendorDetailPage from '../features/vendors/VendorDetailPage.jsx';
import CreateVendorPage from '../features/vendors/CreateVendorPage.jsx';
import ClientGstVendorPage from '../features/vendors/ClientGstVendorPage.jsx';
import VendorGstBillsPage from '../features/vendors/VendorGstBillsPage.jsx';
import FilingListPage from '../features/filings/FilingListPage.jsx';
import FilingDetailPage from '../features/filings/FilingDetailPage.jsx';
import NewFilingPage from '../features/filings/NewFilingPage.jsx';
import BillBuilderPage from '../features/filings/BillBuilderPage.jsx';
import TallyMatchingPage from '../features/filings/TallyMatchingPage.jsx';
import GstBillingDashboardPage from '../features/filings/GstBillingDashboardPage.jsx';
import ReportsPage from '../features/reports/ReportsPage.jsx';
import BillListPage from '../features/bills/BillListPage.jsx';
import BillDetailPage from '../features/bills/BillDetailPage.jsx';
import TallyQueuePage from '../features/bills/TallyQueuePage.jsx';
import ConnectorListPage from '../features/tally/ConnectorListPage.jsx';
import ConnectorDetailPage from '../features/tally/ConnectorDetailPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';
import ForbiddenPage from '../pages/ForbiddenPage.jsx';

const guarded = (permission, el) => <RequirePermission permission={permission}>{el}</RequirePermission>;
const CLIENT_ROLES = [ROLES.CLIENT_ADMIN, ROLES.CLIENT_USER];

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />

      <Route path="/master" element={<RoleGuard roles={[ROLES.MASTER_ADMIN]}><MasterAdminLayout /></RoleGuard>}>
        <Route path="dashboard" element={<MasterDashboard />} />
        <Route path="clients" element={guarded('clients.view', <ClientsPage />)} />
        <Route path="clients/new" element={guarded('clients.create', <CreateClientPage />)} />
        <Route path="clients/:id" element={guarded('clients.view', <ClientDetailsPage />)} />
        <Route path="vendors" element={guarded('vendors.view', <VendorsAdminPage />)} />
        <Route path="vendors/new" element={guarded('vendors.create', <CreateVendorPage />)} />
        <Route path="vendors/:vendorId" element={guarded('vendors.view', <VendorDetailPage />)} />
        <Route path="filings" element={guarded('gst_filings.view', <FilingListPage basePath="/master/filings" title="GST filings" subtitle="Cross-tenant GST filing workflow tracker (ERP-internal; not a government portal)." showClientColumn />)} />
        <Route path="filings/:id" element={guarded('gst_filings.view', <FilingDetailPage />)} />
        <Route path="reports" element={guarded('reports.view', <ReportsPage mode="master" />)} />
        <Route path="bills" element={guarded('bills.view', <BillListPage basePath="/master/bills" title="Client bills" subtitle="Platform-wide bill intake (per existing permissions)." />)} />
        <Route path="bills/:id" element={guarded('bills.view', <BillDetailPage />)} />
        <Route path="tally-queue" element={guarded('tally_queue.view', <TallyQueuePage detailBasePath="/master/bills" />)} />
        <Route path="tally-connectors" element={guarded('tally.connector.view', <ConnectorListPage />)} />
        <Route path="tally-connectors/:id" element={guarded('tally.connector.view', <ConnectorDetailPage />)} />
        <Route path="audit-logs" element={guarded('audit_logs.view', <AuditLogsPage />)} />
      </Route>

      <Route path="/client" element={<RoleGuard roles={CLIENT_ROLES}><ClientLayout /></RoleGuard>}>
        <Route path="dashboard" element={<ClientDashboard />} />
        <Route path="business" element={guarded('business.view', <BusinessProfilePage />)} />
        <Route path="products" element={guarded('products.view', <ProductsPage />)} />
        <Route path="products/new" element={guarded('products.create', <ProductFormPage />)} />
        <Route path="products/:id" element={guarded('products.view', <ProductFormPage />)} />
        <Route path="customers" element={guarded('customers.view', <CustomersPage />)} />
        <Route path="customers/new" element={guarded('customers.create', <CustomerFormPage />)} />
        <Route path="customers/:id" element={guarded('customers.view', <CustomerFormPage />)} />
        <Route path="invoices" element={guarded('invoices.view', <InvoicesPage />)} />
        <Route path="invoices/new" element={guarded('invoices.create', <InvoiceFormPage />)} />
        <Route path="invoices/:id/edit" element={guarded('invoices.update', <InvoiceFormPage />)} />
        <Route path="invoices/:id" element={guarded('invoices.view', <InvoiceDetailPage />)} />
        <Route path="gst" element={guarded('gst.view', <GstPage />)} />
        <Route path="gst-filings" element={guarded('gst_filings.view', <FilingListPage basePath="/client/gst-filings" title="GST filing workflow" subtitle="Track your GST filings, from new filing to filed, alongside your assigned GST vendor's work." showNewFilingButton />)} />
        <Route path="gst-filings/new" element={guarded('gst_filings.create', <NewFilingPage />)} />
        <Route path="gst-filings/:id/bill" element={guarded('gst_bills.view', <BillBuilderPage />)} />
        <Route path="gst-filings/:id/billing" element={guarded('gst_bills.view', <GstBillingDashboardPage />)} />
        <Route path="gst-filings/:id" element={guarded('gst_filings.view', <FilingDetailPage />)} />
        <Route path="tally" element={guarded('tally.view', <TallyPage />)} />
        <Route path="gst-vendor" element={guarded('business.view', <ClientGstVendorPage />)} />
        <Route path="reports" element={guarded('reports.view', <ReportsPage mode="tenant" />)} />
        <Route path="bills" element={guarded('bills.view', <BillListPage basePath="/client/bills" title="My bills" subtitle="Upload daily bills and supporting documents; track their status through to Tally processing." showCreate />)} />
        <Route path="bills/:id" element={guarded('bills.view', <BillDetailPage />)} />
        <Route path="tally-connectors" element={guarded('tally.connector.view', <ConnectorListPage />)} />
        <Route path="tally-connectors/:id" element={guarded('tally.connector.view', <ConnectorDetailPage />)} />
      </Route>

      <Route path="/vendor" element={<RoleGuard roles={[ROLES.GST_VENDOR]}><VendorLayout /></RoleGuard>}>
        <Route path="dashboard" element={<VendorDashboard />} />
        <Route path="clients" element={guarded('gst.view', <VendorClientsPage />)} />
        <Route path="clients/:tenantId" element={guarded('invoices.view', <VendorClientDetailPage />)} />
        <Route path="gst-bills" element={guarded('gst_bills.view', <VendorGstBillsPage />)} />
        <Route path="gst-filings/:id/tally-matching" element={guarded('gst_bills.view', <TallyMatchingPage />)} />
        <Route path="invoices/:id" element={guarded('invoices.view', <VendorInvoiceDetailPage />)} />
        <Route path="filings" element={guarded('gst_filings.view', <FilingListPage basePath="/vendor/filings" title="GST filings" subtitle="Filing workflow progress for your assigned clients only." />)} />
        <Route path="filings/:id" element={guarded('gst_filings.view', <FilingDetailPage />)} />
        <Route path="reports" element={guarded('reports.view', <ReportsPage mode="vendor" />)} />
        <Route path="bills" element={guarded('bills.view', <BillListPage basePath="/vendor/bills" title="Assigned clients' bills" subtitle="Submitted bills for your actively-assigned clients only." />)} />
        <Route path="bills/:id" element={guarded('bills.view', <BillDetailPage />)} />
        <Route path="tally-queue" element={guarded('tally_queue.view', <TallyQueuePage detailBasePath="/vendor/bills" />)} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}