import { useEffect, useState } from 'react';
import { api } from '../../services/apiClient.js';

/** Mirrors the shared data hook pattern used by features/filings/filingsApi.js. */
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

export const BILL_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'READY_FOR_TALLY', 'ACCOUNTING_IN_PROGRESS', 'COMPLETED', 'REJECTED', 'FAILED'];
export const TALLY_STATUSES = ['NOT_READY', 'QUEUED', 'PROCESSING', 'SYNCED', 'FAILED'];

/** Reads a File as a base64 string (no multipart upload stack exists in this backend — see docs/bill-intake-workflow.md). */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
