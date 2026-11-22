import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import type { BrightDataStatus, MonitorComment, Monitor, Inquiry, Message } from '../../../../shared/contracts.js';
import { createDemo } from '../demo/fixtures.js';
import { readDemoPost } from '../facebook/demo-reader.js';
import { config } from '../../config.js';
import { postLabel } from '../facebook/validation.js';
import { probeApify, type RunJournal } from '../facebook/apify.js';
import { summarize, hasBuyingIntent, checkAccount } from '../facebook/comments.js';

import { classifyComments } from '../model.js';
import { ModelReplies } from '../deskcomm/model-replies.js';

function facebookCommentId(value: string) {
  if (!value.startsWith('Y29tbWVudD')) return value;
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  return /^comment:\d+_(\d+)$/.exec(decoded)?.[1] || value;
}

function mergeComments(rows: MonitorComment[]) {
  const byId = new Map<string, MonitorComment>();
  for (const row of rows) {
    const id = facebookCommentId(row.id);
    const prev = byId.get(id);
    const decision = row.intentModel ? row : prev?.text === row.text && prev.intentModel ? prev : undefined;
    const merged = {...prev, ...row, id, intentModel:decision?.intentModel,
      buyingIntent:decision?.buyingIntent ?? hasBuyingIntent(row.text)};
    if (merged.parentId) merged.parentId = facebookCommentId(merged.parentId);
    byId.set(id,merged);
  }
  return [...byId.values()].sort((a,b) => (b.date || '').localeCompare(a.date || ''));
}

