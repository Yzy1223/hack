import { ArrowRight, ArrowUpRight, Link2, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Monitor } from '../../../../shared/contracts';
import { BrandIcon } from '../../components/BrandIcon';
import { EmptyState, StatusDot } from '../../components/Primitives';
import { useWorkspace } from '../../app/WorkspaceContext';
import { time } from '../../lib/api';
import { CommentDetails } from './CommentDetails';
import { displayHours, toIntervalMinutes } from './interval';
import './facebook.css';
export function MonitorCard({ item, deletable = false }: { item: Monitor; deletable?: boolean }) {
  const { mutate, busy, demo } = useWorkspace();
  const [showComments, setShowComments] = useState(false);
  return (
    <article className="monitor-card">
      <div className="monitor-title">
        <h3 title={item.title}>{item.title}</h3>
        <span>{time(item.updatedAt)}</span>
      </div>
      {item.demoSource !== "sample" && <a className="post-link" href={item.url} target="_blank" rel="noopener noreferrer">
        <Link2 size={14} />
        <span>{item.url.replace('https://www.', '').replace('https://', '')}</span>
        <ArrowUpRight size={14} />
      </a>}
      <div className="monitor-meta">
        <span>
          <StatusDot online={item.status === 'monitoring' && !item.syncError} />
          {item.provider === 'apify' && 'Apify · '}
          {item.status === 'paused' ? '已暂停' : item.collecting ? '正在读取' : item.syncError ? '自动更新待重试' : item.demoSource === 'sample' ? '演示样例' : item.status === 'pending' ? '等待自动读取' : '监控中'}
        </span>
        {item.leadCount !== null && (
          <span>
            已保存 <b>{item.comments}</b> 条评论
          </span>
        )}
        <button
          className="icon-button"
          disabled={busy}
          aria-label={item.status === 'paused' ? '恢复链接' : '暂停链接'}
          title={item.status === 'paused' && item.provider === 'apify' ? '启动 Apify 定时监控，每轮上限 0.10 美元' : undefined}
          onClick={() =>
            void mutate(
              '/monitors/' + item.id,
              { paused: item.status !== 'paused' },
              'PATCH',
              item.status === 'paused' ? '已恢复' : '已暂停',
            )
          }
        >
          {item.status === 'paused' ? <Play size={15} /> : <Pause size={15} />}
        </button>
      </div>
      <div className="monitor-card-bottom">
        <button className="text-button" aria-haspopup="dialog" onClick={() => setShowComments(true)}>
          查看帖子
          <ArrowRight size={14} />
        </button>
        <span className="lead-label">
          {item.leadCount == null ? '尚未分析' : <><b>{item.leadCount}</b> 条客户线索</>}
        </span>
        {item.intervalMinutes && <label className="monitor-interval">
          每 <input key={item.intervalMinutes} type="number" required min={0.0167} max={24} step="any"
            aria-label="监控间隔（小时）" defaultValue={displayHours(item.intervalMinutes)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            onBlur={async e => {
              const field = e.currentTarget;
              const saved = item.intervalMinutes!;
              const minutes = toIntervalMinutes(field.valueAsNumber);
              if (!field.validity.valid) { field.value = String(displayHours(saved)); return; }
              field.value = String(displayHours(minutes));
              if (minutes !== saved && !await mutate('/monitors/' + item.id, { intervalMinutes: minutes }, 'PATCH', '监控间隔已更新'))
                field.value = String(displayHours(saved));
            }} /> 小时
        </label>}
        {deletable && (
          <button
            className="icon-button"
            aria-label={'删除 ' + item.title}
            disabled={busy}
            onClick={() => {
              if (window.confirm('删除这个监控链接？'))
                void mutate('/monitors/' + item.id, undefined, 'DELETE', '链接已删除');
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {item.nextCheck && item.status !== 'paused' && item.browserOnline !== false && !item.collecting && <small>下次检查 · {time(item.nextCheck)}</small>}
      {demo && <small>{item.demoSource === 'sample' ? '模拟评论 · 离线演示' : '公开帖子 · 自动监控'}</small>}
      {showComments && <CommentDetails item={item} demo={demo} editable={deletable} onClose={() => setShowComments(false)} />}
    </article>
  );
}
export function MonitorPanel({ onAdd, onViewAll }: { onAdd: () => void; onViewAll: () => void }) {
  const { data, demo } = useWorkspace();
  return (
    <section className="panel monitor-panel">
      <header className="monitor-panel-header">
        <div className="section-title">
          <BrandIcon channel="facebook" size={25} />
          <h2>Facebook 监控</h2>
        </div>
        <button className="small-button" onClick={onAdd}>
          <Plus size={15} />
          添加
        </button>
      </header>
      <div className="monitor-subline">
        {data?.monitors.length || 0} 个帖子
        <span className="divider" />
        <StatusDot online={demo} />
        {demo ? '演示数据' : '公开帖子'}
      </div>
      <div className="monitor-list">
        {data?.monitors.slice(0, 3).map((item) => (
          <MonitorCard key={item.id} item={item} />
        ))}
      </div>
      {!data?.monitors.length && <EmptyState title="还没有添加帖子" />}
      <button className="button primary monitor-bottom" onClick={onViewAll}>
        查看全部链接
        <ArrowRight size={16} />
      </button>
    </section>
  );
}
