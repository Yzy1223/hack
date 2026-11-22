import { useState } from 'react';
import {
  ArrowRight,
  Bell,
  Layers,
  MessagesSquare,
  UserRoundCheck,
  ListFilter,
  Search,
} from 'lucide-react';
import { useWorkspace } from '../../app/WorkspaceContext';
import { BrandIcon } from '../../components/BrandIcon';
import { Badge, EmptyState } from '../../components/Primitives';
import { MonitorPanel } from '../facebook/MonitorPanel';
import { AddMonitorDialog } from '../facebook/AddMonitorDialog';
import { time } from '../../lib/api';
import type { Channel, Priority } from '../../../../shared/contracts';
import './dashboard.css';
const ranks: Record<Priority, number> = { urgent: 0, followup: 1, low: 2 };
export function DashboardPage({
  openInquiry,
  openFacebook,
}: {
  openInquiry: (id: string) => void;
  openFacebook: () => void;
}) {
  const { data, loading } = useWorkspace();
  const [channel, setChannel] = useState<'all' | Channel>('all'),
    [priority, setPriority] = useState('all'),
    [filter, setFilter] = useState(false),
    [search, setSearch] = useState(''),
    [adding, setAdding] = useState(false);
  const inquiries = data?.inquiries || [];
  const shown = inquiries
    .filter(
      (x) =>
        (channel === 'all' || x.channel === channel) &&
        (priority === 'all' || x.priority === priority) &&
        [x.name, x.summary].join(' ').toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => ranks[a.priority] - ranks[b.priority] || b.time.localeCompare(a.time));
  const stats = [
    {
      label: '待处理',
      count: inquiries.filter((x) => x.owner !== 'human').length,
      icon: MessagesSquare,
    },
    {
      label: '紧急',
      count: inquiries.filter((x) => x.priority === 'urgent').length,
      icon: Bell,
      className: 'urgent-number',
    },
    {
      label: '待接管',
      count: inquiries.filter((x) => x.owner === 'waiting').length,
      icon: UserRoundCheck,
      className: 'followup-number',
    },
    {
      label: '今日询盘',
      count: inquiries.filter(
        (x) => new Date(x.createdAt).toDateString() === new Date().toDateString(),
      ).length,
      icon: Layers,
    },
  ];
  return (
    <>
      <section className="stats" aria-label="今日概览">
        {stats.map((stat) => (
          <article className="stat" key={stat.label}>
            <div className="stat-icon">
              <stat.icon size={23} strokeWidth={1.55} />
            </div>
            <div>
              <span>{stat.label}</span>
              <strong className={stat.className}>
                {loading ? '—' : stat.count.toString().padStart(2, '0')}
              </strong>
            </div>
          </article>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="panel queue-panel">
          <div className="panel-toolbar">
            <h2>离线期间</h2>
            <div className="tabs" aria-label="询盘来源">
              {(['all', 'whatsapp', 'facebook'] as const).map((c) => (
                <button
                  key={c}
                  aria-pressed={channel === c}
                  className={channel === c ? 'selected' : ''}
                  onClick={() => setChannel(c)}
                >
                  {c === 'all' ? '全部' : c === 'whatsapp' ? 'WhatsApp' : 'Facebook'}
                  <span>{inquiries.filter((x) => c === 'all' || x.channel === c).length}</span>
                </button>
              ))}
            </div>
            <button
              className={'icon-button filter-button ' + (filter ? 'selected' : '')}
              onClick={() => setFilter(!filter)}
              aria-label="筛选询盘"
              aria-expanded={filter}
            >
              <ListFilter size={19} />
            </button>
          </div>
          {filter && (
            <div className="filter-bar">
              <label className="search-input">
                <Search size={16} />
                <input
                  aria-label="搜索客户或内容"
                  placeholder="搜索客户或内容"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <select
                aria-label="紧急程度"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="all">全部优先级</option>
                <option value="urgent">紧急</option>
                <option value="followup">待跟进</option>
                <option value="low">低优先</option>
              </select>
            </div>
          )}
          <div className="table-scroll">
            <table className="inquiry-table">
              <thead>
                <tr>
                  <th>优先级</th>
                  <th>客户</th>
                  <th>内容摘要</th>
                  <th>来源</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} className={row.unread ? 'unread' : ''}>
                    <td>
                      <Badge priority={row.priority} />
                    </td>
                    <td>
                      <button className="customer-name" onClick={() => openInquiry(row.id)}>
                        {row.name}
                        {row.unread > 0 && <i className="unread-dot" />}
                      </button>
                    </td>
                    <td>
                      <span className="summary-text" title={row.summary}>
                        {row.summary}
                      </span>
                    </td>
                    <td>
                      <span className="source">
                        <BrandIcon channel={row.channel} size={18} />
                        <span>{row.channel === 'whatsapp' ? 'WhatsApp' : 'Facebook'}</span>
                      </span>
                    </td>
                    <td className="muted">{time(row.time)}</td>
                    <td>
                      <button className="small-button" onClick={() => openInquiry(row.id)}>
                        {row.owner === 'human' ? '查看' : '接管'}
                        <ArrowRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!shown.length && (
            <EmptyState
              title={
                loading ? '正在加载…' : inquiries.length ? '没有符合条件的询盘' : '暂无待处理询盘'
              }
            />
          )}
          <div className="table-bottom">
            <span>{shown.length} 条事项</span>
            <span>按紧急程度排序</span>
          </div>
        </section>
        <MonitorPanel onAdd={() => setAdding(true)} onViewAll={openFacebook} />
      </div>
      {adding && <AddMonitorDialog onClose={() => setAdding(false)} />}
    </>
  );
}
