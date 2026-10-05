import { Link } from 'react-router-dom';
import ListPage from '../../components/ListPage.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const columns = [
  { key: 'invoiceNumber', header: 'Invoice', mono: true },
  { key: 'customer', header: 'Customer', render: (r) => r.customerSnapshot?.name ?? '—' },
  { key: 'invoiceDate', header: 'Date', render: (r) => formatDate(r.invoiceDate) },
  { key: 'grandTotal', header: 'Total', numeric: true, render: (r) => formatMoney(r.grandTotal) },
  { key: 'totalTax', header: 'GST', numeric: true, render: (r) => formatMoney(r.totalTax) },
  { key: 'invoiceStatus', header: 'Status', render: (r) => <StatusBadge status={r.invoiceStatus} /> },
  { key: 'paymentStatus', header: 'Payment', render: (r) => <StatusBadge status={r.paymentStatus} /> },
];

export default function InvoicesPage() {
  const { user } = useAuth();
  return (
    <ListPage
      title="Invoices" path="/invoices" columns={columns} statuses={['DRAFT', 'ISSUED', 'CANCELLED']} searchPlaceholder="Search by invoice number"
      emptyTitle="No invoices yet" emptyHint="Create your first invoice to get started."
      actions={can(user, 'invoices.create') && <Link className="btn btn--primary" to="/client/invoices/new">New invoice</Link>}
      renderRowActions={(row) => (
        <div className="toolbar">
          <Link className="btn" to={`/client/invoices/${row._id}`}>View</Link>
          {row.invoiceStatus === 'DRAFT' && can(user, 'invoices.update') && <Link className="btn" to={`/client/invoices/${row._id}/edit`}>Edit</Link>}
        </div>
      )}
    />
  );
}
