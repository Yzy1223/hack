import { config } from './config.js';
import { AppError } from './lib/errors.js';

// This local entry point only exercises the cloud CRM and its WhatsApp session.
if (!config.deskcommUrl || !config.sessionCookie) {
  throw new Error('Missing DeskcommCRM trial configuration in backend/.env');
}
const crm = new URL(config.deskcommUrl);
if (crm.protocol !== 'https:') throw new Error('The trial CRM must use HTTPS');
const send = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.origin === 'https://api.apify.com' && url.origin !== crm.origin) {
    throw new AppError(409, 'whatsapp_trial_only', '此入口仅用于 WhatsApp。请在 http://127.0.0.1:4310/ 的 Facebook 监控中采集评论。');
  }
  if (url.origin !== crm.origin) throw new Error('Only the configured CRM is enabled in this trial');
  return send(input, { ...options, redirect: 'error' });
};
config.port = 4312;
config.container = false;
config.dataPath = ':memory:';
await import('./server.js');
