import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/modules/storage/store.js';

test('desktop worker fetches due photos, commits unique comments, retains data on failure and rejects stale completions', async t => {
  let now = Date.now();
  t.mock.method(Date,'now',()=>now);
  const db = new Store(':memory:',async () => {throw new Error('unexpected Python call');},true);
  t.after(()=>db.close());
  const m = db.addMonitor('照片','https://www.facebook.com/photo/?fbid=123',false,1);
  await db.tick();
  const first=db.claimBrowserJob()!;
  assert.equal(first.id,m.id);
  assert.equal(db.claimBrowserJob(),null);
  db.finishBrowserJob(m.id,first.token,{title:'Photo title',comments:[{id:'1',text:'How much?'}]});
  assert.equal(db.monitors(false)[0].status,'monitoring');
  assert.equal(db.claimBrowserJob(),null);
  now+=60000;
  const second=db.claimBrowserJob()!;
  db.finishBrowserJob(m.id,second.token,{title:'Photo title',comments:[{id:'1',text:'How much?'},{id:'2',text:'Thanks'}]});
  assert.equal(db.commentDetails(m.id).length,2);
  now+=60000;
  const third=db.claimBrowserJob()!;
  db.finishBrowserJob(m.id,third.token,{error:'browser offline'});
  assert.equal(db.commentDetails(m.id).length,2);
  now+=60000;
  const last=db.claimBrowserJob()!;
  db.updateMonitor(m.id,true,false);
  assert.throws(()=>db.finishBrowserJob(m.id,last.token,{error:'late'}));
  assert.equal(db.claimBrowserJob(),null);
});

test('authenticated reads are opted in per real monitor and excluded from demo jobs', async t => {
  const calls: boolean[] = [];
  const store = new Store(':memory:', async (_url, _onTitle, authenticated = false) => {
    calls.push(authenticated);
    return { title: 'Post', comments: [] };
  });
  t.after(() => store.close());
  const url = 'https://www.facebook.com/reel/123';
  const real = store.addMonitor('test', url, false);
  const demo = store.addMonitor('test', url, true);
  store.updateMonitor(real.id, undefined, false, undefined, true);
  assert.throws(() => store.updateMonitor(demo.id, undefined, true, undefined, true));
  await store.analyzeMonitor(real.id, false);
  await store.analyzeMonitor(demo.id, true);
  assert.deepEqual(calls, [true, false]);
});

test('a failed comment page retains the title reported earlier in the read', async t => {
  const store = new Store(':memory:', async (_url, onTitle) => {
    onTitle?.('Brake pad comparison');
    throw new Error('offline');
  });
  t.after(() => store.close());
  store.addMonitor('正在获取帖子标题', 'https://www.facebook.com/reel/123', false);
  assert.equal(store.monitors(false)[0].title, 'Reel · 123');
  await store.tick();
  const monitor = store.monitors(false)[0];
  assert.equal(monitor.title, 'Brake pad comparison');
  assert.equal(monitor.syncError, 'offline');
  assert.equal(monitor.leadCount, null);
});

test('new URLs are read immediately, repeat on the saved interval and keep unique comments across failures', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  let calls = 0;
  const store = new Store(':memory:', async () => {
    calls++;
    if (calls === 3) throw new Error('offline');
    return {title:'Brake pads',comments:[{id:'c1',text:'How much?'}, ...(calls > 1 ? [{id:'c2',text:'Thanks',parentId:'c1'}] : [])]};
  });
  t.after(() => store.close());
  const url = 'https://www.facebook.com/posts/21';
  const monitor = store.addMonitor('等待首次读取',url,false,1);
  await store.tick();
  assert.equal(store.monitors(false)[0].title,'Brake pads');
  await store.tick();
  assert.equal(calls,1);
  clock += 60000;
  await store.tick();
  assert.equal(store.commentDetails(monitor.id).length,2);
  store.updateMonitor(monitor.id,undefined,false,3);
  clock += 60000;
  await store.tick();
  assert.equal(calls,2);
  store.updateMonitor(monitor.id,true,false);
  clock += 180000;
  await store.tick();
  assert.equal(calls,2);
  store.updateMonitor(monitor.id,false,false);
  await store.tick();
  assert.equal(store.monitors(false)[0].syncError,'offline');
  assert.equal(store.commentDetails(monitor.id).length,2);
  const other = store.addMonitor('待获取',url,true,2);
  await store.tick();
  assert.equal(store.commentDetails(other.id,true).length,2);
  assert.equal(store.commentDetails(other.id,false).length,0);
});

test('network errors preserve the last account check only for the checked key', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.saveBrightDataKey('local-test-key');
  let disconnected = false;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://api.brightdata.com/status');
    if (disconnected) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    return Response.json({ can_make_requests: false });
  });
  const checked = await store.checkBrightDataStatus();
  assert.equal(checked.canMakeRequests, false);
  disconnected = true;
  await assert.rejects(store.checkBrightDataStatus(), /ECONNRESET/);
  assert.deepEqual(store.brightDataStatus, checked);
  store.saveBrightDataKey('replacement-key');
  assert.equal(store.brightDataStatus, undefined);
});
