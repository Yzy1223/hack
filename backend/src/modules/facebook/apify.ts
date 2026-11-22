import { AppError } from '../../lib/errors.js';
import { facebookUrl } from './validation.js';
import type { ApifyProbe } from '../../../../shared/contracts.js';

type Row = Record<string, unknown>;
function mediaId(raw: unknown) {
  if (typeof raw !== 'string') return;
  try {
    const url = new URL(facebookUrl(raw));
    return url.searchParams.get('fbid') || url.searchParams.get('story_fbid') ||
      url.searchParams.get('v') || url.pathname.match(/\/(?:posts|videos|reels?|permalink)\/([^/]+)/)?.[1];
  } catch { return; }
}

const base = 'https://api.apify.com/v2/';
type Run = {id:string; status:string; defaultDatasetId:string};
export interface RunJournal {
  get(key:string): string | undefined;
  set(key:string, id:string): void;
  clear(key:string): void;
}

async function request(token:string, path:string, stage:string, init:RequestInit = {}) {
  let response:Response;
  try {
    response = await fetch(new URL(path,base), {
      ...init, redirect:'error', signal:AbortSignal.timeout(20000),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const cause = (err as {cause?:{code?:string}})?.cause?.code;
    const code = typeof cause === 'string' && /^[A-Z0-9_]+$/.test(cause) ? cause :
      err instanceof Error && err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    const proxyActive = process.env.NODE_USE_ENV_PROXY === '1' || process.execArgv.includes('--use-env-proxy');
    const hasProxy = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);
    const route = hasProxy && proxyActive ? '环境代理' : hasProxy ? '已配置代理，需确认 Node 已启用' : '未配置 HTTPS 代理';
    throw new AppError(502,'apify_transport',stage+' · '+code+'（后端'+route+'）');
  }
  if (!response.ok) {
    const reason:Record<number,string>={401:'Token 无效',403:'Token 权限不足',402:'账户额度受限',429:'请求频率或并发受限'};
    throw new AppError(502,'apify_http',stage+' · HTTP '+response.status+' · '+(reason[response.status] || 'Apify 拒绝请求'));
  }
  return response.json();
}

export async function checkApify(token:string) {
  if (!token) throw new AppError(409,'missing_token','请先保存 Apify Token');
  await request(token,'acts/apify~facebook-comments-scraper/runs?limit=1','查询 Apify 运行记录');
}

async function dataset(token: string, actor: string, input: object, limit: number | undefined, journal?:RunJournal): Promise<Row[]> {
  const key = JSON.stringify([actor,input]);
  let id = journal?.get(key);
  let run:Run;
  if (!id) {
    const params = new URLSearchParams({timeout:'90',maxTotalChargeUsd:'0.05'});
    if (limit !== undefined) params.set('maxItems',String(limit));
    const started = await request(token,'acts/apify~'+actor+'/runs?'+params,'提交采集任务',{method:'POST',body:JSON.stringify(input)});
    run = started.data;
    if (!run?.id) throw new Error('Apify 未返回任务编号');
    id=run.id;
    journal?.set(key,id);
  } else {
    run=(await request(token,'actor-runs/'+encodeURIComponent(id),'查询已有任务 '+id)).data;
  }
  const until=Date.now()+100000;
  while (['READY','RUNNING','TIMING-OUT','ABORTING'].includes(run.status) && Date.now()<until) {
    run=(await request(token,'actor-runs/'+encodeURIComponent(id)+'?waitForFinish=5','等待任务 '+id)).data;
    if (run.status==='READY' || run.status==='RUNNING') await new Promise(resolve=>setTimeout(resolve,750));
  }
  if (run.status!=='SUCCEEDED') {
    if (['FAILED','ABORTED','TIMED-OUT'].includes(run.status)) journal?.clear(key);
    throw new Error('Apify 任务 '+id+' · '+run.status);
  }
  const rows: Row[] = [];
  const pageSize = limit ?? 100;
  for (let offset = 0; ; offset += pageSize) {
    const page = await request(token, 'datasets/'+encodeURIComponent(run.defaultDatasetId)+'/items?limit='+pageSize+'&offset='+offset, '读取任务 '+id+' 的结果');
    if (!Array.isArray(page)) throw new Error('Apify 数据集格式异常');
    rows.push(...page.filter(row => row && typeof row === 'object' && !Array.isArray(row)));
    if (limit !== undefined || page.length < pageSize) break;
  }
  journal?.clear(key);
  return rows;
}

function field(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function nested(value: unknown): Row {
  return value && typeof value === 'object' ? value as Row : {};
}

function matches(link: unknown, url: string) {
  return link === url || (!!mediaId(url) && mediaId(link) === mediaId(url));
}

function photoPost(row: Row) {
  if (typeof row.commentUrl !== 'string') return;
  try {
    const link = new URL(facebookUrl(row.commentUrl));
    if (!link.pathname.includes('/posts/')) return;
    link.search = '';
    return link.href;
  } catch { return; }
}

const pending = new Set<string>();
export async function probeApify(token: string, inputUrl: string, journal?:RunJournal, monitor = false): Promise<ApifyProbe> {
  if (!token) throw new AppError(409,'missing_token','请先在配置设置中保存 Apify Token');
  const url = facebookUrl(inputUrl);
  const key = mediaId(url) || url;
  if (pending.has(key)) throw new AppError(409,'busy','此链接正在采集');
  pending.add(key);
  try {
    await checkApify(token);
    const result: ApifyProbe = {title:null, comments:[]};
    let postUrl = url;
    try {
      const input = {startUrls:[{url}], ...(monitor ? {viewOption:'RECENT_ACTIVITY'} : {resultsLimit:5}), includeNestedComments:true};
      const rows = await dataset(token,'facebook-comments-scraper',input,monitor ? undefined : 5,journal);
      const seen = new Set<string>();
      for (const row of rows) {
        if (row.error || ![row.inputUrl,row.facebookUrl,row.commentUrl].some(link => matches(link,url))) continue;
        result.title ??= field(row.postTitle) || null;
        if (postUrl === url && new URL(url).searchParams.has('fbid')) postUrl = photoPost(row) || url;
        const id = String(row.commentId || row.id || '');
        const text = field(row.text);
        if (!id || seen.has(id) || (!text && !row.attachments)) continue;
        seen.add(id);
        const author = nested(row.author);
        const authorName = field(row.profileName) || field(author.name);
        const authorId = field(row.profileId) || field(author.id);
        const date = field(row.date);
        result.comments.push({id,text:text || '', ...(authorName && {authorName}), ...(authorId && {author:authorId}), ...(date && {date}), ...(field(row.parentCommentId) && {parentId: String(row.parentCommentId)})});
      }
      if (rows.length && !result.comments.length) result.commentError = 'Apify 未返回可与此链接核对的评论';
    } catch (error) { result.commentError = error instanceof Error ? error.message : '评论读取失败'; }
    if (!result.title) {
      try {
        const rows = await dataset(token,'facebook-posts-scraper',{startUrls:[{url:postUrl}],resultsLimit:1},1,journal);
        const id = mediaId(postUrl);
        const row = rows.find(r => !r.error && ([r.url,r.postUrl,r.topLevelUrl,r.facebookUrl,r.inputUrl].some(link=>matches(link,postUrl)) ||
          (id && (String(r.postId)===id || String(r.post_id)===id || (Array.isArray(r.media) && r.media.some(m=>m && (String(m.id)===id || mediaId(m.url)===id)))))));
        result.title = field(row?.title) || field(row?.text) || field(row?.caption) || field(nested(row?.message).text) || null;
        if (!result.title) result.titleError = 'Apify 未返回原帖标题或配文';
      } catch (error) { result.titleError = error instanceof Error ? error.message : '标题读取失败'; }
    }
    return result;
  } finally { pending.delete(key); }
}
