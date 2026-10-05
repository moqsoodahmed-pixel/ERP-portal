import { IntegrationError } from '../../utils/errors.js';

/** Port for email/SMS providers. NOT IMPLEMENTED — no provider has been selected. */
export class NotificationAdapter {
  async send() { throw new IntegrationError('Notification provider is not implemented', 'NOTIFICATION_NOT_IMPLEMENTED', 501); }
}
