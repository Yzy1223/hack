export type Channel = 'whatsapp' | 'facebook';
export type Priority = 'urgent' | 'followup' | 'low';
export type View = 'dashboard' | 'inquiries' | 'facebook';
export interface Inquiry {
  id: string;
  name: string;
  phone: string;
  channel: Channel;
  summary: string;
  priority: Priority;
  time: string;
  createdAt: string;
  unread: number;
  localAi?: boolean;
  aiError?: string;
  owner: 'ai' | 'human' | 'waiting';
  model?: string;
  tags: string[];
}
export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  time: string;
  status?: string;
  mediaType?: string;
  revoked?: boolean;
}
export interface MonitorComment {
  intentModel?: string;
  buyingIntent?: boolean;
  id: string;
  text: string;
  author?: string;
  authorName?: string;
  date?: string;
  parentId?: string;
}
export interface Monitor {
  provider?: 'apify';
  browserOnline?: boolean;
  browserSnapshot?: boolean;
  authenticated?: boolean;
  intervalMinutes?: number;
  nextCheck?: string;
  demoSource?: "sample" | "public";
  id: string;
  title: string;
  url: string;
  status: 'monitoring' | 'paused' | 'pending';
  comments: number;
  leadCount: number | null;
  collecting?: boolean;
  syncError?: string;
  titleError?: string;
  updatedAt: string;
}
export interface ChannelSession {
  id: string;
  name: string;
  phone: string;
  status: string;
  provider: string;
}
export interface Connection {
  configured: boolean;
  adminSessionConfigured: boolean;
  url: string | null;
  sessions: ChannelSession[];
  error?: string;
}
export interface CatalogItem {
  model: string;
  summary: string;
  reviewed: boolean;
}
export interface BrightDataStatus {
  canMakeRequests: boolean;
  checkedAt: string;
}
export interface Workspace {
  llmSettings?: { baseUrl: string; model: string; hasApiKey: boolean };
  apifyConfigured?: boolean;
  brightDataStatus?: BrightDataStatus;
  inquiries: Inquiry[];
  monitors: Monitor[];
  connection: Connection;
  brightDataConfigured: boolean;
  demo: boolean;
  loadedAt: string;
  hasMore: boolean;
  catalogCount: number;
}
export interface ApifyProbe {
  title: string | null;
  comments: MonitorComment[];
  titleError?: string;
  commentError?: string;
}
