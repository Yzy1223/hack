import {
  BarChart3,
  CheckCheck,
  ChevronDown,
  CircleGauge,
  Settings,
  RefreshCw,
  ArrowUpRight,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { SettingsDialog } from './SettingsDialog';
import type { View } from '../../../shared/contracts';
import { BrandIcon } from '../components/BrandIcon';
import { StatusDot } from '../components/Primitives';
import { useWorkspace } from './WorkspaceContext';
const titles: Record<View, string> = {
  dashboard: '今日数据',
  inquiries: 'AI 询盘',
  facebook: 'Facebook 监控',
};
export function Shell({
  view,
  navigate,
  onConnect,
  children,
}: {
  view: View;
  navigate: (v: View) => void;
  onConnect: () => void;
  children: ReactNode;
}) {
  const { data, demo, setDemo, refresh, mutate, busy, error } = useWorkspace();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connected = data?.connection.sessions.some((x) => x.status === 'WORKING') || false;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('dashboard');
          }}
        >
          <CircleGauge size={30} strokeWidth={1.7} />
          <span>询盘工作台</span>
        </a>
        <nav aria-label="主要功能">
          <button
            aria-label="今日数据"
            className={view === 'dashboard' ? 'active' : ''}
            onClick={() => navigate('dashboard')}
          >
            <BarChart3 size={20} />
            <span>今日数据</span>
          </button>
          <button
            aria-label="AI 询盘"
            className={view === 'inquiries' ? 'active' : ''}
            onClick={() => navigate('inquiries')}
          >
            <BrandIcon channel="whatsapp" size={21} />
            <span>AI 询盘</span>
          </button>
          <button
            aria-label="Facebook 监控"
            className={view === 'facebook' ? 'active' : ''}
            onClick={() => navigate('facebook')}
          >
            <BrandIcon channel="facebook" size={21} />
            <span>Facebook 监控</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="settings-entry" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />配置设置
          </button>
          <div className="profile">
            <span className="avatar profile-avatar">欧</span>
            <span>
              <strong>欧阳</strong>
              <small>工作空间</small>
            </span>
            <ChevronDown size={15} />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="page-header">
          <h1>{titles[view]}</h1>
          <div className="header-actions">
            <button className="icon-button compact-settings" aria-label="配置设置" title="配置设置" onClick={() => setSettingsOpen(true)}>
              <Settings size={17} />
            </button>
            <div className="mode-switch" aria-label="数据模式">
              <button
                aria-pressed={!demo}
                className={!demo ? 'selected' : ''}
                onClick={() => setDemo(false)}
              >
                真实数据
              </button>
              <button
                aria-pressed={demo}
                className={demo ? 'selected' : ''}
                onClick={() => setDemo(true)}
              >
                演示数据
              </button>
            </div>
            <span className="date">
              {new Date().toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <button
              className="icon-button"
              onClick={() => void refresh()}
              title="刷新"
              aria-label="刷新数据"
            >
              <RefreshCw size={17} />
            </button>
            {view === 'dashboard' && (
              <button
                className="text-button mark-read"
                disabled={busy || !data?.inquiries.some((x) => x.unread)}
                onClick={() =>
                  void mutate(
                    '/inquiries/read',
                    {
                      ids: data?.inquiries.filter((x) => x.unread).map((x) => x.id),
                    },
                    'POST',
                    '已标为已读',
                  )
                }
              >
                <CheckCheck size={18} />
                全部标为已读
              </button>
            )}
          </div>
        </header>
        {(error || (data?.connection.error && !demo)) && (
          <div className="error-banner" role="alert">
            {error || data?.connection.error}
            <button onClick={() => void refresh()}>重试</button>
          </div>
        )}
        {data?.hasMore && <div className="error-banner">当前展示最近 100 条询盘</div>}
        {children}
        <footer className="channel-footer">
          <button onClick={onConnect}>
            <BrandIcon channel="whatsapp" size={24} />
            <strong>WhatsApp</strong>
            <span className="channel-state">
              <StatusDot online={connected} />
              {connected ? '已连接' : '未连接'}
            </span>
            <span className="footer-action">
              {connected ? '管理连接' : '连接账号'}
              <ArrowUpRight size={14} />
            </span>
          </button>
          <button onClick={() => navigate('facebook')}>
            <BrandIcon channel="facebook" size={24} />
            <strong>Facebook</strong>
            <span className="channel-state">
              <StatusDot />
              {demo ? '演示预览' : data?.monitors.some(m => m.status !== 'paused') ? '已启用监控' : '暂无活跃监控'}
            </span>
            <span className="footer-action">
              {data?.monitors.length || 0} 个链接
              <ArrowUpRight size={14} />
            </span>
          </button>
        </footer>
      </main>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
