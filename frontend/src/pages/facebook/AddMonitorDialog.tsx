import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Primitives';
import { useWorkspace } from '../../app/WorkspaceContext';
import { toIntervalMinutes } from './interval';
export function AddMonitorDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [hours, setHours] = useState('1');
  const { mutate, busy, demo } = useWorkspace();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await mutate('/monitors', { url, intervalMinutes: toIntervalMinutes(Number(hours)) }, 'POST', '已开始监控')) onClose();
  }
  return (
    <Modal title="添加 Facebook 帖子" onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        <label>
          帖子链接
          <input
            autoFocus
            required
            type="url"
            maxLength={2048}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.facebook.com/…"
          />
        </label>
        <label>监控间隔（小时）
          <input required type="number" min={0.0167} max={24} step="any" value={hours}
            onChange={event => setHours(event.target.value)} />
        </label>
        <div className="form-actions">
          {!demo && <small>Apify 每轮费用上限 0.10 美元。</small>}
          <button type="button" className="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? '保存中…' : '开始监控'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
