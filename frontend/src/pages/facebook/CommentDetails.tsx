import { useEffect, useState } from 'react';
import type { Monitor, MonitorComment } from '../../../../shared/contracts';
import { Modal } from '../../components/Primitives';
import { useWorkspace } from '../../app/WorkspaceContext';
import { api } from '../../lib/api';

export function CommentDetails({ item, demo, editable, onClose }: { item: Monitor; demo: boolean; editable: boolean; onClose: () => void }) {
  const { busy, mutate } = useWorkspace();
  const canConfigure = editable && item.authenticated !== undefined;
  const [rows, setRows] = useState<MonitorComment[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<MonitorComment[]>('/monitors/' + item.id + '/comments', { signal: controller.signal }, demo)
      .then(data => {
        if (controller.signal.aborted) return;
        setRows(data);
        setError('');
      })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [item.id, item.updatedAt, demo]);

  return (
    <Modal title="帖子评论" drawer onClose={onClose}>
      <h3>{item.title}</h3>
      {editable && item.provider === 'apify' && <div>
        <small>Apify 每轮最多读取 5 条评论或回复，费用上限 0.10 美元。</small>
        <button className="text-button" disabled={busy || item.collecting}
          onClick={() => item.status === 'paused'
            ? void mutate('/monitors/'+item.id,{paused:false},'PATCH','已启动 Apify 定时监控')
            : void mutate('/monitors/'+item.id+'/analyze',{},'POST','采集完成')}>
          {item.status === 'paused' ? '启动 Apify 定时监控' : '立即用 Apify 采集'}
        </button>
      </div>}
      {item.browserSnapshot && <p className="comment-count">浏览器已读取 · {new Date(item.updatedAt).toLocaleString('zh-CN')}</p>}
      {item.demoSource === 'sample' && <small>演示样例</small>}
      {editable && item.browserOnline !== undefined && item.status !== 'paused' &&
        <button className="text-button" disabled={busy || item.collecting || !item.browserOnline}
          onClick={() => void mutate('/monitors/' + item.id + '/analyze', {}, 'POST', '已排队读取评论')}>
          {item.collecting ? '正在采集评论' : item.browserOnline ? '立即采集评论' : '等待 Chrome 采集器连接'}
        </button>}
      {(canConfigure || item.syncError || item.titleError) && <details className="collection-details">
        <summary>采集详情</summary>
        {canConfigure && <label><input type="checkbox" checked={item.authenticated} disabled={busy || item.collecting}
          onChange={e => void mutate('/monitors/' + item.id, { authenticated: e.target.checked }, 'PATCH', '读取方式已更新')} /> 使用本机 Facebook 登录状态</label>}
        {canConfigure && item.status !== 'paused' && <button className="text-button" disabled={busy || item.collecting}
          onClick={() => void mutate('/monitors/' + item.id + '/analyze', {}, 'POST', '本次读取完成')}>立即试读</button>}
        {item.syncError && <p>最近一次后台自动采集 · {item.syncError}</p>}
        {item.titleError && item.titleError !== item.syncError && <p>帖子标题 · {item.titleError}</p>}
      </details>}
      {error && <p role="alert">{error}</p>}
      {rows === null && !error && <p role="status">正在加载已保存的评论…</p>}
      {rows?.length === 0 && <p>{item.leadCount === null ? '尚未获取到评论' : '本次采集返回 0 条评论'}</p>}
      {rows && rows.length > 0 && <>
        <p className="comment-count">共 {rows.length} 条评论和回复</p>
        <ul className="comment-list">{rows.map(row => (
          <li key={row.id} className={row.buyingIntent ? 'potential-customer' : undefined}>
            <strong>{row.authorName || '未知用户'}</strong>
            {row.parentId && <small> · 回复</small>}
            {row.buyingIntent && <span className="intent-label">潜在客户</span>}
            <p>{row.text || '无文字内容'}</p>
            {row.date && <small>{new Date(row.date).toLocaleString('zh-CN')}</small>}
          </li>
        ))}</ul>
      </>}
    </Modal>
  );
}