export class Store {
  private db: DatabaseSync;
  readonly modelReplies: ModelReplies;
  private demo = createDemo();
  private collecting = new Set<string>();
  private browserJob?: { id: string; token: string; expires: number };
  private browserSeen = 0;
  constructor(filename: string, private readonly readPost = readDemoPost, readonly useBrowser = false, readonly useApify = false) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.modelReplies = new ModelReplies(this.db, () => this.readLlmSettings());
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS monitors (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL)',
    );
    this.db.exec(
      'PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS monitor_analysis (id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,snapshot TEXT,comments INTEGER,leads INTEGER,analyzed_at TEXT)',
    );
    this.db.exec(`CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS facebook_sync (
      id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, kind TEXT NOT NULL,
      due INTEGER NOT NULL DEFAULT 0, snapshot TEXT, error TEXT, PRIMARY KEY(id,kind));
      CREATE TABLE IF NOT EXISTS gql_monitor (id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE, demo INTEGER NOT NULL DEFAULT 0, minutes INTEGER NOT NULL DEFAULT 5, due INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE TABLE IF NOT EXISTS facebook_comments (id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE, records TEXT NOT NULL);`);
    if (!this.db.prepare('PRAGMA table_info(gql_monitor)').all().some(col => col.name === 'authenticated'))
      this.db.exec('ALTER TABLE gql_monitor ADD COLUMN authenticated INTEGER NOT NULL DEFAULT 0');
    if (!this.db.prepare('PRAGMA table_info(monitor_analysis)').all().some(col => col.name === 'source'))
      this.db.exec('ALTER TABLE monitor_analysis ADD COLUMN source TEXT');
    this.db.exec("INSERT OR IGNORE INTO gql_monitor(id) SELECT id FROM monitors");
    if (useApify && !this.db.prepare("SELECT 1 FROM settings WHERE name='apify_monitor_provider'").get()) {
      this.db.exec("BEGIN; UPDATE monitors SET status='paused' WHERE id IN (SELECT id FROM gql_monitor WHERE demo=0); UPDATE gql_monitor SET error=NULL,due=0 WHERE demo=0; INSERT INTO settings VALUES('apify_monitor_provider','1'); COMMIT");
    }
    if (useBrowser && !this.db.prepare("SELECT 1 FROM settings WHERE name='local_dom_collector'").get()) {
      this.db.exec("BEGIN; UPDATE gql_monitor SET due=0,error=NULL WHERE demo=0; INSERT INTO settings VALUES('local_dom_collector','1'); COMMIT");
    }
    if (!this.db.prepare('PRAGMA table_info(monitors)').all().some(col => col.name === 'demo_scope')) {
      this.db.exec('PRAGMA foreign_keys=OFF; BEGIN');
      try {
        this.db.exec(`CREATE TABLE migrated_monitors (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL,
          status TEXT NOT NULL, created_at TEXT NOT NULL, demo_scope INTEGER NOT NULL DEFAULT 0, UNIQUE(url,demo_scope));
          INSERT INTO migrated_monitors SELECT m.id,m.title,m.url,m.status,m.created_at,g.demo FROM monitors m JOIN gql_monitor g USING(id);
          DROP TABLE monitors; ALTER TABLE migrated_monitors RENAME TO monitors;`);
        if (this.db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Monitor migration failed');
        this.db.exec('COMMIT');
      } catch (err) { this.db.exec('ROLLBACK'); throw err; }
      finally { this.db.exec('PRAGMA foreign_keys=ON'); }
    }
    if (useApify) this.normalizeLegacyComments();
  }
  private normalizeLegacyComments() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const saved = this.db.prepare("SELECT id,records FROM facebook_comments JOIN gql_monitor USING(id) WHERE demo=0 AND records LIKE '%Y29tbWVudD%'").all();
      for (const row of saved) {
        const previous: MonitorComment[] = JSON.parse(String(row.records));
        if (!previous.some(c => facebookCommentId(c.id) !== c.id)) continue;
        const ordered = previous.sort((a,b) => Number(a.id === facebookCommentId(a.id)) - Number(b.id === facebookCommentId(b.id)));
        const records = mergeComments(ordered);
        const {comments,leadCount} = summarize(records);
        this.db.prepare('UPDATE facebook_comments SET records=? WHERE id=?').run(JSON.stringify(records),row.id);
        this.db.prepare('UPDATE monitor_analysis SET comments=?,leads=? WHERE id=?').run(comments,leadCount,row.id);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private get brightDataKey(): string {
    const setting = this.db.prepare("SELECT value FROM settings WHERE name='brightdata_api_key'").get();
    return setting ? String(setting.value) : (process.env.BRIGHTDATA_API_KEY || '').trim();
  }
  get apifyToken(): string {
    const saved = this.db.prepare("SELECT value FROM settings WHERE name='apify_token'").get();
    return String(saved?.value || process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || '').trim();
  }
  saveApifyToken(token: string) {
    this.db.prepare("INSERT INTO settings(name,value) VALUES('apify_token',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(token);
  }
  private readLlmSettings(): { baseUrl: string; model: string; apiKey: string } {
    const row = this.db.prepare("SELECT value FROM settings WHERE name='llm_config'").get();
    return row ? JSON.parse(String(row.value)) : { baseUrl: '', model: '', apiKey: '' };
  }
  get llmSettings() {
    const {baseUrl, model, apiKey} = this.readLlmSettings();
    return {baseUrl, model, hasApiKey: Boolean(apiKey)};
  }
  saveLlmSettings(baseUrl: string, model: string, apiKey?: string) {
    const previous = this.readLlmSettings();
    if (!apiKey && (!previous.apiKey || new URL(previous.baseUrl).origin !== new URL(baseUrl).origin))
      throw new AppError(422, 'llm_key_required', '首次配置或更换服务地址域名时，请填写 API Key。');
    const value = JSON.stringify({baseUrl, model, apiKey: apiKey || previous.apiKey});
    this.db.prepare("INSERT OR REPLACE INTO settings(name,value) VALUES('llm_config',?)").run(value);
    return {baseUrl, model, hasApiKey: true};
  }
  probe(url:string, monitor = false) {
    const token = this.apifyToken;
    const prefix = 'apify_run_' + createHash('sha256').update(token).digest('hex') + '_';
    const journal:RunJournal = {
      get:key => this.db.prepare('SELECT value FROM settings WHERE name=?').get(prefix+key)?.value as string | undefined,
      set:(key,id) => { this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(prefix+key,id); },
      clear:key => { this.db.prepare('DELETE FROM settings WHERE name=?').run(prefix+key); },
    };
    return probeApify(token,url,journal,monitor);
  }
  get brightDataConfigured() {
    return Boolean(this.brightDataKey);
  }
  get brightDataStatus(): BrightDataStatus | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE name='brightdata_status'").get();
    if (!row) return;
    const saved = JSON.parse(String(row.value));
    const hash = createHash('sha256').update(this.brightDataKey).digest('hex');
    if (saved.hash === hash) return { canMakeRequests: saved.canMakeRequests, checkedAt: saved.checkedAt };
  }
  async checkBrightDataStatus() {
    const key = this.brightDataKey;
    const result = await checkAccount(key);
    if (this.brightDataKey !== key) throw new AppError(409, 'key_changed', '密钥已更换，请重新检查');
    const hash = createHash('sha256').update(key).digest('hex');
    this.db.prepare("INSERT INTO settings(name,value) VALUES('brightdata_status',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify({ ...result, hash }));
    return result;
  }
  saveBrightDataKey(key: string) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare("INSERT INTO settings(name,value) VALUES('brightdata_api_key',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(key);
      this.db.exec('UPDATE facebook_sync SET due=0,error=NULL WHERE error IS NOT NULL');
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  demoCommentDetails(id: string) {
    const sample = this.demo.monitors.find(m => m.id === id);
    if (!sample) return this.commentDetails(id, true);
    return (this.demo.comments[id] || []).map(row => ({ ...row, buyingIntent: hasBuyingIntent(row.text) }));
  }
  commentDetails(id: string, demo = false): MonitorComment[] {
    const row = this.db.prepare('SELECT records FROM facebook_comments JOIN gql_monitor USING(id) WHERE id=? AND demo=?').get(id, Number(demo));
    const records: MonitorComment[] = row ? JSON.parse(String(row.records)) : [];
    return records.map(c => ({ ...c, buyingIntent: c.buyingIntent ?? hasBuyingIntent(c.text) }));
  }
  async tick() {
    const jobs = this.db.prepare("SELECT id,demo FROM gql_monitor JOIN monitors USING(id) WHERE status!='paused' AND due<=? AND (demo=1 OR ?=0) ORDER BY due, created_at LIMIT 3").all(Date.now(),Number(this.useBrowser));
    await Promise.allSettled(jobs.map(job => this.analyzeMonitor(String(job.id), Boolean(job.demo))));
  }
  async analyzeMonitor(id: string, demo = false) {
    const lookup = this.db.prepare('SELECT url,title,status,minutes,authenticated FROM monitors JOIN gql_monitor USING(id) WHERE id=? AND demo=?');
    const item = lookup.get(id, Number(demo));
    if (!item) throw new AppError(404, 'not_found', '未找到监控帖子');
    if (item.status === 'paused' || this.collecting.has(id)) throw new AppError(409, 'busy', '帖子已暂停或正在读取');
    if (this.useBrowser && !demo) {
      this.db.prepare('UPDATE gql_monitor SET due=0 WHERE id=?').run(id);
      return;
    }
    this.collecting.add(id);
    try {
      if (this.useApify && !demo) {
        const result=await this.probe(String(item.url),true);
        const current=lookup.get(id,0);
        if (!current || current.status==='paused') return;
        if (result.title) this.db.prepare('UPDATE monitors SET title=? WHERE id=?').run(result.title,id);
        if (result.commentError) throw new AppError(502,'apify_comments',result.commentError);
        await this.saveCollected(id,false,result.title || String(item.title),result.comments,result.titleError);
        return;
      }
      const authenticated = Boolean(item.authenticated);
      if (authenticated && (demo || config.container))
        throw new AppError(409, 'local_only', '认证读取仅用于本机真实帖子');
      const result = await this.readPost(String(item.url), title => {
        this.db.prepare("UPDATE monitors SET title=? WHERE id=? AND status!='paused'").run(title,id);
      }, authenticated);
      const current = lookup.get(id, Number(demo));
      if (!current || current.status === 'paused') return;
      await this.saveCollected(id, demo, result.title, result.comments, result.notice);
    } catch (err) {
      this.db.prepare("UPDATE gql_monitor SET due=? + minutes*60000,error=? WHERE id=? AND EXISTS (SELECT 1 FROM monitors WHERE id=? AND status!='paused')")
        .run(Date.now(),err instanceof Error ? err.message : '公开评论读取失败',id,id);
      throw err;
    } finally { this.collecting.delete(id); }
  }
  private async saveCollected(id: string, demo: boolean, title: string, rows: MonitorComment[], notice?: string) {
    const cfg = this.readLlmSettings();
    const records = mergeComments([...this.commentDetails(id, demo), ...rows]);
    if (!demo && cfg.apiKey) {
      const signature = createHash('sha256').update(JSON.stringify([cfg.baseUrl, cfg.model])).digest('hex');
      const pending = records.filter(row => row.text.trim() && row.intentModel !== signature);
      for (let i = 0; i < pending.length; i += 16) {
        const batch = pending.slice(i, i + 16);
        try {
          const flags = await classifyComments(cfg, batch, title);
          batch.forEach((row, index) => { row.intentModel = signature; row.buyingIntent = flags[index]; });
        } catch {
          notice = [notice, '部分评论尚待模型判断，已保留原有标记或关键词初筛结果'].filter(Boolean).join(' · ');
          break;
        }
      }
    }
    if (this.db.prepare("SELECT id FROM monitors WHERE id=? AND status!='paused'").get(id))
      this.saveComments(id, demo, title, records, 'collector', notice);
  }
  saveBrowserComments(url: string, title: string, comments: MonitorComment[]) {
    const monitor = this.db.prepare('SELECT id FROM monitors WHERE demo_scope=0 AND url=?').get(url);
    if (!monitor || !comments.length) throw new Error('需要已添加的真实帖子和可核对的评论');
    this.saveComments(String(monitor.id), false, title, comments, 'browser');
  }
  claimBrowserJob() {
    if (!this.useBrowser) throw new AppError(404,'unavailable','浏览器采集未启用');
    this.browserSeen = Date.now();
    if (this.browserJob && this.browserJob.expires > Date.now()) return null;
    this.browserJob = undefined;
    const row = this.db.prepare("SELECT id,url FROM monitors JOIN gql_monitor USING(id) WHERE demo=0 AND status!='paused' AND due<=? ORDER BY due,created_at DESC LIMIT 1").get(Date.now());
    if (!row) return null;
    this.browserJob = {id:String(row.id),token:randomUUID(),expires:Date.now()+240000};
    return {id:String(row.id),url:String(row.url),token:this.browserJob.token};
  }
  finishBrowserJob(id: string, token: string, result: {title:string;comments:MonitorComment[];notice?:string} | {error:string}) {
    const job = this.browserJob;
    if (!job || job.token !== token || job.id !== id || job.expires <= Date.now())
      throw new AppError(409,'stale','本次读取已失效');
    this.browserJob = undefined;
    this.browserSeen = Date.now();
    if (!this.db.prepare("SELECT id FROM monitors WHERE id=? AND status!='paused'").get(id)) return;
    if ('error' in result) {
      this.db.prepare('UPDATE gql_monitor SET due=?+minutes*60000,error=? WHERE id=?').run(Date.now(),result.error,id);
    } else this.saveComments(id,false,result.title,result.comments,'browser-auto',result.notice);
  }
  private saveComments(id: string, demo: boolean, title: string, rows: MonitorComment[], source: 'collector' | 'browser' | 'browser-auto', notice?:string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const records = mergeComments([...this.commentDetails(id, demo), ...rows]);
      const summary = summarize(records);
      this.db.prepare('INSERT INTO facebook_comments(id,records) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET records=excluded.records').run(id,JSON.stringify(records));
      this.db.prepare('INSERT INTO monitor_analysis(id,comments,leads,analyzed_at,source) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=NULL,comments=excluded.comments,leads=excluded.leads,analyzed_at=excluded.analyzed_at,source=excluded.source')
        .run(id,summary.comments,summary.leadCount,new Date().toISOString(),source);
      this.db.prepare('UPDATE monitors SET title=? WHERE id=?').run(title,id);
      if (source !== 'browser') {
        this.db.prepare("UPDATE monitors SET status='monitoring' WHERE id=?").run(id);
        this.db.prepare('UPDATE gql_monitor SET due=? + minutes*60000,error=? WHERE id=?').run(Date.now(),notice || null,id);
      }
      this.db.exec('COMMIT');
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  close() {
    this.db.close();
  }
  inquiries(): Inquiry[] {
    return this.demo.inquiries;
  }
  messages(id: string): Message[] {
    this.inquiry(id);
    return this.demo.messages[id] || [];
  }
  inquiry(id: string) {
    const row = this.demo.inquiries.find((x) => x.id === id);
    if (!row) throw new AppError(404, 'not_found', '未找到询盘');
    return row;
  }
  setOwner(id: string, ai: boolean) {
    const row = this.inquiry(id);
    row.owner = ai ? 'ai' : 'human';
    return row;
  }
  markRead(ids: string[]) {
    for (const id of ids) this.inquiry(id).unread = 0;
  }
  addMessage(id: string, text: string) {
    const row = this.inquiry(id);
    const message: Message = {
      id: randomUUID(),
      direction: 'outbound',
      text,
      time: new Date().toISOString(),
      status: 'demo',
    };
    this.demo.messages[id].push(message);
    row.summary = text;
    row.time = message.time;
    return message;
  }
  monitors(demo: boolean): Monitor[] {
    const rows = this.db.prepare('SELECT m.*,g.minutes,g.due,g.error,g.authenticated,a.comments,a.leads,a.analyzed_at,a.source FROM monitors m JOIN gql_monitor g USING(id) LEFT JOIN monitor_analysis a USING(id) WHERE g.demo=? ORDER BY created_at DESC').all(Number(demo));
    const saved: Monitor[] = rows.map(row => ({
      id: String(row.id), url: String(row.url), status: row.status as Monitor['status'],
      provider: this.useApify && !demo ? 'apify' : undefined,
      authenticated: demo || config.container || this.useBrowser || this.useApify ? undefined : Boolean(row.authenticated),
      browserOnline: !demo && this.useBrowser ? this.browserSeen > 0 && Date.now()-this.browserSeen < 150000 : undefined,
      title: row.analyzed_at == null && ['正在获取帖子标题','待读取的公开帖子'].includes(String(row.title))
        ? postLabel(String(row.url)) : String(row.title),
      comments: Number(row.comments || 0), leadCount: row.leads == null ? null : Number(row.leads),
      browserSnapshot: row.source === 'browser' || row.source === 'browser-auto',
      updatedAt: String(row.analyzed_at || row.created_at), collecting: this.collecting.has(String(row.id)) || (this.browserJob?.id === row.id && this.browserJob.expires > Date.now()),
      intervalMinutes: Number(row.minutes), nextCheck: Number(row.due) ? new Date(Number(row.due)).toISOString() : undefined,
      demoSource: demo ? 'public' : undefined, syncError: row.error ? String(row.error) : undefined,
    }));
    return demo ? [...saved, ...this.demo.monitors] : saved;
  }
  addMonitor(title: string, url: string, demo: boolean, minutes = 60) {
    if (this.db.prepare('SELECT id FROM monitors WHERE url=? AND demo_scope=?').get(url,Number(demo)) || (demo && this.demo.monitors.some(m => m.url === url)))
      throw new AppError(409, 'duplicate', '该帖子已添加，请在原监控项调整间隔或恢复监控');
    const id = randomUUID();
    this.db.exec('BEGIN');
    try {
      this.db.prepare("INSERT INTO monitors(id,title,url,status,created_at,demo_scope) VALUES (?,?,?,'pending',?,?)").run(id,title,url,new Date().toISOString(),Number(demo));
      this.db.prepare('INSERT INTO gql_monitor(id,demo,minutes) VALUES(?,?,?)').run(id,Number(demo),minutes);
      this.db.exec('COMMIT');
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
    return this.monitors(demo).find(m => m.id === id)!;
  }
  updateMonitor(id: string, paused: boolean | undefined, demo: boolean, minutes?: number, authenticated?: boolean) {
    const row = this.monitors(demo).find(m => m.id === id);
    if (!row) throw new AppError(404, 'not_found', '未找到链接');
    if (paused === true && this.browserJob?.id === id) this.browserJob = undefined;
    if (authenticated !== undefined && (demo || config.container || this.collecting.has(id)))
      throw new AppError(409, 'mode_unavailable', '请在本机真实帖子空闲时切换读取方式');
    if (row.demoSource === 'sample') {
      if (paused !== undefined) row.status = paused ? 'paused' : 'monitoring';
      return row;
    }
    this.db.exec('BEGIN');
    try {
      if (paused !== undefined) this.db.prepare('UPDATE monitors SET status=? WHERE id=?').run(paused ? 'paused' : 'pending',id);
      if (minutes !== undefined) this.db.prepare('UPDATE gql_monitor SET minutes=?,due=CASE WHEN due=0 THEN 0 ELSE ? END WHERE id=?').run(minutes,Date.now()+minutes*60000,id);
      if (paused === false) this.db.prepare('UPDATE gql_monitor SET due=0 WHERE id=?').run(id);
      if (authenticated !== undefined) this.db.prepare('UPDATE gql_monitor SET authenticated=?,due=0,error=NULL WHERE id=?').run(Number(authenticated),id);
      this.db.exec('COMMIT');
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
    return this.monitors(demo).find(m => m.id === id)!;
  }
  removeMonitor(id: string, demo: boolean) {
    const row = this.monitors(demo).find(m => m.id === id);
    if (!row) throw new AppError(404, 'not_found', '未找到链接');
    if (row.demoSource === 'sample') {
      this.demo.monitors = this.demo.monitors.filter(m => m.id !== id);
      delete this.demo.comments[id];
    } else this.db.prepare('DELETE FROM monitors WHERE id=?').run(id);
  }
}
