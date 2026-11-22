import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/modules/storage/store.js';
import { CatalogService } from '../src/modules/catalog/service.js';
import { DeskcommClient } from '../src/modules/deskcomm/client.js';
import { DeskcommService, normalizeInquiry } from '../src/modules/deskcomm/service.js';
import { facebookUrl } from '../src/modules/facebook/validation.js';
import { createApp } from '../src/app.js';

test('Facebook links reject lookalike hosts and normalize tracking', () => {
  assert.throws(() => facebookUrl('https://facebook.com.evil.test/posts/1'));
  assert.throws(() => facebookUrl('javascript:alert(1)'));
  assert.throws(() => facebookUrl('https://person:secret@facebook.com/posts/1'));
  assert.equal(
    facebookUrl('https://www.facebook.com/posts/1?fbclid=secret'),
    'https://www.facebook.com/posts/1',
  );
});
test('Real links persist and never pretend to be monitoring', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'workbench-test-'));
  const filename = path.join(dir, 'data.sqlite');
  try {
    const store = new Store(filename);
    const row = store.addMonitor('测试链接', 'https://www.facebook.com/posts/test', false);
    assert.equal(row.status, 'pending');
    store.updateMonitor(row.id, true, false);
    store.updateMonitor(row.id, false, false);
    assert.equal(store.monitors(false)[0].status, 'pending');
    store.addMonitor('演示链接', 'https://www.facebook.com/posts/demo', true);
    assert.equal(store.monitors(false).length, 1);
    store.saveBrightDataKey("test-only-persist");
    store.close();
    const reopened = new Store(filename);
    assert.equal(reopened.brightDataConfigured, true);
    assert.equal(reopened.monitors(false)[0].title, '测试链接');
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('An admin operation cannot fall back to a bearer token', async () => {
  let called = false;
  const client = new DeskcommClient(
    { deskcommUrl: 'https://crm.example', apiToken: 'test-token', sessionCookie: '' },
    async () => {
      called = true;
      return Response.json({ data: [] });
    },
  );
  await assert.rejects(
    client.request('/api/v1/channel-sessions', { method: 'POST', admin: true }),
    /管理员/,
  );
  assert.equal(called, false);
});
test('Message adapter uses the upstream body and idempotency contract', async () => {
  const key = randomUUID();
  let sent: RequestInit | undefined;
  let url = '';
  const service = new DeskcommService(
    new DeskcommClient(
      { deskcommUrl: 'https://crm.example', apiToken: 'test-token', sessionCookie: '' },
      async (input, options) => {
        url = String(input);
        sent = options;
        return Response.json({ data: { id: 'message-1', status: 'queued' } });
      },
    ),
  );
  await service.send('conversation-1', 'Hello', key);
  assert.equal(url, 'https://crm.example/api/v1/messages');
  assert.deepEqual(JSON.parse(sent?.body as string), {
    conversation_id: 'conversation-1',
    type: 'text',
    body: 'Hello',
  });
  assert.equal((sent?.headers as Record<string, string>)['Idempotency-Key'], key);
  assert.equal(sent?.redirect, 'error');
});
test('QR adapter requires image content and keeps credentials server-side', async () => {
  const client = new DeskcommClient(
    { deskcommUrl: 'https://crm.example', apiToken: 'test-token', sessionCookie: 'test-cookie' },
    async (_input, options) => {
      assert.equal((options?.headers as Record<string, string>).Cookie, 'test-cookie');
      assert.equal((options?.headers as Record<string, string>).Authorization, undefined);
      return new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } });
    },
  );
  await assert.rejects(
    client.request('/api/v1/channel-sessions/x/qr', { admin: true, image: true }),
    /二维码/,
  );
});
test('Unconfigured AI is waiting; a model mentioned in text is not confirmation', () => {
  const row = {
    id: 'a',
    contacts: { name: 'Customer' },
    metadata: {},
    tags: [],
    last_message_preview: 'Is this 19369?',
    created_at: new Date().toISOString(),
    automatico_da_conversa: false,
  };
  const item = normalizeInquiry(row);
  assert.equal(item.owner, 'waiting');
  assert.equal(item.model, undefined);
  assert.equal(item.priority, 'low');
  assert.equal(
    normalizeInquiry({ ...row, comando_da_conversa: 'automatico', automatico_da_conversa: true })
      .owner,
    'ai',
  );
});
test('HTTP demo stays local, real workspace is empty, and cross-origin writes fail', async () => {
  const store = new Store(':memory:');
  const catalog = new CatalogService('missing-catalog');
  let calls = 0;
  const crm = new DeskcommService(
    new DeskcommClient({ deskcommUrl: '', apiToken: '', sessionCookie: '' }, async () => {
      calls++;
      throw new Error('no external calls');
    }),
  );
  const server = createApp(store, crm, catalog).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const base = 'http://127.0.0.1:' + port;
  const headers = { 'Content-Type': 'application/json', 'X-Workbench-Request': '1' };
  try {
    const real = await (await fetch(base + '/api/workspace')).json();
    assert.equal(real.inquiries.length, 0);
    assert.equal(real.connection.configured, false);
    const demo = await (await fetch(base + '/api/workspace?demo=true')).json();
    assert.equal(demo.inquiries.length, 6);
    const sample = demo.monitors.find((row: { demoSource?: string }) => row.demoSource === 'sample');
    const comments = await (await fetch(base + '/api/monitors/' + sample.id + '/comments?demo=true')).json();
    assert.equal(comments.length, sample.comments);
    assert.equal(comments.filter((row: { buyingIntent?: boolean }) => row.buyingIntent).length, 2);
    assert.ok(comments.some((row: { parentId?: string }) => row.parentId));
    assert.deepEqual(await (await fetch(base + '/api/monitors/' + sample.id + '/comments')).json(), []);

    const control = await fetch(base + '/api/inquiries/carlos/ai?demo=true', {
      method: 'POST',
      headers,
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(control.status, 200);
    assert.equal((await control.json()).owner, 'human');
    const sent = await fetch(base + '/api/inquiries/carlos/messages?demo=true', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'local test', key: randomUUID() }),
    });
    assert.equal(sent.status, 200);
    assert.equal(calls, 0);
    const secret = 'test-only-' + randomUUID();
    const baseUrl = 'https://model.example/v1';
    const updateModel = (body: object, query = '') => fetch(base + '/api/settings/llm' + query, {
      method:'PUT', headers, body:JSON.stringify(body),
    });
    assert.equal((await updateModel({baseUrl,model:'test'})).status,422);
    assert.equal((await updateModel({baseUrl,model:'test',apiKey:secret},'?demo=true')).status,409);
    const modelSaved = await updateModel({baseUrl,model:'test',apiKey:secret});
    assert.deepEqual(await modelSaved.json(),{baseUrl,model:'test',hasApiKey:true});
    assert.equal((await updateModel({baseUrl,model:'updated'})).status,200);
    assert.equal((await updateModel({baseUrl:'https://different.example',model:'updated'})).status,422);
    const settingsView = await (await fetch(base+'/api/workspace')).text();
    assert.equal(settingsView.includes(secret),false);
    assert.deepEqual(JSON.parse(settingsView).llmSettings,{baseUrl,model:'updated',hasApiKey:true});
    const save = (key: string, query = '') => fetch(base + '/api/settings/bright-data' + query, {
      method: 'PUT', headers, body: JSON.stringify({ key }),
    });
    assert.equal((await save(secret, '?demo=true')).status, 409);
    assert.equal((await save('  ')).status, 422);
    const saved = await save(secret);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { configured: true });
    const workspace = await (await fetch(base + '/api/workspace')).text();
    assert.equal(JSON.parse(workspace).brightDataConfigured, true);
    assert.equal(workspace.includes(secret), false);
    const rejected = await fetch(base + '/api/monitors', {
      method: 'POST',
      headers: { ...headers, Origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(rejected.status, 403);
    const session = await fetch(base + '/api/whatsapp/sessions', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: '{}',
    });
    assert.equal(session.status, 503);
    const added = await fetch(base + '/api/monitors', {
      method: 'POST', headers, body: JSON.stringify({ url: 'https://www.facebook.com/posts/example' }),
    });
    assert.equal(added.status, 201);
    const monitor = await added.json();
    assert.equal(monitor.status, 'pending');
    assert.deepEqual(await (await fetch(base + '/api/monitors/' + monitor.id + '/comments')).json(), []);
    const invalid = await fetch(base + '/api/monitors', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'wrong', url: 'https://evil.example' }),
    });
    assert.equal(invalid.status, 422);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
