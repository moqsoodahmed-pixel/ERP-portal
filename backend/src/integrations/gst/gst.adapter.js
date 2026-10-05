import { IntegrationError } from '../../utils/errors.js';

/** Port for GST government/ASP APIs. NOT IMPLEMENTED — no endpoints, credentials or schemas are assumed. */
export class GstAdapter {
  async submitReturn() { throw new IntegrationError('GST portal integration is not implemented', 'GST_NOT_IMPLEMENTED', 501); }
}
