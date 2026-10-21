import React from 'react';
import { useParams } from 'react-router-dom';
import {
  PageHeader,
  Card,
  CardBody,
  StatusBadge,
  DefinitionList,
  DefinitionItem,
  ErrorState,
  LoadingState,
} from '../../design-system/index.js';
import { formatDateTime, formatMoney } from '../../utils/format.js';
import { useFetch } from './vendorsApi.js';

export default function VendorInvoiceDetailPage() {
  const { id } = useParams();
  const { status, data, error, reload } = useFetch(`/invoices/${id}`);
  return (
    <>
      <PageHeader
        title={data ? `Invoice ${data.invoiceNumber}` : 'Invoice'}
        subtitle="View-only. No edit, issue, cancel or sync actions are available to a GST vendor."
      />
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && (
        <Card>
          <CardBody>
            <DefinitionList columns={4}>
              <DefinitionItem label="Status">
                <StatusBadge status={data.invoiceStatus} />
              </DefinitionItem>
              <DefinitionItem label="Payment">
                <StatusBadge status={data.paymentStatus} />
              </DefinitionItem>
              <DefinitionItem label="Date" value={formatDateTime(data.invoiceDate)} />
              <DefinitionItem label="Grand total" value={formatMoney(data.grandTotal)} />
            </DefinitionList>
            <div className="toolbar" style={{ marginTop: '1.5rem' }}>
              <a className="btn btn--primary" href={`${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/invoices/${id}/pdf`} target="_blank" rel="noreferrer">
                View PDF
              </a>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}
