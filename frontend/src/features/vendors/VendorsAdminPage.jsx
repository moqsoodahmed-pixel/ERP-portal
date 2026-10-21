import { Link } from 'react-router-dom';
import ListPage from '../../components/ListPage.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';

/** Master Admin: vendor list. */
export default function VendorsAdminPage() {
  return (
    <ListPage
      title="GST vendors" subtitle="Filing partners and their client assignments." path="/vendors"
      columns={[
        { key: 'vendorCode', header: 'Code', mono: true },
        { key: 'name', header: 'Vendor', render: (r) => <Link to={`/master/vendors/${r._id}`}>{r.name}</Link> },
        { key: 'contactEmail', header: 'Contact' },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      searchPlaceholder="Search vendors" emptyTitle="No vendors yet" emptyHint="Create a vendor to get started."
      actions={<Link className="btn btn--primary" to="/master/vendors/new">New vendor</Link>}
    />
  );
}
