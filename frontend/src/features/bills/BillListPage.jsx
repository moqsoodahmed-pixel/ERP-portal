import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  PageHeader,
  Card,
  StatusBadge,
  Select,
  Button,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
  ErrorState,
  LoadingState,
  EmptyState,
} from '../../design-system/index.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { useFetch, BILL_STATUSES } from './billsApi.js';

export default function BillListPage({ basePath, title, subtitle, showCreate = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ status: '' });
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))).toString();
  const { status, data, error, reload } = useFetch(`/bills${query ? `?${query}` : ''}`, [query]);

  const createDraft = async () => {
    setBusy(true);
    try {
      const res = await api.post('/bills', {});
      navigate(`${basePath}/${res.data._id}`);
    } catch (err) {
      window.alert(err.message ?? 'Could not create a draft bill');
    } finally {
      setBusy(false);
    }
  };

  const statusOptions = BILL_STATUSES.map((s) => ({
    value: s,
    label: s.replaceAll('_', ' '),
  }));

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={showCreate && can(user, 'bills.create') && (
          <Button variant="primary" disabled={busy} onClick={createDraft}>
            Upload a new bill
          </Button>
        )}
      />
      <Card>
        <div className="toolbar" style={{ marginBottom: '1.25rem' }}>
          <label className="field field--inline">
            <span className="sr-only">Status</span>
            <Select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              placeholder="All statuses"
              options={statusOptions}
            />
          </label>
        </div>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState error={error} onRetry={reload} />}
        {status === 'ready' && data.items.length === 0 && (
          <EmptyState title="No bills found" hint="Nothing matches the current filters yet." />
        )}
        {status === 'ready' && data.items.length > 0 && (
          <Table caption="Bills List">
            <TableHead>
              <TableRow hover={false}>
                <TableHeaderCell>Bill number</TableHeaderCell>
                <TableHeaderCell>Vendor</TableHeaderCell>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell numeric>Amount</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Tally</TableHeaderCell>
                <TableHeaderCell>Last update</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Action</span></TableHeaderCell>
              </TableRow>
            </TableHead>
            <tbody>
              {data.items.map((b) => (
                <TableRow key={b._id}>
                  <TableCell mono>{b.billNumber ?? '—'}</TableCell>
                  <TableCell>{b.vendorName ?? '—'}</TableCell>
                  <TableCell>{b.billDate ? formatDate(b.billDate) : '—'}</TableCell>
                  <TableCell numeric>{b.amount ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={b.status} /></TableCell>
                  <TableCell><StatusBadge status={b.tallyStatus} /></TableCell>
                  <TableCell>{formatDateTime(b.updatedAt)}</TableCell>
                  <TableCell>
                    <Link className="btn btn--small" to={`${basePath}/${b._id}`}>View</Link>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
