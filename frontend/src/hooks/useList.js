import { useCallback, useEffect, useRef, useState } from 'react';
import { api, toQuery } from '../services/apiClient.js';

/** Server-side paginated list with search and status filter. Never loads whole collections. */
export function useList(path, { limit = 10 } = {}) {
  const [params, setParams] = useState({ page: 1, limit, search: '', status: '' });
  const [state, setState] = useState({ status: 'loading', items: [], pagination: null, error: null });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const { data } = await api.get(`${path}${toQuery(params)}`);
      if (id === seq.current) setState({ status: 'ready', items: data.items, pagination: data.pagination, error: null });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, status: 'error', error }));
    }
  }, [path, params]);

  useEffect(() => { load(); }, [load]);

  return {
    ...state, params, reload: load,
    setPage: (page) => setParams((p) => ({ ...p, page })),
    setSearch: (search) => setParams((p) => ({ ...p, search, page: 1 })),
    setStatus: (status) => setParams((p) => ({ ...p, status, page: 1 })),
  };
}
