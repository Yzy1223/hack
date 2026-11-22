import express from 'express';
import { fileURLToPath } from 'node:url';
import { inquiryEvidence, firstBatch } from './modules/catalog/evidence.js';
import { z } from 'zod';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { Store } from './modules/storage/store.js';
import { CatalogService } from './modules/catalog/service.js';
import { DeskcommService } from './modules/deskcomm/service.js';
import { facebookUrl, postLabel } from './modules/facebook/validation.js';
import { AppError } from './lib/errors.js';
import type { Connection, Workspace } from '../../shared/contracts.js';

export function createApp(store: Store, crm: DeskcommService, catalog: CatalogService) {
  const app = express();
  app.disable('x-powered-by');
  if (config.container) {
    const digest = (value: string) => createHash('sha256').update(value).digest();
    const expected = digest('Basic ' + Buffer.from('demo:' + config.accessPassword).toString('base64'));
    app.get('/healthz', (_req, res) => res.sendStatus(200));
    app.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!timingSafeEqual(digest(req.headers.authorization || ''), expected)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Inquiry Workbench", charset="UTF-8"');
        res.sendStatus(401);
        return;
      }
      next();
    });
  }
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const host = (req.headers.host || '').split(':')[0];
    if (!config.container && !['127.0.0.1', 'localhost'].includes(host)) {
      res.status(403).json({ error: { message: '仅允许本机访问' } });
      return;
    }
    const origin = req.headers.origin;
    const workerRoute = req.path === '/api/browser-worker/claim' || req.path === '/api/browser-worker/result';
    if (workerRoute && !config.container && store.useBrowser && origin === 'chrome-extension://hjmkfeihbpnlomadpkdkjajnonglfbfd'
        && req.method === 'POST' && req.headers['x-workbench-request'] === '1') return next();
    if (workerRoute) { res.sendStatus(403); return; }
    const allowedOrigin = config.container
      ? origin === 'https://' + req.headers.host
      : [5173, config.port].some((port) =>
          ['127.0.0.1', 'localhost'].some((hostname) => origin === 'http://' + hostname + ':' + port),
        );
    if (origin && !allowedOrigin) {
      res.status(403).json({ error: { message: '来源不受信任' } });
      return;
    }
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['x-workbench-request'] !== '1'
    ) {
      res.status(403).json({ error: { message: '请求校验失败' } });
      return;
    }
    next();
  });
  app.post('/api/browser-worker/claim', (_req,res) => res.json({job:store.claimBrowserJob()}));
  app.post('/api/browser-worker/result', express.json({limit:'3mb'}), (req,res) => {
    const comment = z.object({id:z.string().min(1).max(400),text:z.string().max(8000),authorName:z.string().max(256).optional(),parentId:z.string().max(400).optional()});
    const {id,token,result} = z.object({id:z.uuid(),token:z.uuid(),result:z.union([
      z.object({title:z.string().min(1).max(160),comments:z.array(comment).max(1500),notice:z.string().max(350).optional()}),z.object({error:z.string().min(1).max(350)})
    ])}).parse(req.body);
    store.finishBrowserJob(id,token,result);
    res.json({ok:true});
  });
  app.use(express.json({ limit: '64kb' }));
  const demo = (req: express.Request) => req.query.demo === 'true';
  const id = (req: express.Request) =>
    z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .parse(req.params.id);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', catalogCount: catalog.count(), settingsVersion: 2 }));
  app.get('/api/workspace', async (req, res) => {
    const isDemo = demo(req);
    const connection: Connection = {
      configured: crm.client.configured,
      adminSessionConfigured: Boolean(crm.client.config.sessionCookie),
      url: crm.client.config.deskcommUrl || null,
      sessions: [],
    };
    let inquiries = store.inquiries(),
      hasMore = false;
    if (!isDemo) {
      inquiries = [];
      if (connection.configured) {
        const [sessions, inbox] = await Promise.allSettled([crm.channels(), crm.inquiries()]);
        if (sessions.status === 'fulfilled') connection.sessions = sessions.value;
        else connection.error = sessions.reason.message;
        if (inbox.status === 'fulfilled') {
          inquiries = store.modelReplies.annotate(inbox.value.items);
          hasMore = inbox.value.hasMore;
        } else connection.error = inbox.reason.message;
      }
    }
    const result: Workspace = {
      inquiries,
      monitors: store.monitors(isDemo),
      apifyConfigured: !isDemo && Boolean(store.apifyToken),
      llmSettings: isDemo ? undefined : store.llmSettings,
      connection,
      brightDataStatus: isDemo ? undefined : store.brightDataStatus,
      brightDataConfigured: !isDemo && store.brightDataConfigured,
      demo: isDemo,
      loadedAt: new Date().toISOString(),
      hasMore,
      catalogCount: catalog.count(),
    };
    res.json(result);
  });
  app.put('/api/settings/apify', (req,res) => {
    if (demo(req)) throw new AppError(409,'demo_mode','请切换到真实数据');
    const token = z.string().trim().min(1).max(4096).regex(/^[!-~]+$/).parse(req.body?.token);
    store.saveApifyToken(token);
    res.json({configured:true});
  });
  app.put('/api/settings/llm', (req,res) => {
    if (demo(req)) throw new AppError(409,'demo_mode','请切换到真实数据');
    const {baseUrl, model, apiKey} = z.object({
      baseUrl: z.string().trim().max(2048).url(),
      model: z.string().trim().min(1).max(256),
      apiKey: z.string().trim().min(1).max(4096).optional(),
    }).parse(req.body);
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search)
      throw new AppError(422, 'invalid_llm_url', '请填写 HTTP 或 HTTPS 接入地址，密钥请单独填写。');
    res.json(store.saveLlmSettings(baseUrl, model, apiKey));
  });
  app.post('/api/settings/bright-data/check', async (req, res) => {
    if (demo(req)) throw new AppError(409, 'demo_mode', '请切换到真实数据后检查账户状态');
    res.json(await store.checkBrightDataStatus());
  });
  app.put('/api/settings/bright-data', (req, res) => {
    if (demo(req)) throw new AppError(409, 'demo_mode', '请切换到真实数据后配置密钥');
    const key = z.string().trim().regex(/^[!-~]{1,4096}$/).safeParse(req.body?.key);
    if (!key.success) throw new AppError(422, 'invalid_key', '请输入有效的 Bright Data 密钥');
    store.saveBrightDataKey(key.data);
    res.json({ configured: true });
  });
  app.get('/api/catalog', (req, res) => res.json(catalog.search(String(req.query.q || ''))));
  app.use('/api/catalog/source', express.static(fileURLToPath(new URL('../resources/checked/', import.meta.url))));
  app.get('/api/catalog/first-batch', (_req,res) => res.json(firstBatch()));
  app.get('/api/media/:id', async (req,res) => {
    if (demo(req)) throw new AppError(404,'demo_media','演示会话没有原图');
    const photo = await crm.photo(id(req));
    res.setHeader('X-Content-Type-Options','nosniff');
    res.type(photo.mime).send(photo.bytes);
  });
  app.get('/api/inquiries/:id/messages', async (req, res) => {
    const messages = demo(req) ? store.messages(id(req)) : store.modelReplies.withPhotos(id(req), await crm.messages(id(req)));
    if (req.query.evidence === '1') {
      const {rows, ...details} = inquiryEvidence(messages);
      res.json({messages, evidence:{...details, count:rows.length, rows:rows.slice(0,30)}});
    } else res.json(messages);
  });
  app.post('/api/inquiries/:id/ai', async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    res.json(demo(req) ? store.setOwner(id(req), enabled) : await store.modelReplies.toggle(crm, id(req), enabled));
  });
  app.post('/api/inquiries/read', async (req, res) => {
    const { ids } = z
      .object({
        ids: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)).max(100),
      })
      .parse(req.body);
    if (demo(req)) store.markRead(ids);
    else for (const item of ids) await crm.read(item);
    res.json({ ok: true });
  });
  app.post('/api/inquiries/:id/messages', async (req, res) => {
    const { text, key } = z
      .object({ text: z.string().trim().min(1).max(4000), key: z.uuid() })
      .parse(req.body);
    res.json(demo(req) ? store.addMessage(id(req), text) : await crm.send(id(req), text, key));
  });
  app.post('/api/whatsapp/sessions', async (req, res) => {
    if (demo(req)) throw new AppError(409, 'demo_mode', '请切换到真实数据后连接账号');
    const key = z.uuid().parse(req.headers['idempotency-key']);
    res.json(await crm.createChannel(key));
  });
  app.post('/api/whatsapp/sessions/:id/reconnect', async (req, res) =>
    res.json(await crm.reconnect(id(req))),
  );
  app.get('/api/whatsapp/sessions/:id/qr', async (req, res) => {
    const qr = await crm.qr(id(req));
    res.type(qr.mime).send(qr.bytes);
  });
  app.post('/api/monitors', (req, res) => {
    const data = z
      .object({
        title: z.string().trim().min(1).max(80).optional(),
        url: z.string().max(2048),
        intervalMinutes: z.number().int().min(1).max(1440).default(60),
      })
      .parse(req.body);
    const url = facebookUrl(data.url);
    res.status(201).json(store.addMonitor(data.title || postLabel(url), url, demo(req), data.intervalMinutes));
  });
  app.get('/api/monitors/:id/comments', (req, res) => res.json(demo(req) ? store.demoCommentDetails(id(req)) : store.commentDetails(id(req))));
  app.post('/api/monitors/:id/analyze', async (req, res) => {
    await store.analyzeMonitor(id(req), demo(req));
    res.json({ ok: true });
  });
  app.patch('/api/monitors/:id', (req, res) => {
    const data = z.object({ paused: z.boolean().optional(), intervalMinutes: z.number().int().min(1).max(1440).optional(), authenticated: z.boolean().optional() }).parse(req.body);
    res.json(store.updateMonitor(id(req), data.paused, demo(req), data.intervalMinutes, data.authenticated));
  });
  app.delete('/api/monitors/:id', (req, res) => {
    store.removeMonitor(id(req), demo(req));
    res.json({ ok: true });
  });
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof z.ZodError) {
        res.status(422).json({
          error: { code: 'invalid_input', message: '请检查填写内容' },
        });
        return;
      }
      if (err instanceof AppError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      const reference = randomUUID();
      console.error('Request failed', reference, err instanceof Error ? err.name : 'UnknownError');
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: '服务异常，请重试',
          reference,
        },
      });
    },
  );
  return app;
}
