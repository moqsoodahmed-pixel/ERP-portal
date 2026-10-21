import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.jsx';
import { ErrorState, LoadingState, EmptyState } from '../../components/states.jsx';
import { useFetch } from './vendorsApi.js';

/** Vendor portal: assigned clients. */
export default function VendorClientsPage() {
  const { status, data, error, reload } = useFetch('/vendors/me/clients');
  return (
    <>
      <PageHeader title="Assigned clients" subtitle="Clients explicitly assigned to you by the platform administrator." />
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && data.length === 0 && <EmptyState title="No clients assigned yet" />}
      {status === 'ready' && data.length > 0 && (
        <section className="card">
          <ul className="link-list">
            {data.map((t) => <li key={t.id}><Link to={`/vendor/clients/${t.id}`}>{t.businessName}</Link> <span className="muted">({t.tenantCode})</span></li>)}
          </ul>
        </section>
      )}
    </>
  );
}
