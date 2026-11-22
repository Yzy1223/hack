import { z } from 'zod';
import type { ChannelSession, Inquiry, Message, Priority } from '../../../../shared/contracts.js';
import { AppError } from '../../lib/errors.js';
import { DeskcommClient } from './client.js';
import {
  channelListSchema,
  conversationListSchema,
  messageListSchema,
  type ConversationRow,
} from './schemas.js';

function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(502, 'crm_schema_mismatch', 'DeskcommCRM 数据格式与当前适配器不兼容');
  return result.data;
}
export function normalizeInquiry(row: ConversationRow): Inquiry {
  const contact = row.contacts || {},
    meta = row.metadata || {},
    tags = row.tags || [];
  const model = typeof meta.model_label === 'string' ? meta.model_label : undefined;
  const priority: Priority =
    tags.includes('urgent') || meta.model_confirmed === true
      ? 'urgent'
      : row.last_handoff_reason
        ? 'followup'
        : 'low';
  return {
    id: row.id,
    name: contact.display_name || contact.name || contact.phone_number || '未命名客户',
    phone: contact.phone_number || '',
    channel:
      row.channel === 'facebook' || row.channel_sessions?.social_platform === 'messenger'
        ? 'facebook'
        : 'whatsapp',
    summary: row.last_message_preview || '暂无消息',
    priority,
    model,
    time: row.last_message_at || row.created_at,
    createdAt: row.created_at,
    unread: row.unread_count_for_assignee || 0,
    tags,
    owner:
      row.comando_da_conversa === 'humano'
        ? 'human'
        : row.comando_da_conversa === 'automatico' && row.automatico_da_conversa !== false
          ? 'ai'
          : !row.comando_da_conversa && row.assignee_kind === 'user'
            ? 'human'
            : 'waiting',
  };
}
export class DeskcommService {
  constructor(readonly client: DeskcommClient) {}
  async channels(): Promise<ChannelSession[]> {
    const result = decode(channelListSchema, await this.client.request('/api/v1/channel-sessions'));
    return result.data
      .filter((row) => row.waha_session_name || row.provider === 'waha')
      .map((row) => ({
        id: row.id,
        name: row.display_name || 'WhatsApp',
        phone: row.phone_number || '',
        status: row.status,
        provider: row.provider,
      }));
  }
  async inquiries() {
    const result = decode(
      conversationListSchema,
      await this.client.request('/api/v1/conversations?limit=100&exclude_finished=true'),
    );
    return { items: result.data.map(normalizeInquiry), hasMore: Boolean(result.meta?.has_more) };
  }
  async messages(id: string): Promise<Message[]> {
    const result = decode(
      messageListSchema,
      await this.client.request(
        '/api/v1/conversations/' + encodeURIComponent(id) + '/messages?limit=100',
      ),
    );
    return result.data
      .map((row) => ({
        id: row.id,
        direction: row.direction,
        revoked: Boolean(row.revoked_at),
        text: row.revoked_at ? '消息已撤回' : row.body || '',
        time: row.sent_at || row.created_at,
        status: row.status || undefined,
        mediaType: row.type || undefined,
      }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }
  photo(id: string) { return this.client.photo(id); }
  createChannel(key: string) {
    return this.client.request('/api/v1/channel-sessions', {
      method: 'POST',
      admin: true,
      key,
      body: { display_name: '询盘工作台' },
    });
  }
  reconnect(id: string) {
    return this.client.request(
      '/api/v1/channel-sessions/' + encodeURIComponent(id) + '/reconnect',
      { method: 'POST', admin: true, body: { force: false } },
    );
  }
  qr(id: string) {
    return this.client.request('/api/v1/channel-sessions/' + encodeURIComponent(id) + '/qr', {
      admin: true,
      image: true,
    }) as Promise<{ mime: string; bytes: Buffer }>;
  }
  setAi(id: string, enabled: boolean) {
    return this.client.request(
      '/api/v1/conversations/' +
        encodeURIComponent(id) +
        (enabled ? '/reactivate-bot' : '/pause-ai'),
      { method: 'POST', admin: true, body: {} },
    );
  }
  read(id: string) {
    return this.client.request('/api/v1/conversations/' + encodeURIComponent(id) + '/mark-read', {
      method: 'POST',
      admin: true,
      body: {},
    });
  }
  send(id: string, text: string, key: string) {
    return this.client.request('/api/v1/messages', {
      method: 'POST',
      key,
      body: { conversation_id: id, type: 'text', body: text },
    });
  }
}
