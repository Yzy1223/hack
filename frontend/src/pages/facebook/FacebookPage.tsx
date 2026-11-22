import { useState } from 'react';
import { Plus, Search, MessageCircle, ExternalLink } from 'lucide-react';
import { BrandIcon } from '../../components/BrandIcon';
import { EmptyState } from '../../components/Primitives';
import { useWorkspace } from '../../app/WorkspaceContext';
import { MonitorCard } from './MonitorPanel';
import { AddMonitorDialog } from './AddMonitorDialog';
export function FacebookPage() {
  const { data, demo } = useWorkspace();
  const [adding, setAdding] = useState(false),
    [tab, setTab] = useState('links'),
    [query, setQuery] = useState('');
  const monitors = (data?.monitors || []).filter((x) =>
    [x.title, x.url].some(value => value.toLowerCase().includes(query.trim().toLowerCase())),
  );
  return (
    <section className="panel facebook-page">
      <div className="facebook-header">
        <div className="section-title">
          <BrandIcon channel="facebook" size={32} />
          <div>
            <h2>Facebook</h2>
            <small>公开帖子</small>
          </div>
        </div>
        <span className="connection-label">{demo ? '演示数据' : '公开评论监控'}</span>
        <button className="button primary" onClick={() => setAdding(true)}>
          <Plus size={17} />
          添加帖子
        </button>
      </div>
      <div className="facebook-tabs">
        <div className="line-tabs">
          {[
            ['links', '帖子链接'],
            ['comments', '客户线索'],
            ['messages', '私信'],
          ].map(([value, label]) => (
            <button
              className={tab === value ? 'selected' : ''}
              onClick={() => setTab(value)}
              key={value}
            >
              {label}
              {value === 'links' && <span>{data?.monitors.length || 0}</span>}
            </button>
          ))}
        </div>
        {tab === 'links' && (
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="搜索帖子"
              placeholder="搜索帖子"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
      </div>
      {!demo && tab === 'links' && data?.monitors.some(m => m.browserOnline === false) &&
        <details className="collector-setup"><summary>连接 Chrome 采集器</summary>
          <p>在已登录 Facebook 的 Chrome 打开 chrome://extensions，启用开发者模式，选择「加载已解压的扩展程序」。本机项目中的扩展文件夹为 <code>inquiry-workbench\facebook-browser</code>。</p>
          <p>连接后，采集器会在后台标签页读取到期帖子并自动保存评论。监控期间请保持 Chrome 和本地工作台服务运行。</p>
        </details>}
      {tab === 'links' ? (
        <>
          <div className="facebook-link-list">
            {monitors.map((item) => (
              <MonitorCard key={item.id} item={item} deletable />
            ))}
          </div>
          {!monitors.length && (
            <EmptyState
              title={query ? '没有找到帖子' : '添加第一个帖子链接'}
              action={
                !query && (
                  <button className="button" onClick={() => setAdding(true)}>
                    <Plus size={16} />
                    添加帖子
                  </button>
                )
              }
            />
          )}
        </>
      ) : tab === 'comments' ? (
        <div className="facebook-link-list">
          {(data?.monitors || []).filter(m => (m.leadCount ?? 0) > 0).map(item => <MonitorCard key={item.id} item={item} />)}
          {!data?.monitors.some(m => (m.leadCount ?? 0) > 0) && <EmptyState title="暂无已识别的客户线索" />}
        </div>
      ) : (
        <div className="integration-empty">
          <MessageCircle size={38} strokeWidth={1.3} />
          <h3>私信尚未接入</h3>
          <span>个人账号</span>
          <a
            className="button"
            href="https://www.facebook.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            打开 Facebook
            <ExternalLink size={15} />
          </a>
        </div>
      )}
      {demo && tab === 'links' && <div className="table-bottom">预置帖子为模拟评论。添加的公开帖子按设定间隔自动监控。</div>}
      {adding && <AddMonitorDialog onClose={() => setAdding(false)} />}
    </section>
  );
}
