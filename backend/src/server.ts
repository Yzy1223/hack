import path from 'node:path';
import express from 'express';
import { config, backendRoot } from './config.js';
import { Store } from './modules/storage/store.js';
import { CatalogService } from './modules/catalog/service.js';
import { DeskcommClient } from './modules/deskcomm/client.js';
import { DeskcommService } from './modules/deskcomm/service.js';
import { createApp } from './app.js';
if (config.container && config.accessPassword.length < 16) {
  throw new Error('Set WORKBENCH_PASSWORD to a private password of at least 16 characters.');
}
const store = new Store(config.dataPath, undefined, false, true);
const catalog = new CatalogService(config.catalogPath);
await catalog.load();
const crm = new DeskcommService(new DeskcommClient(config));
const app = createApp(store, crm, catalog);
app.use(express.static(path.resolve(backendRoot, '../frontend/dist')));
const host = config.container ? '0.0.0.0' : '127.0.0.1';
let active: Promise<void> | undefined;
let replyTimer: NodeJS.Timeout | undefined;
let replies: Promise<void> | undefined;
let monitorTimer: NodeJS.Timeout | undefined;
const server = app.listen(config.port, host, (error?: Error) => {
  if (error) {
    console.error('Workbench API startup failed:', error.message);
    store.close();
    process.exitCode = 1;
    return;
  }
  console.log('Workbench API listening on ' + host + ':' + config.port + ' | catalog: ' + catalog.count());
  replyTimer = setInterval(() => {
    if (!replies) replies = store.modelReplies.tick(crm).catch(() => console.error('WhatsApp inbox unavailable'))
      .finally(() => { replies = undefined; });
  }, 15000);
  monitorTimer = setInterval(() => {
    if (!active) active = store.tick().catch(() => console.error('Facebook monitor cycle failed')).finally(() => { active = undefined; });
  }, 1000);
});
function close() {
  clearInterval(monitorTimer);
  clearInterval(replyTimer);
  server.close(async () => {
    await Promise.allSettled([active, replies]);
    store.close();
    process.exit(0);
  });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
