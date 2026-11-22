import { z } from 'zod';
const text = z.string().nullable().optional();
export const conversationSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  channel: text,
  status: text,
  last_message_at: text,
  last_message_preview: text,
  last_handoff_reason: text,
  unread_count_for_assignee: z.number().nullish(),
  tags: z.array(z.string()).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  contacts: z.object({ display_name: text, name: text, phone_number: text }).nullish(),
  channel_sessions: z.object({ social_platform: text }).nullish(),
  comando_da_conversa: text,
  assignee_kind: text,
  automatico_da_conversa: z.boolean().nullish(),
});
export type ConversationRow = z.infer<typeof conversationSchema>;
export const conversationListSchema = z.object({
  data: z.array(conversationSchema),
  meta: z.object({ has_more: z.boolean().optional(), cursor: text }).optional(),
});
export const channelListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      display_name: text,
      phone_number: text,
      waha_session_name: text,
      status: z.string(),
      provider: z.string(),
    }),
  ),
});
export const messageListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      direction: z.enum(['inbound', 'outbound']),
      body: text,
      created_at: z.string(),
      sent_at: text,
      status: text,
      type: text,
      revoked_at: text,
    }),
  ),
});
