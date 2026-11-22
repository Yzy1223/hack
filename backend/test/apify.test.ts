import assert from 'node:assert/strict';
import test from 'node:test';
import { probeApify } from '../src/modules/facebook/apify.js';
import { Store } from '../src/modules/storage/store.js';

test('Apify PoC separates caption failure from matching unique comments and limits both runs', async t => {
  const url = 'https://www.facebook.com/photo/?fbid=123';
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (endpoint: URL, init: RequestInit) => {
    calls.push(endpoint.pathname);
    assert.ok(!endpoint.href.includes('test-secret'));
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer test-secret');
    if (init.method === 'POST') {
      assert.equal(endpoint.searchParams.get('maxTotalChargeUsd'),'0.05');
      const input=JSON.parse(String(init.body));
      assert.deepEqual(input.startUrls,[{url}]);
      const id=endpoint.pathname.includes('posts-scraper')?'post':'comments';
      if (id==='comments') assert.equal(input.includeNestedComments,true);
      return Response.json({data:{id,status:'READY'}});
    }
    if (endpoint.pathname.endsWith('/runs')) return Response.json({data:{items:[]}});
    if (endpoint.pathname.includes('/actor-runs/')) {
      const id=endpoint.pathname.split('/').pop();
      return Response.json({data:{id,status:'SUCCEEDED',defaultDatasetId:id}});
    }
    if (endpoint.pathname.includes('/datasets/post/')) return Response.json([{postId:'321',text:'Another post'}]);
    return Response.json([{inputUrl:url,commentId:'c1',text:'How much?'},{inputUrl:url,commentId:'c1',text:'How much?'},
      {inputUrl:'https://www.facebook.com/photo/?fbid=456',commentId:'c2',text:'Other'}]);
  });
  const result = await probeApify('test-secret',url);
  assert.equal(calls.length,7);
  assert.equal(result.title,null);
  assert.ok(result.titleError);
  assert.deepEqual(result.comments,[{id:'c1',text:'How much?'}]);
});

test('real Apify monitors run without a browser and persist comment IDs', async t => {
  const store = new Store(':memory:', undefined, false, true);
  t.after(()=>store.close());
  t.mock.method(store,'probe',async()=>({title:'Test caption',comments:[{id:'a',text:'How much?'}]}));
  const monitor=store.addMonitor('Pending','https://www.facebook.com/reel/123',false);
  await store.tick();
  const saved=store.monitors(false)[0];
  assert.equal(saved.provider,'apify');
  assert.equal(saved.browserOnline,undefined);
  assert.equal(saved.title,'Test caption');
  assert.equal(store.commentDetails(monitor.id)[0].buyingIntent,true);
  await store.analyzeMonitor(monitor.id);
  assert.equal(store.commentDetails(monitor.id).length,1);
});

test('a legacy Facebook Graph ID and its numeric comment ID count once across collections', async t => {
  const store = new Store(':memory:',undefined,false,true);
  t.after(()=>store.close());
  const monitor = store.addMonitor('Reel','https://www.facebook.com/reel/123',false);
  const oldId = Buffer.from('comment:123_456').toString('base64');
  store.saveBrowserComments(monitor.url,'Reel',[{id:oldId,text:'How much?'}]);
  t.mock.method(store,'probe',async()=>({title:'Reel',comments:[{id:'456',text:'How much?',author:'buyer'}]}));
  await store.analyzeMonitor(monitor.id);
  assert.equal(store.commentDetails(monitor.id).length,1);
  assert.equal(store.commentDetails(monitor.id)[0].author,'buyer');
  assert.equal(store.monitors(false)[0].leadCount,1);
});

test('a Reel comment carries the original caption, author and date without a second paid run', async t => {
  const url = 'https://www.facebook.com/reel/123';
  const runs: string[] = [];
  t.mock.method(globalThis, 'fetch', async (endpoint: URL, init: RequestInit) => {
    if (init.method === 'POST') {
      runs.push(endpoint.pathname);
      const input = JSON.parse(String(init.body));
      assert.equal(input.viewOption, 'RECENT_ACTIVITY');
      assert.equal(input.resultsLimit, undefined);
      assert.equal(endpoint.searchParams.get('maxTotalChargeUsd'), '0.05');
      return Response.json({data:{id:'comments',status:'SUCCEEDED',defaultDatasetId:'dataset'}});
    }
    if (endpoint.pathname.endsWith('/runs')) return Response.json({data:{items:[]}});
    return Response.json([{facebookUrl:url,commentId:'c1',text:'Interested',postTitle:'Brake pads',profileName:'Buyer',profileId:'p1',date:'2026-01-01'}]);
  });
  const result = await probeApify('test',url,undefined,true);
  assert.equal(runs.length,1);
  assert.equal(result.title,'Brake pads');
  assert.deepEqual(result.comments,[{id:'c1',text:'Interested',authorName:'Buyer',author:'p1',date:'2026-01-01'}]);
});

test('a photo caption can belong to the parent post linked by its verified comments', async t => {
  const url = 'https://www.facebook.com/photo/?fbid=123';
  const parent = 'https://www.facebook.com/example/posts/pfbid123';
  t.mock.method(globalThis, 'fetch', async (endpoint: URL, init: RequestInit) => {
    if (init.method === 'POST') {
      const post = endpoint.pathname.includes('posts-scraper');
      assert.deepEqual(JSON.parse(String(init.body)).startUrls, [{url:post ? parent : url}]);
      return Response.json({data:{id:'run',status:'SUCCEEDED',defaultDatasetId:post?'post':'comments'}});
    }
    if (endpoint.pathname.endsWith('/runs')) return Response.json({data:{items:[]}});
    if (endpoint.pathname.includes('/datasets/post/')) return Response.json([{facebookUrl:parent,message:{text:'Original caption'}}]);
    return Response.json([{inputUrl:url,commentUrl:parent+'?comment_id=5',commentId:'5',text:'Nice'}]);
  });
  const result = await probeApify('test',url);
  assert.equal(result.title,'Original caption');
  assert.deepEqual(result.comments,[{id:'5',text:'Nice'}]);
});
