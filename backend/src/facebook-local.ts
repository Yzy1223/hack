import { config } from './config.js';

// Serve the persistent local Facebook workspace independently of the WhatsApp trial.
config.port = 4310;
config.container = false;
config.deskcommUrl = '';
config.apiToken = '';
config.sessionCookie = '';
await import('./server.js');
