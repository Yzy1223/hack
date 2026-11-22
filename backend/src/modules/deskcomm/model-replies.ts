import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Inquiry } from '../../../../shared/contracts.js';
import type { DeskcommService } from './service.js';
import { generateReply, type ModelConfig } from '../model.js';
import { AppError } from '../../lib/errors.js';

type Crm = Pick<DeskcommService, 'inquiries' | 'messages' | 'setAi' | 'send'>;
interface Session { id: string; started: number; epoch: string; handled: string; error: string | null }

export class ModelReplies {
  private changing = new Set<string>();
  private busy = false;
  constructor(private db: DatabaseSync, private config: () => ModelConfig) {
    db.exec('CREATE TABLE IF NOT EXISTS model_chats(id TEXT PRIMARY KEY, started INTEGER NOT NULL, epoch TEXT NOT NULL, handled TEXT NOT NULL, error TEXT)');
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
  async tick(crm: Crm) {
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
          const messages = await crm.messages(session.id);
          const last = messages.at(-1);
          if (!last || last.revoked || last.direction !== 'inbound' || !last.text.trim() || last.id === session.handled
              || !(Date.parse(last.time) >= Math.floor(session.started / 1000) * 1000)) continue;
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
