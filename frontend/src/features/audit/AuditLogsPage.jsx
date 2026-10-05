import ListPage from '../../components/ListPage.jsx';
import { formatDateTime } from '../../utils/format.js';

const columns = [
  { key: 'timestamp', header: 'When', render: (r) => formatDateTime(r.timestamp) },
  { key: 'action', header: 'Action', mono: true },
  { key: 'actorRole', header: 'Role' },
  { key: 'resourceType', header: 'Resource' },
  { key: 'ipAddress', header: 'IP', mono: true },
];

export default function AuditLogsPage() {
  return <ListPage title="Audit logs" subtitle="Append-only record of security-sensitive and business-critical actions." path="/audit-logs" columns={columns} emptyTitle="No audit entries" searchPlaceholder="Filters arrive in Phase 9" />;
}
