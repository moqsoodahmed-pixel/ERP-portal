import { useFetch } from '../bills/billsApi.js';

/**
 * Phase 16.1 — Tally Connector Management UI data layer. Mirrors features/bills/billsApi.js's useFetch
 * hook (shared data-fetching convention). The connector's raw secret is returned ONLY in the register/rotate
 * response body (never from list/get) and is never persisted here beyond in-memory component state — see
 * ConnectorListPage.jsx.
 */
export { useFetch };

export const CONNECTOR_BACKEND_STATUSES = ['ACTIVE', 'INACTIVE', 'REVOKED'];

/**
 * The backend only ever stores ACTIVE / INACTIVE / REVOKED (constants/statuses.js#TALLY_CONNECTOR_STATUS).
 * "Offline" / "Online" / "Never connected" are purely client-side display labels derived from that status
 * plus lastHeartbeatAt/offlineSince — no new backend status is invented here (spec: do not invent statuses).
 */
export function deriveConnectorDisplayStatus(connector) {
  if (!connector) return { label: 'Unknown', tone: 'neutral' };
  if (connector.status === 'REVOKED') return { label: 'Revoked', tone: 'bad' };
  if (connector.status === 'INACTIVE') return { label: 'Offline', tone: 'bad' };
  // status === 'ACTIVE' from here
  if (!connector.lastHeartbeatAt) return { label: 'Never connected', tone: 'neutral' };
  return { label: 'Online', tone: 'ok' };
}
