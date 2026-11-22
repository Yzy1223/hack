import test from 'node:test';
import assert from 'node:assert/strict';
import { hasBuyingIntent, summarize } from '../src/modules/facebook/comments.js';
test('highlights expressed interest and keeps ordinary conversations unmarked', () => {
  for (const text of ['Interested!', '我想了解这款', 'Send me the catalogue', 'Price for 200 sets?'])
    assert.equal(hasBuyingIntent(text), true, text);
  for (const text of ['Not interested', '我不感兴趣', 'Great video', 'Interesting!'])
    assert.equal(hasBuyingIntent(text), false, text);
});
test('counts buying enquiries and deduplicates comments and known authors', () => {
  const row = { id: '1', author: 'a', text: 'Price for 200 sets?' };
  assert.deepEqual(summarize([row, row, { ...row, id: '2', text: '多少钱' },
    { id: '3', text: 'Great price!' }, { id: '4', text: 'How can I order?' }]),
    { comments: 4, leadCount: 2 });
});
