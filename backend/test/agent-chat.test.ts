import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFromPhoto, analyzeImage } from '../src/modules/catalog/agent-chat.js';

test('photo markings retain both products sharing one code and reject partial codes', () => {
  const match = (code:string) => candidatesFromPhoto({observation:'旧件编号', markings:[code], candidates:[]},[]);
  assert.deepEqual(match('QT435SH10-3502572FW').candidates.map(c=>c.model), ['JH6后A','JH6后B']);
  assert.equal(match('3502105-FA99').candidates.length,0);
  assert.equal(match('WVA29017').candidates[0].specifications[0].coefficient,null);
});

test('image candidates use an actual archived feature and a supported catalog formula', () => {
  const shapes=[{model:'解放J6后B',summary:'弧面上可见交错圆孔',reviewed:false}];
  const result=candidatesFromPhoto({observation:'可见圆孔',markings:[],candidates:[
    {index:0,evidence:'可见交错圆孔'}, {index:9,evidence:'编号不明'}, {index:0,evidence:'供货价99元'}
  ]},shapes);
  assert.equal(result.candidates.length,1);
  const row=result.candidates[0].specifications[0];
  assert.equal(row.page,12);
  assert.ok(Math.abs(row.coefficient!-1.589599)<1e-8);
  assert.equal(result.candidates[0].evidence.length,1);
});

test('forwards actual pixels to configured vision endpoint and handles invalid input', async () => {
  const cfg={baseUrl:'https://model.test/v1',model:'vision-test',apiKey:'test-only'};
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZkAAAAASUVORK5CYII=';
  const previous=globalThis.fetch;
  try {
    globalThis.fetch=async (url,options) => {
      assert.equal(url,'https://model.test/v1/chat/completions');
      const payload=JSON.parse(String(options?.body));
      assert.deepEqual(payload.messages[1].content[1],{type:'image_url',image_url:{url:photo}});
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({observation:'无可辨认的零件',markings:[],candidates:[]})}}]});
    };
    assert.equal((await analyzeImage(cfg,photo,'',[])).candidates.length,0);
    await assert.rejects(analyzeImage(cfg,'data:image/jpeg;base64,dGVzdA==','',[]),/无法读取图片/);
    await assert.rejects(analyzeImage({...cfg,apiKey:''},photo,'',[]),/配置设置/);
  } finally {globalThis.fetch=previous;}
});
