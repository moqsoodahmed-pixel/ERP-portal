import { useState } from 'react';
import { Link } from 'react-router-dom';
import ListPage from '../../components/ListPage.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { formatMoney } from '../../utils/format.js';

const columns = [
  { key: 'productCode', header: 'Product ID', mono: true },
  { key: 'productName', header: 'Name' },
  { key: 'type', header: 'Type' },
  { key: 'sku', header: 'SKU', mono: true },
  { key: 'hsnSacCode', header: 'HSN/SAC', mono: true },
  { key: 'sellingPrice', header: 'Price', numeric: true, render: (r) => formatMoney(r.sellingPrice) },
  { key: 'gstRate', header: 'GST %', numeric: true, render: (r) => (r.isGstApplicable ? `${r.gstRate}%` : '—') },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
];

function RowActions(row, { reload }) {
  const { user } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const canUpdate = can(user, 'products.update');
  const canArchive = can(user, 'products.delete');

  const archive = async () => {
    setBusy(true);
    try {
      await api.delete(`/products/${row._id}`);
      setConfirming(false);
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="toolbar toolbar--tight">
      <Link to={`/client/products/${row._id}`}>View</Link>
      {canUpdate && row.status !== 'ARCHIVED' && <Link to={`/client/products/${row._id}?edit=1`}>Edit</Link>}
      {canArchive && row.status !== 'ARCHIVED' && (
        <button type="button" className="btn btn--danger btn--small" onClick={() => setConfirming(true)}>Archive</button>
      )}
      <ConfirmDialog
        open={confirming} title="Archive this product?" message="It will be hidden from active lists but kept for historical invoices."
        confirmLabel="Archive" danger onConfirm={archive} onCancel={() => setConfirming(false)}
      />
      {busy && <span className="muted">Working…</span>}
    </div>
  );
}

export default function ProductsPage() {
  const { user } = useAuth();
  return (
    <ListPage
      title="Products & services" subtitle="Each item has a unique ID within your business. Archived items are hidden here but kept for historical invoices." path="/products" columns={columns}
      searchPlaceholder="Search by name, ID, SKU or HSN/SAC"
      emptyTitle="No products yet" emptyHint="Create your first product or service to start building invoices."
      actions={can(user, 'products.create') && <Link to="/client/products/new" className="btn btn--primary">New product</Link>}
      renderRowActions={RowActions}
    />
  );
}
