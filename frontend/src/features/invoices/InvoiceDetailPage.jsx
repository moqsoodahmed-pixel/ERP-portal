import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  StatusBadge,
  DefinitionList,
  DefinitionItem,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
  AlertNotice,
  LoadingState,
  ErrorState,
  Modal,
  FormField,
  Textarea,
} from '../../design-system/index.js';
import { formatDate, formatMoney } from '../../utils/format.js';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'loading', invoice: null, error: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [tallySync, setTallySync] = useState(null);
  const [tallyBusy, setTallyBusy] = useState(false);

  const fetchInvoice = () => api.get(`/invoices/${id}`)
    .then(({ data }) => setState({ status: 'ready', invoice: data, error: null }))
    .catch((error) => setState({ status: 'error', invoice: null, error }));

  const fetchTallyStatus = () => {
    if (!can(user, 'tally.view')) return;
    api.get(`/invoices/${id}/tally-sync`).then(({ data }) => setTallySync(data)).catch(() => setTallySync(null));
  };

  const triggerTallySync = async () => {
    setTallyBusy(true);
    try {
      const { data } = await api.post(`/invoices/${id}/tally-sync`);
      setTallySync(data);
    } catch (err) {
      setNotice(err.message ?? 'Could not sync to Tally');
    } finally {
      setTallyBusy(false);
    }
  };

  const load = () => { setState((s) => ({ ...s, status: 'loading' })); fetchInvoice(); };

  useEffect(() => { fetchInvoice(); fetchTallyStatus(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = async () => {
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/issue`);
      setNotice('Invoice issued.');
      load();
    } catch (err) {
      setNotice(err.message ?? 'Could not issue invoice');
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = async () => {
    if (cancelReason.trim().length < 3) { setNotice('A cancellation reason (at least 3 characters) is required.'); return; }
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/cancel`, { reason: cancelReason.trim() });
      setNotice('Invoice cancelled.');
      setShowCancel(false);
      load();
    } catch (err) {
      setNotice(err.message ?? 'Could not cancel invoice');
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async (method) => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { blob, fileName } = method === 'post' ? await api.postBlob(`/invoices/${id}/pdf`) : await api.getBlob(`/invoices/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      const link = document.createElement('a');
      link.href = url; link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setPdfError(err.message ?? 'Could not load the invoice PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  const inv = state.invoice;
  const isDraft = inv.invoiceStatus === 'DRAFT';
  const isIssued = inv.invoiceStatus === 'ISSUED';
  const canCancel = (isDraft || isIssued) && can(user, 'invoices.cancel');

  return (
    <>
      <PageHeader
        title={inv.invoiceNumber}
        subtitle={formatDate(inv.invoiceDate)}
        actions={(
          <div className="toolbar" style={{ alignItems: 'center' }}>
            <StatusBadge status={inv.invoiceStatus} />
            <StatusBadge status={inv.paymentStatus} />
            {isDraft && can(user, 'invoices.update') && (
              <Button onClick={() => navigate(`/client/invoices/${id}/edit`)}>Edit draft</Button>
            )}
            {isDraft && can(user, 'invoices.issue') && (
              <Button variant="primary" disabled={busy} onClick={issue}>Issue</Button>
            )}
            {isDraft && can(user, 'invoices.view') && (
              <Button disabled={pdfBusy} onClick={() => openPdf('get')}>Preview Invoice (Draft)</Button>
            )}
            {!isDraft && can(user, 'invoices.view') && (
              <Button disabled={pdfBusy} onClick={() => openPdf('get')}>View/Download PDF</Button>
            )}
            {!isDraft && can(user, 'invoices.update') && (
              <Button disabled={pdfBusy} onClick={() => openPdf('post')}>Regenerate PDF</Button>
            )}
            <Button onClick={() => window.print()}>Print</Button>
            {canCancel && (
              <Button variant="danger" onClick={() => setShowCancel(true)}>Cancel</Button>
            )}
          </div>
        )}
      />

      {notice && <p className="state" role="status">{notice}</p>}
      {pdfBusy && <p className="state" role="status">Preparing the PDF…</p>}
      {pdfError && <AlertNotice tone="bad">{pdfError}</AlertNotice>}

      <Modal
        open={showCancel}
        onClose={() => setShowCancel(false)}
        title="Cancel invoice"
        footer={(
          <>
            <Button onClick={() => setShowCancel(false)}>Back</Button>
            <Button variant="danger" disabled={busy} onClick={confirmCancel}>
              Confirm cancellation
            </Button>
          </>
        )}
      >
        <FormField label="Reason" required hint="At least 3 characters">
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Enter reason for cancelling this invoice…"
            required
          />
        </FormField>
      </Modal>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
        <Card>
          <CardHeader title="Supplier" />
          <CardBody>
            <DefinitionList>
              <DefinitionItem label="Business" value={inv.supplierSnapshot?.businessName} />
              <DefinitionItem label="GSTIN" value={inv.supplierSnapshot?.gstin} mono />
              <DefinitionItem label="State" value={inv.supplierSnapshot?.stateCode} />
            </DefinitionList>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Customer" />
          <CardBody>
            <DefinitionList>
              <DefinitionItem label="Name" value={inv.customerSnapshot?.name} />
              <DefinitionItem label="GSTIN" value={inv.customerSnapshot?.gstin} mono />
              <DefinitionItem label="Code" value={inv.customerSnapshot?.customerCode} mono />
            </DefinitionList>
          </CardBody>
        </Card>
      </div>

      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Items" subtitle={`${inv.items?.length || 0} line items billed`} />
        <CardBody>
          <Table caption="Invoice Line Items">
            <TableHead>
              <TableRow hover={false}>
                <TableHeaderCell>Product</TableHeaderCell>
                <TableHeaderCell>HSN/SAC</TableHeaderCell>
                <TableHeaderCell numeric>Qty</TableHeaderCell>
                <TableHeaderCell numeric>Unit price</TableHeaderCell>
                <TableHeaderCell numeric>Discount</TableHeaderCell>
                <TableHeaderCell numeric>Taxable</TableHeaderCell>
                <TableHeaderCell numeric>CGST</TableHeaderCell>
                <TableHeaderCell numeric>SGST</TableHeaderCell>
                <TableHeaderCell numeric>IGST</TableHeaderCell>
                <TableHeaderCell numeric>Line total</TableHeaderCell>
              </TableRow>
            </TableHead>
            <tbody>
              {inv.items.map((it) => (
                <TableRow key={it.productId + it.lineNo}>
                  <TableCell>{it.productName ?? it.description}</TableCell>
                  <TableCell mono>{it.hsnSacCode ?? '—'}</TableCell>
                  <TableCell numeric>{it.quantity}</TableCell>
                  <TableCell numeric>{formatMoney(it.unitPrice)}</TableCell>
                  <TableCell numeric>{formatMoney(it.discount)}</TableCell>
                  <TableCell numeric>{formatMoney(it.taxableAmount)}</TableCell>
                  <TableCell numeric>{formatMoney(it.cgst)}</TableCell>
                  <TableCell numeric>{formatMoney(it.sgst)}</TableCell>
                  <TableCell numeric>{formatMoney(it.igst)}</TableCell>
                  <TableCell numeric><strong>{formatMoney(it.lineTotal)}</strong></TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Totals" />
        <CardBody>
          <DefinitionList columns={4}>
            <DefinitionItem label="Subtotal" value={formatMoney(inv.subtotal)} />
            <DefinitionItem label="Discount" value={formatMoney(inv.discount)} />
            <DefinitionItem label="Taxable amount" value={formatMoney(inv.taxableAmount)} />
            <DefinitionItem label="CGST" value={formatMoney(inv.cgst)} />
            <DefinitionItem label="SGST" value={formatMoney(inv.sgst)} />
            <DefinitionItem label="IGST" value={formatMoney(inv.igst)} />
            <DefinitionItem label="Total tax" value={formatMoney(inv.totalTax)} />
            <DefinitionItem label="Grand total">
              <strong style={{ fontSize: '18px', color: 'var(--ink-primary)' }}>{formatMoney(inv.grandTotal)}</strong>
            </DefinitionItem>
          </DefinitionList>
        </CardBody>
      </Card>

      {(inv.notes || inv.termsAndConditions) && (
        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Notes & Terms" />
          <CardBody>
            {inv.notes && <p style={{ margin: '0 0 0.5rem 0' }}>{inv.notes}</p>}
            {inv.termsAndConditions && <p className="muted" style={{ margin: 0, fontSize: '13px' }}>{inv.termsAndConditions}</p>}
          </CardBody>
        </Card>
      )}

      {isIssued && can(user, 'tally.view') && (
        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader
            title="Tally sync"
            actions={(
              <StatusBadge
                status={
                  tallySync?.status === 'SYNCED' ? 'SYNCED'
                    : tallySync?.status === 'FAILED' ? 'FAILED'
                    : tallySync?.status === 'SYNCING' ? 'SYNCING'
                    : tallySync?.status === 'RETRYING' ? 'RETRYING'
                    : 'NOT_SYNCED'
                }
              />
            )}
          />
          <CardBody>
            {tallySync?.status === 'SYNCED' && (
              <DefinitionList>
                <DefinitionItem label="Voucher number" value={tallySync.voucherNumber} mono />
                <DefinitionItem label="Synced at" value={formatDate(tallySync.completedAt)} />
              </DefinitionList>
            )}
            {(tallySync?.status === 'FAILED' || tallySync?.errorMessage) && (
              <p className="state state--error" role="alert">{tallySync.errorMessage ?? 'Sync failed'}</p>
            )}
            {can(user, 'tally.sync') && (!tallySync || tallySync.status === 'NOT_SYNCED' || tallySync.status === 'FAILED' || tallySync.status === 'RETRYING') && (
              <div style={{ marginTop: '1rem' }}>
                <Button disabled={tallyBusy} onClick={triggerTallySync}>
                  {tallyBusy ? 'Syncing…' : tallySync?.status === 'FAILED' ? 'Retry sync' : 'Sync to Tally'}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {inv.invoiceStatus === 'CANCELLED' && (
        <Card style={{ borderColor: 'var(--bad)' }}>
          <CardHeader title="Cancellation Details" />
          <CardBody>
            <p style={{ color: 'var(--bad)', fontWeight: 600 }}>{inv.cancellationReason}</p>
            <p className="muted" style={{ fontSize: '13px' }}>Cancelled on {formatDate(inv.cancelledAt)}</p>
          </CardBody>
        </Card>
      )}
    </>
  );
}
