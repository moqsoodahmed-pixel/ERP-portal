import { Link } from 'react-router-dom';
import ListPage from '../../components/ListPage.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { formatDate } from '../../utils/format.js';

const columns = [
  { key: 'tenantCode', header: 'Code', mono: true },
  { key: 'businessName', header: 'Business' },
  { key: 'gstin', header: 'GSTIN', mono: true },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'state', header: 'State', render: (r) => r.address?.state ?? '—' },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  { key: 'createdAt', header: 'Created', render: (r) => formatDate(r.createdAt) },
  { key: 'actions', header: 'Actions', render: (r) => <Link to={`/master/clients/${r._id}`}>View</Link> },
];

export default function ClientsPage() {
  return (
    <ListPage
      title="Clients" subtitle="Every business onboarded to the platform." path="/clients" columns={columns}
      statuses={['ACTIVE', 'PENDING', 'SUSPENDED', 'INACTIVE']} searchPlaceholder="Search by name, code or GSTIN"
      emptyTitle="No clients yet" emptyHint="Create the first client to get started."
      actions={<Link to="/master/clients/new" className="btn btn--primary">New client</Link>}
    />
  );
}
