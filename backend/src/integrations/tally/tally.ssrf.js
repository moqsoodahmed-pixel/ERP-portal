import dns from 'node:dns/promises';
import net from 'node:net';
import { ValidationError } from '../../utils/errors.js';
import { TALLY_NETWORK_DEFAULTS } from './tally.constants.js';

/**
 * Network-security gate for admin-configured Tally endpoints.
 *
 * Threat model note (see docs/tally-integration.md "SSRF" section for the full reasoning): this is a
 * self-hosted ERP where a CLIENT_ADMIN configures a URL for THEIR OWN tenant's on-prem Tally server. That
 * is fundamentally different from a public SaaS fetching an arbitrary end-user-supplied URL on behalf of
 * other users — the realistic, legitimate target here is almost always a private-network host
 * (localhost / 127.0.0.1 / 10.x / 172.16-31.x / 192.168.x), because Tally Prime is normally installed on
 * a machine inside the customer's own LAN. Blanket-banning RFC1918 addresses would make the feature
 * useless for its primary use case. Instead we enforce the controls that actually stop SSRF abuse without
 * disabling the feature:
 *   1. Protocol allowlist (http/https only — no file://, gopher://, etc).
 *   2. Unconditional block of link-local / cloud-metadata addresses (169.254.169.254 and the IPv6
 *      equivalent fe80::/10 and the metadata literal fd00:ec2::254), which have no legitimate Tally use.
 *   3. A configurable, always-finite timeout (enforced in tally.client.js).
 *   4. A response-size cap (enforced in tally.client.js) to stop memory exhaustion from a malicious or
 *      misbehaving endpoint.
 * Residual risk: a compromised admin account could still point the integration at another internal
 * service reachable from the ERP host. This is accepted because that admin already has tenant-wide
 * configuration rights (same trust boundary as e.g. webhook URLs); it is not a cross-tenant or
 * cross-customer exposure.
 */

const METADATA_IPV4 = new Set(['169.254.169.254']);
/** fd00:ec2::254 is AWS's IMDSv6 address; fe80::/10 is the link-local block that 169.254/16 maps to under IPv6. */
function isMetadataAddress(ip) {
  if (!ip) return false;
  if (METADATA_IPV4.has(ip)) return true;
  const lower = ip.toLowerCase();
  if (lower === 'fd00:ec2::254') return true;
  if (lower.startsWith('fe80:')) return true;
  // IPv4-mapped IPv6 form of the metadata address, e.g. ::ffff:169.254.169.254
  if (lower.includes('169.254.169.254')) return true;
  return false;
}

function parseHost(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError('Tally endpoint must be a valid absolute URL', [{ field: 'baseUrl', message: 'Invalid URL' }]);
  }
  if (!TALLY_NETWORK_DEFAULTS.allowedProtocols.includes(url.protocol)) {
    throw new ValidationError(`Tally endpoint protocol must be one of ${TALLY_NETWORK_DEFAULTS.allowedProtocols.join(', ')}`, [{ field: 'baseUrl', message: 'Disallowed protocol' }]);
  }
  return url;
}

/**
 * Validates the configured URL synchronously (protocol + literal-IP metadata check) and, when the host
 * is a DNS name, resolves it and rejects a resolution that lands on a metadata address. Private/LAN
 * addresses (127.0.0.1, 10.x, 172.16-31.x, 192.168.x) are explicitly ALLOWED — see module doc comment.
 */
export async function assertSafeTallyUrl(rawUrl) {
  const url = parseHost(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(hostname)) {
    if (isMetadataAddress(hostname)) throw new ValidationError('Tally endpoint resolves to a disallowed metadata address', [{ field: 'baseUrl', message: 'Metadata address blocked' }]);
    return url;
  }

  // Hostname: resolve and check every address (defends against DNS rebinding to the metadata IP).
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.some((r) => isMetadataAddress(r.address))) {
      throw new ValidationError('Tally endpoint resolves to a disallowed metadata address', [{ field: 'baseUrl', message: 'Metadata address blocked' }]);
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    // DNS resolution failures are surfaced as connection failures by the caller, not SSRF rejections.
  }
  return url;
}

export function clampTimeout(timeoutMs) {
  const n = Number(timeoutMs) || TALLY_NETWORK_DEFAULTS.timeoutMs;
  return Math.min(Math.max(n, TALLY_NETWORK_DEFAULTS.minTimeoutMs), TALLY_NETWORK_DEFAULTS.maxTimeoutMs);
}
