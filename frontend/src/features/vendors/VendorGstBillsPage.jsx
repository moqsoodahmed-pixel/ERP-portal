import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  ErrorState,
  LoadingState,
  EmptyState,
} from '../../design-system/index.js';
import { useFetch } from './vendorsApi.js';

export default function VendorGstBillsPage() {
  const { status, data, error, reload } = useFetch('/vendors/me/gst-bills');
  const [notice, setNotice] = useState(null);

  const viewDocument = async (filingId, docId, fileName) => {
    try {
      const { blob } = await api.getBlob(`/gst-filings/${filingId}/bill/documents/${docId}`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setNotice(err.message ?? `Could not open ${fileName}`);
    }
  };

  return (
    <>
      <PageHeader title="GST Filing Bills" subtitle="View GST bills uploaded by your assigned clients." />
      {notice && <p className="state state--error" role="alert">{notice}</p>}
      {status === 'loading' && <LoadingState label="Loading client bills…" />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && data.items.length === 0 && (
        <EmptyState title="No client bills available" hint="Client-uploaded GST bills will appear here once they are submitted." />
      )}
      {status === 'ready' && data.items.length > 0 && (
        <Card>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Company ID</th><th>Company Name</th><th>Company Details</th><th>Client Uploaded Bill</th></tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.filingId}>
                    <td className="mono">{row.companyId ?? '—'}</td>
                    <td><strong>{row.companyName}</strong></td>
                    <td>
                      {row.gstin && <div>GSTIN: {row.gstin}</div>}
                      <div className="muted" style={{ fontSize: '12.5px' }}>
                        {[row.address?.line1, row.address?.city, row.address?.state, row.address?.pincode].filter(Boolean).join(', ') || '—'}
                      </div>
                    </td>
                    <td>
                      {row.documents.length === 0 && '—'}
                      {row.documents.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className="btn btn--small ld-stacked-action"
                          onClick={() => viewDocument(row.filingId, d.id, d.fileName)}
                        >
                          {row.documents.length > 1 ? `View ${d.fileName}` : 'View Bill'}
                        </button>
                      ))}
                      <Link to={`/vendor/gst-filings/${row.filingId}/tally-matching`} className="btn btn--small ld-stacked-action">
                        Open Bill
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
