import { AppError } from '../../lib/errors.js';

import type { MonitorComment as Comment } from '../../../../shared/contracts.js';
const inquiry =
  /多少钱|怎么卖|怎么下单|想采购|请报价|能报.{0,4}价|有现货吗|起订量是多少|\bhow much\b|\b(?:can|could|please) (?:you )?(?:send (?:me |us )?a quote|quote|provide (?:a )?(?:price|quote))\b|\b(?:where|how) (?:can|do) (?:i|we) (?:buy|order)\b|\b(?:what(?:'s| is) (?:the |your )?(?:price|moq)|price (?:please|for)|do you (?:ship to|have .{1,35} in stock))\b|^\s*(?:price|precio|preço)\s*[?？]+|\b(?:cuánto cuesta|quanto custa)\b/iu;

const interest = /感兴趣|想(?:了解|订购|购买|买)|有意(?:向|购买)|\binterested\b|\b(?:i|we) (?:want|would like) to (?:buy|order|know more)\b|\b(?:please )?send (?:me|us) (?:the |more )?(?:details|catalog(?:ue)?)\b/iu;
const negativeInterest = /(?:不太|不|没|没有)(?:感兴趣|兴趣|想(?:了解|订购|购买|买))|\b(?:not|never)(?: (?:really|very|that))? interested\b|\b(?:uninterested|disinterested)\b/giu;

const shortEnquiry = /^\s*tell (?:me )?(?:the )?(?:cost|price)\b|\bme interesa (?:ese|este) (?:negocio|producto)\b|ده فين والسعر/iu;
export const hasBuyingIntent = (text: string) => inquiry.test(text) || shortEnquiry.test(text) || interest.test(text.replace(negativeInterest, ''));

export function summarize(comments: Comment[]) {
  const unique = new Map(comments.map((c) => [c.id, c]));
  const customers = new Set<string>();
  for (const comment of unique.values()) {
    if (comment.buyingIntent ?? hasBuyingIntent(comment.text)) customers.add(comment.author || 'comment:' + comment.id);
  }
  return { comments: unique.size, leadCount: customers.size };
}

function connectionError(err: unknown) {
  const cause = err instanceof Error ? err.cause : undefined;
  const rawCode = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  const code = /^[A-Z][A-Z_0-9]{1,60}$/.test(rawCode) ? rawCode : '';
  let reason = '网络连接中断';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') reason = '域名解析失败';
  else if (code === 'ECONNREFUSED') reason = '连接被拒绝，请检查后端网络或代理';
  else if (code.includes('TIMEOUT') || code === 'ETIMEDOUT' || (err instanceof Error && err.name === 'TimeoutError')) reason = '连接超时';
  else if (/CERT|TLS|SSL|ISSUER/.test(code)) reason = 'TLS 证书校验失败';
  return new AppError(502, 'brightdata_network', '连接 Bright Data 失败：' + reason + (code ? '（' + code + '）' : ''));
}

async function call(key: string, path: string, payload?: unknown) {
  return request(key, 'datasets/v3/' + path, payload);
}

async function request(key: string, path: string, payload?: unknown) {
  if (!key) throw new AppError(503, 'no_key', '请在后端配置 Bright Data API 密钥');
  let res: Response;
  try {
    res = await fetch('https://api.brightdata.com/' + path, {
      method: payload ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch (err) {
    throw connectionError(err);
  }
  if (!res.ok) {
    if (res.status === 404 && !payload)
      throw new AppError(404, 'expired_snapshot', '采集任务已失效');
    const inactive = (await res.text()).includes('Customer is not active');
    throw new AppError(
      502,
      'provider_error',
      inactive ? 'Bright Data 暂不允许此客户账户发起采集（Customer is not active）' : 'Bright Data 请求失败（HTTP ' + res.status + '）',
    );
  }
  return res.json();
}

export async function checkAccount(key: string) {
  const result = await request(key, 'status');
  if (typeof result?.can_make_requests !== 'boolean') {
    throw new AppError(502, 'unknown_status', 'Bright Data 返回的账户状态无法识别');
  }
  return { canMakeRequests: result.can_make_requests as boolean, checkedAt: new Date().toISOString() };
}

async function collect(dataset: string, input: Record<string, unknown>, snapshot: string | null, key: string) {
  if (!snapshot) {
    const task = await call(key, 'trigger?dataset_id=' + dataset + '&format=json&include_errors=true', [
      input,
    ]);
    if (!/^sd?_[\w-]+$/.test(task?.snapshot_id ?? ''))
      throw new AppError(502, 'invalid_snapshot', '没有收到有效的任务编号');
    return { snapshot: String(task.snapshot_id) };
  }
  try {
    const progress = await call(key, 'progress/' + encodeURIComponent(snapshot));
    if (progress.status === 'failed') return { failed: true };
    if (progress.status !== 'ready') return { snapshot };
    const rows = await call(key, 'snapshot/' + encodeURIComponent(snapshot) + '?format=json');
    if (!Array.isArray(rows) || rows.some((row) => !row || row.error || row.warning))
      return { failed: true };
    return { rows };
  } catch (err) {
    if (err instanceof AppError && err.code === 'expired_snapshot') return { failed: true };
    throw err;
  }
}

export async function collectTitle(url: string, snapshot: string | null, key: string) {
  const page = await collect('gd_lyclm1571iy3mv57zw', { url }, snapshot, key);
  if (!page.rows) return { snapshot: page.snapshot, failed: page.failed };
  const post = page.rows[0];
  if (!post) return { failed: true };
  const title = [post?.title, post?.content, post?.description].find(
    (v) => typeof v === 'string' && v.trim(),
  );
  return { title: title?.trim().replace(/\s+/g, ' ').slice(0, 80) || '无文字标题的帖子' };
}

export async function collectComments(url: string, snapshot: string | null, key: string) {
  const page = await collect('gd_lkay758p1eanlolqw8', { url, get_all_replies: true }, snapshot, key);
  if (!page.rows) return { snapshot: page.snapshot, failed: page.failed };
  const rows = page.rows;
  const comments: Comment[] = [];
  for (const row of rows) {
    if (!row || row.error || row.warning) return { failed: true };
    const text = row.comment_text ?? row.comment ?? row.content ?? row.text;
    if (!row.comment_id || (text != null && typeof text !== 'string')) return { failed: true };
    comments.push({
      id: String(row.comment_id),
      text: text ?? '',
      authorName: row.user_name,
      date: row.date_created,
      parentId: row.parent_comment_id,
      author: row.user_id ? String(row.user_id) : row.user_url,
    });
  }
  return {
    result: summarize(comments),
    details: [...new Map(comments.map((c) => [c.id, c])).values()],
  };
}
