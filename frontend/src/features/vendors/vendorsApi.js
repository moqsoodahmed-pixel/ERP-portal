import { useEffect, useState } from 'react';
import { api } from '../../services/apiClient.js';

/** Small shared data hook for this feature's list/detail pages. */
export function useFetch(path, deps = []) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    let live = true;
    api.get(path).then((r) => live && setState({ status: 'ready', data: r.data, error: null }))
      .catch((error) => live && setState({ status: 'error', data: null, error }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reloadToken, ...deps]);
  return { ...state, reload: () => setReloadToken((t) => t + 1) };
}
