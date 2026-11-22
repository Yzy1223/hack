import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/modules/storage/store.js';
import type { Message } from '../../shared/contracts.js';

test('shared model classifies collected comments, keeps explicit negatives, caches and retries', async t => {
  let texts = ['How much?', 'My fleet needs twelve sets.'];
  const store = new Store(':memory:', async () => ({title:'Brake parts', comments:texts.map((text,i) => ({id:String(i), text}))}));
  t.after(() => store.close());
  store.saveLlmSettings('https://model.example/v1', 'trade', 'test-key');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++;
    assert.equal(url,'https://model.example/v1/chat/completions');
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-key');
    assert.equal(JSON.parse(String(options.body)).model,'trade');
    return Response.json({choices:[{message:{content: calls === 1 ? '[false,true]' : calls === 2 ? 'broken' : '[true]'}}]});
  });
  const item = store.addMonitor('Post','https://www.facebook.com/posts/42', false);
  await store.analyzeMonitor(item.id);
  assert.deepEqual(store.commentDetails(item.id).map(c => c.buyingIntent), [false,true]);
  assert.equal(store.monitors(false)[0].leadCount, 1);
  await store.analyzeMonitor(item.id);
  assert.equal(calls,1);
  texts = ['Please quote for 25 units.', texts[1]];
  await store.analyzeMonitor(item.id);
  assert.match(store.monitors(false)[0].syncError!, /模型判断/);
  await store.analyzeMonitor(item.id);
  assert.equal(store.monitors(false)[0].leadCount, 2);
  assert.equal(calls,3);
});

test('WhatsApp takeover pauses native bot, replies once to new inbound and stops on handoff', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.saveLlmSettings('https://model.example/v1/chat/completions','trade','test-key');
  const item = {...store.inquiries()[0], channel:'whatsapp' as const, owner:'human' as const};
  let history: Message[] = [{id:'old', time:new Date().toISOString(), direction:'inbound', text:'Old'}];
  const toggles: boolean[] = [], sends: string[] = [];
  const crm = {
    inquiries: async () => ({items:[item],hasMore:false}), messages: async () => history,
    setAi: async (_id:string,on:boolean) => { toggles.push(on); return {}; },
    send: async (_id:string,body:string) => { sends.push(body); return {}; },
  };
  const provider = t.mock.method(globalThis, 'fetch', async (url:string, options:RequestInit) => {
    assert.equal(url,'https://model.example/v1/chat/completions');
    assert.equal(JSON.parse(String(options.body)).model,'trade');
    return Response.json({choices:[{message:{content:'Can you share the OE number?'}}]});
  });
  const worker = store.modelReplies;
  await worker.toggle(crm,item.id,true);
  assert.deepEqual(toggles,[false]);
  assert.equal(worker.annotate([item])[0].localAi,true);
  await worker.tick(crm);
  assert.equal(provider.mock.callCount(),0);
  history.push({...history[0], id:'new', text:'Need pads', time:new Date().toISOString()});
  await Promise.all([worker.tick(crm), worker.tick(crm)]);
  await worker.tick(crm);
  assert.deepEqual(sends,['Can you share the OE number?']);
  await worker.toggle(crm,item.id,false);
  history = [{...history[1],id:'newer'}];
  await worker.tick(crm);
  assert.equal(provider.mock.callCount(),1);
});
