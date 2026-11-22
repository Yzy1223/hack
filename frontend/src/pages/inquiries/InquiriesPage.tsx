import { useEffect, useState } from 'react';
import { Search, Plus, MessageSquare } from 'lucide-react';
import { useWorkspace } from '../../app/WorkspaceContext';
import { BrandIcon } from '../../components/BrandIcon';
import { EmptyState } from '../../components/Primitives';
import { initials, time } from '../../lib/api';
import { Conversation } from './Conversation';
import './inquiries.css';
export function InquiriesPage({
  initialSelected,
  onConnect,
}: {
  initialSelected: string | null;
  onConnect: () => void;
}) {
  const { data } = useWorkspace();
  const [selected, setSelected] = useState(initialSelected),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const rows = data?.inquiries || [];
  useEffect(() => {
    if (rows.length && !rows.some((x) => x.id === selected)) setSelected(rows[0].id);
  }, [rows, selected]);
  const current = rows.find((x) => x.id === selected);
  const visible = rows.filter(
    (x) =>
      (filter === 'all' ||
        (filter === 'waiting' && x.owner === 'waiting') ||
        (filter === 'human' && x.owner === 'human')) &&
      [x.name, x.summary, x.model || ''].join(' ').toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="inbox-layout panel">
      <aside className="conversation-list">
        <div className="inbox-list-heading">
          <h2>
            全部询盘 <span>{rows.length}</span>
          </h2>
          <button className="icon-button" aria-label="连接 WhatsApp" onClick={onConnect}>
            <Plus size={20} />
          </button>
        </div>
        <div className="inbox-search">
          <label className="search-input">
            <Search size={15} />
            <input
              aria-label="搜索询盘"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索客户、型号…"
            />
          </label>
        </div>
        <div className="inbox-tabs">
          {[
            ['all', '全部'],
            ['waiting', '待接管'],
            ['human', '处理中'],
          ].map(([value, label]) => (
            <button
              className={filter === value ? 'selected' : ''}
              key={value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="conversation-items">
          {visible.map((row) => (
            <button
              className={'conversation-item ' + (row.id === selected ? 'selected' : '')}
              onClick={() => setSelected(row.id)}
              key={row.id}
              aria-pressed={row.id === selected}
            >
              <span className="avatar">
                {initials(row.name)}
                <span className="avatar-channel">
                  <BrandIcon channel={row.channel} size={13} />
                </span>
              </span>
              <span className="conversation-preview">
                <span className="conversation-title">
                  <strong>{row.name}</strong>
                  <time>{time(row.time)}</time>
                </span>
                <span className="conversation-summary">{row.summary}</span>
                <span className="conversation-caption">
                  <span className={'priority-dot ' + row.priority} />
                  {row.owner === 'waiting'
                    ? '等待人工接管'
                    : row.owner === 'human'
                      ? '人工处理中'
                      : 'AI 接待中'}
                  {row.unread > 0 && <b>{row.unread}</b>}
                </span>
              </span>
            </button>
          ))}
          {!visible.length && (
            <EmptyState
              title="暂无询盘"
              action={
                !rows.length && (
                  <button className="button" onClick={onConnect}>
                    连接 WhatsApp
                  </button>
                )
              }
            />
          )}
        </div>
      </aside>
      {current ? (
        <Conversation key={current.id} inquiry={current} />
      ) : (
        <div className="inbox-empty">
          <MessageSquare size={42} strokeWidth={1.2} />
          <h3>开始接待第一位客户</h3>
          <button className="button primary" onClick={onConnect}>
            <BrandIcon channel="whatsapp" size={18} />
            连接 WhatsApp
          </button>
        </div>
      )}
    </section>
  );
}
