import { CatalogDialog } from './CatalogDialog';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  Bot,
  CheckCheck,
  UserRound,
  PackageSearch,
  ChevronRight,
  Search,
} from 'lucide-react';
import type { Inquiry, Message, CatalogItem } from '../../../../shared/contracts';
import { useWorkspace } from '../../app/WorkspaceContext';
import { api, initials, time } from '../../lib/api';
import { BrandIcon } from '../../components/BrandIcon';
import { Badge } from '../../components/Primitives';
export function Conversation({ inquiry }: { inquiry: Inquiry }) {
  const { demo, mutate, busy, data } = useWorkspace();
  const canStartModel = !demo && inquiry.channel === 'whatsapp' && data?.llmSettings?.hasApiKey && !inquiry.localAi;
  const [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false),
    [catalogQuery, setCatalogQuery] = useState(inquiry.model || ''),
    [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogItem, setCatalogItem] = useState<CatalogItem | null>(null);
  const last = useRef<HTMLDivElement>(null),
    sendKey = useRef({ text: '', key: crypto.randomUUID() }),
    sending = useRef(false);
  async function load(signal?: AbortSignal) {
    try {
      const result = await api<Message[]>(
        '/inquiries/' + inquiry.id + '/messages',
        { signal },
        demo,
      );
      setMessages(result);
      setError('');
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : '消息加载失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), 12000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [inquiry.id, demo]);
  useEffect(() => {
    last.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [messages.length]);
  useEffect(() => {
    if (!catalogOpen) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<CatalogItem[]>(
        '/catalog?q=' + encodeURIComponent(catalogQuery),
        { signal: controller.signal },
        demo,
      )
        .then(setCatalog)
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [catalogOpen, catalogQuery, demo]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending.current || inquiry.owner !== 'human') return;
    sending.current = true;
    if (sendKey.current.text !== text) sendKey.current = { text, key: crypto.randomUUID() };
    try {
      const ok = await mutate(
        '/inquiries/' + inquiry.id + '/messages',
        { text, key: sendKey.current.key },
        'POST',
        demo ? '演示回复已保存' : '消息已提交',
      );
      if (ok) {
        setText('');
        sendKey.current = { text: '', key: crypto.randomUUID() };
        await load();
      }
    } finally {
      sending.current = false;
    }
  }
  return (
    <>
      <section className="chat">
        <header className="chat-header">
          <span className="avatar">{initials(inquiry.name)}</span>
          <div>
            <h2>{inquiry.name}</h2>
            <span className="chat-subtitle">
              <BrandIcon channel={inquiry.channel} size={13} />
              {inquiry.channel === 'whatsapp' ? 'WhatsApp' : 'Facebook'}
              <span className="divider" />
              {inquiry.phone || '询盘会话'}
            </span>
          </div>
          {canStartModel && inquiry.owner !== 'human' && (
            <button className="button" disabled={busy} onClick={() => void mutate(
              '/inquiries/' + inquiry.id + '/ai', {enabled:true}, 'POST', '工作台 AI 已接管新消息'
            )}>启用工作台 AI</button>
          )}
          <button
            disabled={busy}
            className={'button ' + (inquiry.owner === 'human' ? '' : 'primary')}
            onClick={() =>
              void mutate(
                '/inquiries/' + inquiry.id + '/ai',
                { enabled: inquiry.owner === 'human' },
                'POST',
                inquiry.owner === 'human' ? '已交回 AI' : '已暂停 AI，人工接管',
              )
            }
          >
            <UserRound size={15} />
            {inquiry.owner === 'human' ? (canStartModel ? '启用工作台 AI' : '交回 AI') : '人工接管'}
          </button>
        </header>
        <div className={'attendance-strip ' + (inquiry.owner === 'human' ? 'human' : '')}>
          <Bot size={15} />
          {inquiry.owner === 'human'
            ? '人工处理中 · AI 已暂停'
            : inquiry.owner === 'waiting'
              ? '型号与报价待人工确认'
              : inquiry.localAi ? (inquiry.aiError || '工作台 AI 接待中') : 'AI 接待中'}
          {demo && <span>演示会话</span>}
        </div>
        <div className="messages" role="log" aria-label="聊天记录">
          <div className="chat-date">今天</div>
          {loading && <p className="chat-loading">正在加载消息…</p>}
          {error && (
            <div className="error-banner">
              {error}
              <button onClick={() => void load()}>重试</button>
            </div>
          )}
          {messages.map((message) => (
            <div className={'message ' + message.direction} key={message.id}>
              <div className="message-bubble">
                {message.text || '[' + (message.mediaType || '附件') + ']'}
                <span className="message-meta">
                  {time(message.time)}
                  {message.direction === 'outbound' && (
                    <>
                      <CheckCheck size={12} />
                      {message.status === 'failed'
                        ? '发送失败'
                        : message.status === 'queued'
                          ? '排队中'
                          : message.status === 'demo'
                            ? '演示'
                            : ''}
                    </>
                  )}
                </span>
              </div>
            </div>
          ))}
          <div ref={last} />
        </div>
        <form className="composer" onSubmit={send}>
          <textarea
            aria-label="回复内容"
            value={text}
            disabled={inquiry.owner !== 'human'}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            placeholder={inquiry.owner === 'human' ? '输入回复…' : '人工接管后回复'}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer-footer">
            <span>
              {inquiry.owner === 'human'
                ? 'Enter 发送 · Shift + Enter 换行'
                : inquiry.owner === 'waiting'
                  ? '等待人工接管'
                  : 'AI 接待中'}
            </span>
            <button
              type="submit"
              className="send-button"
              disabled={busy || !text.trim() || inquiry.owner !== 'human'}
              aria-label="发送回复"
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </form>
      </section>
      <aside className="inquiry-details">
        <div className="detail-heading">
          <h3>询盘信息</h3>
          <Badge priority={inquiry.priority} />
        </div>
        <div className="detail-section">
          <span className="detail-label">当前进展</span>
          <p>{inquiry.summary}</p>
          <div className="detail-tags">
            {inquiry.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
        <div className="detail-section">
          <span className="detail-label">候选型号</span>
          <div className="model-number">{inquiry.model || '待识别'}</div>
          <small>{inquiry.model ? '报价前人工复核' : '等待照片、尺寸或 OE 编号'}</small>
        </div>
        <div className="detail-section">
          <span className="detail-label">型号资料</span>
          <button className="catalog-button" onClick={() => setCatalogOpen(!catalogOpen)}>
            <PackageSearch size={18} />
            <span>
              本地型号库 <small>{data?.catalogCount || 0} 个型号</small>
            </span>
            <ChevronRight size={15} />
          </button>
          {catalogOpen && (
            <div className="catalog-search">
              <label className="search-input">
                <Search size={14} />
                <input
                  aria-label="搜索本地型号"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder="搜索型号"
                />
              </label>
              <div className="catalog-results">
                {catalog.map((item) => (
                  <button key={item.model} onClick={() => setCatalogItem(item)}>
                    <strong>{item.model}</strong>
                    <small>{item.reviewed ? '已校验' : '待人工校验'}</small>
                  </button>
                ))}
                {!catalog.length && <small>没有找到型号</small>}
              </div>
            </div>
          )}
        </div>
      </aside>
      {catalogItem && <CatalogDialog item={catalogItem} onClose={() => setCatalogItem(null)} />}
    </>
  );
}
