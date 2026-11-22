import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CatalogItem, Inquiry, Message, PhotoMatch } from '../../../../shared/contracts.js';
import type { DeskcommService } from './service.js';
import { generateReply, matchPhoto, type ModelConfig } from '../model.js';
import { AppError } from '../../lib/errors.js';

type Crm = Pick<DeskcommService, 'inquiries' | 'messages' | 'setAi' | 'send'> & Partial<Pick<DeskcommService,'photo'>>;
interface Session { id: string; started: number; epoch: string; handled: string; error: string | null }

export class ModelReplies {
  private changing = new Set<string>();
  private busy = false;
  constructor(private db: DatabaseSync, private config: () => ModelConfig) {
    db.exec('CREATE TABLE IF NOT EXISTS inquiry_photos(chat TEXT, message TEXT, result TEXT NOT NULL, PRIMARY KEY(chat,message))');
    db.exec('CREATE TABLE IF NOT EXISTS model_chats(id TEXT PRIMARY KEY, started INTEGER NOT NULL, epoch TEXT NOT NULL, handled TEXT NOT NULL, error TEXT)');
  }
  withPhotos(id: string, messages: Message[]): Message[] {
    const rows = this.db.prepare('SELECT message,result FROM inquiry_photos WHERE chat=?').all(id);
    const matches = new Map(rows.map(row => [String(row.message), JSON.parse(String(row.result)) as PhotoMatch]));
    return messages.map(m => ({...m, photoMatch:m.revoked ? undefined : matches.get(m.id)}));
  }
  private sessions() {
    return this.db.prepare('SELECT * FROM model_chats').all() as unknown as Session[];
  }
  annotate(items: Inquiry[]): Inquiry[] {
    const sessions = new Map(this.sessions().map(s => [s.id, s]));
    return items.map(item => {
      const session = sessions.get(item.id);
      return session && item.channel === 'whatsapp' && item.owner === 'human'
        ? {...item, owner: 'ai', localAi: true, aiError: session.error || undefined} : item;
    });
  }
  async toggle(crm: Crm, id: string, enabled: boolean) {
    if (this.changing.has(id)) throw new AppError(409, 'busy', '正在切换会话接待方式');
    this.changing.add(id);
    try {
      if (!enabled) {
        this.db.prepare('DELETE FROM model_chats WHERE id=?').run(id);
        return await crm.setAi(id, false);
      }
      if (!this.config().apiKey) return await crm.setAi(id, true);
      const conversation = (await crm.inquiries()).items.find(item => item.id === id);
      if (!conversation) throw new AppError(404, 'not_found', '未找到活动会话');
      if (conversation.channel !== 'whatsapp') return await crm.setAi(id, true);
      await crm.setAi(id, false);
      const baseline = (await crm.messages(id)).at(-1);
      this.db.prepare('INSERT OR REPLACE INTO model_chats VALUES(?,?,?,?,NULL)')
        .run(id, Date.now(), randomUUID(), baseline?.id || '');
      return {ok: true};
    } finally { this.changing.delete(id); }
  }
  async tick(crm: Crm, shapes: CatalogItem[] = []) {
    if (this.busy) return;
    const sessions = this.sessions();
    if (!sessions.length) return;
    this.busy = true;
    try {
      const items = (await crm.inquiries()).items;
      for (const session of sessions) {
        const item = items.find(row => row.id === session.id);
        if (!item || this.changing.has(session.id)) continue;
        if (item.channel !== 'whatsapp' || item.owner !== 'human') {
          this.db.prepare('DELETE FROM model_chats WHERE epoch=?').run(session.epoch);
          continue;
        }
        try {
          const messages = this.withPhotos(session.id, await crm.messages(session.id));
          const last = messages.at(-1);
          if (!last || last.revoked || last.direction !== 'inbound' || (!last.text.trim() && last.mediaType !== 'image') || last.id === session.handled
              || !(Date.parse(last.time) >= Math.floor(session.started / 1000) * 1000)) continue;
          const baseline = messages.findLastIndex(m => m.id === session.handled || m.direction === 'outbound');
          for (const message of messages.slice(baseline + 1)) {
            if (message.revoked || message.mediaType !== 'image' || message.photoMatch ||
                Date.parse(message.time) < Math.floor(session.started / 1000) * 1000) continue;
            try {
              if (!crm.photo) throw new Error('此连接无法读取原图');
              message.photoMatch = await matchPhoto(this.config(), await crm.photo(message.id), shapes);
              this.db.prepare('INSERT OR REPLACE INTO inquiry_photos VALUES(?,?,?)')
                .run(session.id, message.id, JSON.stringify(message.photoMatch));
            } catch {
              message.photoMatch = {observation:'原图未能读取或分析，请补充旧件编号或清晰照片，销售可人工复核。', candidates:[]};
              this.db.prepare('INSERT OR REPLACE INTO inquiry_photos VALUES(?,?,?)')
                .run(session.id, message.id, JSON.stringify(message.photoMatch));
            }
          }
          const reply = await generateReply(this.config(), messages.filter(message => !message.revoked));
          const fresh = (await crm.messages(session.id)).at(-1);
          if (fresh?.id !== last.id || fresh.revoked || fresh.text !== last.text || this.changing.has(session.id)) continue;
          const owner = (await crm.inquiries()).items.find(row => row.id === session.id);
          if (owner?.owner !== 'human' || owner.channel !== 'whatsapp') continue;
          // Claim before dispatch: an ambiguous upstream timeout must never trigger a second send.
          const claim = this.db.prepare('UPDATE model_chats SET handled=?,error=NULL WHERE epoch=? AND handled=?')
            .run(last.id, session.epoch, session.handled);
          if (!claim.changes) continue;
          try { await crm.send(session.id, reply, randomUUID()); }
          catch { this.note(session, '发送结果待核对，请人工查看聊天记录'); }
        } catch { this.note(session, '读取消息或生成回复失败，稍后重试'); }
      }
    } finally { this.busy = false; }
  }
  private note(session: Session, message: string) {
    this.db.prepare('UPDATE model_chats SET error=? WHERE epoch=?').run(message, session.epoch);
  }
}
