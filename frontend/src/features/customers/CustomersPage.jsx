import { useState } from 'react';
import { Link } from 'react-router-dom';
import ListPage from '../../components/ListPage.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';

const columns = [
  { key: 'customerCode', header: 'Customer ID', mono: true },
  { key: 'name', header: 'Name' },
  { key: 'businessName', header: 'Business name' },
  { key: 'gstin', header: 'GSTIN', mono: true },
  { key: 'phone', header: 'Phone' },
  { key: 'email', header: 'Email' },
  { key: 'state', header: 'State', render: (r) => r.billingAddress?.state ?? r.state ?? '—' },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
];

function RowActions(row, { reload }) {
  const { user } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const canUpdate = can(user, 'customers.update');
  const canArchive = can(user, 'customers.delete');

  const archive = async () => {
    await api.delete(`/customers/${row._id}`);
    setConfirming(false);
    reload();
  };

  return (
    <div className="toolbar toolbar--tight">
      <Link to={`/client/customers/${row._id}`}>View</Link>
      {canUpdate && row.status !== 'ARCHIVED' && <Link to={`/client/customers/${row._id}?edit=1`}>Edit</Link>}
      {canArchive && row.status !== 'ARCHIVED' && (
        <button type="button" className="btn btn--danger btn--small" onClick={() => setConfirming(true)}>Archive</button>
      )}
      <ConfirmDialog
        open={confirming} title="Archive this customer?" message="It will be hidden from active lists but kept for historical invoices."
        confirmLabel="Archive" danger onConfirm={archive} onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

export default function CustomersPage() {
  const { user } = useAuth();
  return (
    <ListPage
      title="Customers" subtitle="Archived customers are hidden here but kept for historical invoices." path="/customers" columns={columns}
      searchPlaceholder="Search by name, ID, GSTIN or email"
      emptyTitle="No customers yet" emptyHint="Add your first customer to start creating invoices."
      actions={can(user, 'customers.create') && <Link to="/client/customers/new" className="btn btn--primary">New customer</Link>}
      renderRowActions={RowActions}
    />
  );
}
