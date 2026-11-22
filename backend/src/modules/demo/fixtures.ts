import type { Inquiry, Message, Monitor, MonitorComment } from '../../../../shared/contracts.js';
import { summarize } from '../facebook/comments.js';
const today = (hours: number, minutes: number) => {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};
export function createDemo() {
  const rows: [
    string,
    string,
    string,
    'whatsapp' | 'facebook',
    'urgent' | 'followup' | 'low',
    number,
    number,
    string?,
  ][] = [
    ['carlos', 'Carlos Mendes', '19369 型号已确认，等待报价', 'whatsapp', 'urgent', 8, 52, '19369'],
    ['ahmed', 'Ahmed Hassan', '客户连续追问交期', 'facebook', 'urgent', 8, 38],
    ['sophie', 'Sophie Wilson', '待补充背面照片', 'whatsapp', 'followup', 8, 10],
    ['diego', 'Diego Silva', 'OE 编号待核对', 'whatsapp', 'followup', 7, 46],
    ['lucas', 'Lucas Costa', '产品目录已发送', 'facebook', 'low', 7, 21],
    ['emma', 'Emma Brown', '客户已确认收到报价', 'whatsapp', 'low', 6, 53],
  ];
  const inquiries: Inquiry[] = rows.map(([id, name, summary, channel, priority, h, m, model]) => ({
    id,
    name,
    summary,
    channel,
    priority,
    time: today(h, m),
    createdAt: today(h, m),
    model,
    phone: '',
    unread: 1,
    owner: priority === 'urgent' ? 'waiting' : 'ai',
    tags: model ? ['型号已确认'] : ['待核对'],
  }));
  const messages: Record<string, Message[]> = Object.fromEntries(
    inquiries.map((q) => [
      q.id,
      [
        {
          id: q.id + '-1',
          direction: 'inbound',
          text: q.model
            ? 'Hi, do you have this brake pad? We need 200 sets.'
            : 'Hi, I would like to check a brake pad for our truck.',
          time: today(6, 30),
        },
        {
          id: q.id + '-2',
          direction: 'outbound',
          text: 'Could you share the front and back photos, dimensions, and any OE number on the part?',
          time: today(6, 31),
        },
        {
          id: q.id + '-3',
          direction: 'inbound',
          text: q.model
            ? 'Yes, model 19369. Please confirm your price and delivery time.'
            : 'I will send the details. Could you help me confirm the model?',
          time: q.time,
        },
      ],
    ]),
  );
  const comments: Record<string, MonitorComment[]> = {
    'post-0': [
      { id: 'a1', authorName: 'Carlos', author: 'carlos', text: 'How much for 100 sets of these brake pads?' },
      { id: 'a2', authorName: '工厂销售', author: 'sales', text: 'Could you send the OE number or a photo of the old pad?', parentId: 'a1' },
      { id: 'a3', authorName: 'Carlos', author: 'carlos', text: 'I can send the photo on WhatsApp.', parentId: 'a2' },
      { id: 'a4', authorName: 'Ana', author: 'ana', text: 'What is your MOQ?' },
    ],
    'post-1': [{ id: 'b1', authorName: 'Ali', text: 'How can I order?' }, { id: 'b2', authorName: 'Lina', text: 'Great factory!' }],
    'post-2': [{ id: 'c1', authorName: 'Maya', text: 'Nice work!' }],
  };
  const monitors: Monitor[] = ['刹车片产品展示', '工厂生产线实拍', '本周发货记录'].map((title, i) => ({
    id: 'post-' + i, title, url: 'https://www.facebook.com/example/posts/' + (1027 - i * 4),
    status: 'monitoring', demoSource: 'sample', ...summarize(comments['post-' + i]), updatedAt: today(9, 40 - i * 2),
  }));
  return { inquiries, messages, monitors, comments };
}
