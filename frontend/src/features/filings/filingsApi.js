import { useEffect, useState } from 'react';
import { api } from '../../services/apiClient.js';

/** Small shared data hook for this feature's list/detail pages — mirrors the pattern used in features/vendors/vendorsApi.js. */
export function useFetch(path, deps = [], opts) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    api.get(path, opts).then((r) => live && setState({ status: 'ready', data: r.data, error: null }))
      .catch((error) => live && setState({ status: 'error', data: null, error }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reloadToken, ...deps]);
  return { ...state, reload: () => setReloadToken((t) => t + 1) };
}

export const RETURN_TYPES = ['GSTR_1', 'GSTR_3B'];
export const FILING_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'SUBMITTED', 'FILED'];
export const ISSUE_TYPES = ['MISSING_DATA', 'GST_MISMATCH', 'INVOICE_MISMATCH', 'CUSTOMER_DATA', 'PRODUCT_DATA', 'TALLY_SYNC', 'TAX_CALCULATION', 'DOCUMENT', 'OTHER'];
export const ISSUE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
