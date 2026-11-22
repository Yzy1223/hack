import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ModelReplies } from '../src/modules/deskcomm/model-replies.js';
import { readPhoto } from '../src/modules/deskcomm/media.js';
import { inquiryEvidence, firstBatch } from '../src/modules/catalog/evidence.js';
import type { Message, Inquiry } from '../../shared/contracts.js';

const incoming = (text: string): Message => ({
  id: 'm1',
  direction: 'inbound',
  time: new Date().toISOString(),
  text,
});
const rows = (...texts: string[]) => inquiryEvidence(texts.map(incoming));
test('J6 rear, hole count, catalogue citation and customer quantity', () => {
  const e = rows('J6', '后桥', '16孔', '100 pieces');
  assert.deepEqual(
    e.rows.map((r) => r.model),
    ['解放J6后B'],
  );
  assert.equal(e.rows[0].id, 'GL-P12-C3-R01');
  assert.equal(e.quantity, '100 pieces');
});
test('CA485 fronts require arc length, including a bare answer or full dimensions', () => {
  const evidence = rows('CA485前', '8孔');
  assert.match(evidence.nextQuestion, /外弧长度/);
  assert.equal(evidence.rows.length, 2);
  const result = inquiryEvidence([
    incoming('CA485前'),
    { ...incoming(evidence.nextQuestion), direction: 'outbound' },
    incoming('202 mm'),
  ]);
  assert.equal(result.rows[0].model, 'CA485前B');
  assert.deepEqual(
    rows('CA485前', '208×160×16/20').rows.map((r) => r.model),
    ['CA485前A'],
  );
});
test('conflicting and tentative measurements and later corrections', () => {
  assert.equal(rows('CA485前', '7孔').conflict, true);
  assert.equal(rows('CA485前', '可能7孔').rows.length, 2);
  assert.equal(rows('CA485前', '7孔', '8孔').rows.length, 2);
});
test('six independently checked source rows have illustrations', () => {
  assert.equal(firstBatch().length, 6);
  for (const row of firstBatch())
    assert.equal(
      readFileSync(new URL('../resources/checked/' + row.id + '.webp', import.meta.url)).toString(
        'ascii',
        8,
        12,
      ),
      'WEBP',
    );
});
test('storage redirects omit CRM credentials and validate the bytes', async () => {
  const cfg = { deskcommUrl: 'https://crm.example', apiToken: 'test', sessionCookie: '' };
  const bytes = readFileSync(new URL('../resources/checked/GL-P12-C3-R01.webp', import.meta.url));
  let count = 0;
  const result = await readPhoto(cfg, 'm1', async (url, opts) => {
    if (!count++) {
      assert.equal(new Headers(opts?.headers).get('authorization'), 'Bearer test');
      return Response.redirect(
        'https://sample.supabase.co/storage/v1/object/sign/whatsapp-media/test',
        302,
      );
    }
    assert.equal(new Headers(opts?.headers).get('authorization'), null);
    return new Response(bytes, { headers: { 'Content-Type': 'image/webp' } });
  });
  assert.equal(count, 2);
  assert.deepEqual(result.bytes, bytes);
  await assert.rejects(() =>
    readPhoto(cfg, 'm2', async () => Response.redirect('https://example.com/file', 302)),
  );
});
test('image-only inquiry reaches the vision request, filters invented candidates, persists evidence and replies once', async () => {
  const db = new DatabaseSync(':memory:');
  const service = new ModelReplies(db, () => ({
    apiKey: 'test',
    baseUrl: 'http://test.invalid',
    model: 'vision-test',
  }));
  const chat = { id: 'c1', channel: 'whatsapp', owner: 'human' } as Inquiry;
  const messages: Message[] = [];
  const bytes = readFileSync(new URL('../resources/checked/GL-P12-C3-R01.webp', import.meta.url));
  const sends: string[] = [];
  const crm = {
    inquiries: async () => ({ items: [chat], hasMore: false }),
    messages: async () => messages,
    setAi: async () => ({}),
    photo: async () => ({ bytes, mime: 'image/webp' }),
    send: async (_c: string, text: string) => {
      sends.push(text);
      return {};
    },
  };
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const prompt = body.messages[1].content;
    let content: string;
    if (++requests === 1) {
      assert.equal(prompt[1].image_url.url, 'data:image/webp;base64,' + bytes.toString('base64'));
      content = JSON.stringify({
        observation: '可见规则孔列',
        candidates: [
          { index: 99, evidence: '虚构' },
          { index: 0, evidence: '孔列清晰可见' },
        ],
      });
    } else {
      assert.match(prompt, /解放J6后B/);
      content = '请提供旧件编号以便复核。';
    }
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
  };
  try {
    await service.toggle(crm, 'c1', true);
    messages.push({ ...incoming(''), mediaType: 'image' });
    const shapes = [{ model: '解放J6后B', summary: '孔列清晰可见', reviewed: false }];
    await service.tick(crm, shapes);
    await service.tick(crm, shapes);
    assert.deepEqual(sends, ['请提供旧件编号以便复核。']);
    assert.equal(service.withPhotos('c1', messages)[0].photoMatch?.candidates.length, 1);
    assert.equal(
      service.withPhotos('c1', [{ ...messages[0], revoked: true }])[0].photoMatch,
      undefined,
    );
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});
