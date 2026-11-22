import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw, ExternalLink, Unplug, QrCode } from 'lucide-react';
import { Modal } from '../../components/Primitives';
import { BrandIcon } from '../../components/BrandIcon';
import { useWorkspace } from '../../app/WorkspaceContext';
import { api } from '../../lib/api';
const labels: Record<string, string> = {
  STARTING: '正在连接',
  SCAN_QR_CODE: '等待扫码',
  WORKING: '已连接',
  STOPPED: '已断开',
  FAILED: '连接失败',
};
export function ConnectionDialog({ onClose }: { onClose: () => void }) {
  const { data, demo, refresh } = useWorkspace();
  const connection = data?.connection;
  const [selected, setSelected] = useState(connection?.sessions[0]?.id || ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [qr, setQr] = useState(''),
    [revision, setRevision] = useState(0);
  const key = useRef(crypto.randomUUID());
  const session = connection?.sessions.find((x) => x.id === selected);
  useEffect(() => {
    if (!selected && connection?.sessions[0]) setSelected(connection.sessions[0].id);
  }, [connection, selected]);
  useEffect(() => {
    if (!selected || session?.status !== 'SCAN_QR_CODE') {
      setQr('');
      return;
    }
    const controller = new AbortController();
    let objectUrl = '';
    let timer: ReturnType<typeof setTimeout>;
    fetch('/api/whatsapp/sessions/' + selected + '/qr', {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message || '二维码暂未就绪');
        }
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setQr(objectUrl);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setQr('');
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) timer = setTimeout(() => setRevision((x) => x + 1), 12000);
      });
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected, session?.status, revision]);
  async function connect() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ data: { id: string } }>(
        '/whatsapp/sessions',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': key.current },
          body: '{}',
        },
        false,
      );
      setSelected(result.data.id);
      key.current = crypto.randomUUID();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接失败');
    } finally {
      setBusy(false);
    }
  }
  async function reconnect() {
    setBusy(true);
    setError('');
    try {
      await api('/whatsapp/sessions/' + selected + '/reconnect', {
        method: 'POST',
        body: '{}',
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重连失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="连接 WhatsApp" onClose={onClose}>
      <div className="connection-brand">
        <BrandIcon channel="whatsapp" size={35} />
        <strong>WhatsApp</strong>
      </div>
      {!connection?.configured ? (
        <div className="connection-empty">
          <Unplug size={36} strokeWidth={1.3} />
          <h3>DeskcommCRM 尚未部署</h3>
          <p>部署完成后，可在这里扫码连接。</p>
        </div>
      ) : (
        <>
          {connection.sessions.length > 0 && (
            <select
              className="session-select"
              aria-label="WhatsApp 账号"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {connection.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.phone} · {labels[s.status] || s.status}
                </option>
              ))}
            </select>
          )}
          <div className="qr-area">
            {session?.status === 'WORKING' ? (
              <>
                <CheckCircle2 size={56} color="#25a657" />
                <h3>WhatsApp 已连接</h3>
                <p>{session.phone}</p>
              </>
            ) : qr ? (
              <>
                <img src={qr} width={220} height={220} alt="WhatsApp 登录二维码" />
                <p>手机 WhatsApp → 已关联设备 → 关联设备</p>
              </>
            ) : (
              <>
                <QrCode size={58} strokeWidth={1} />
                <h3>{session ? labels[session.status] || session.status : '连接你的 WhatsApp'}</h3>
              </>
            )}
          </div>
          {!connection.adminSessionConfigured && (
            <div className="error-banner">扫码操作需要管理员登录会话</div>
          )}
        </>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="connection-actions">
        {session && session.status !== 'WORKING' && (
          <button
            className="button"
            disabled={busy || !connection?.adminSessionConfigured}
            onClick={() => void reconnect()}
          >
            <RefreshCw size={15} />
            重新连接
          </button>
        )}
        <button
          className="button primary"
          disabled={busy || demo || !connection?.configured || !connection.adminSessionConfigured}
          onClick={() => void connect()}
        >
          {busy ? '连接中…' : '连接新账号'}
        </button>
      </div>
      {demo && <p className="connection-note">切换到真实数据后连接账号</p>}
      {connection?.url && (
        <a className="crm-link" href={connection.url} target="_blank" rel="noopener noreferrer">
          打开 DeskcommCRM
          <ExternalLink size={13} />
        </a>
      )}
    </Modal>
  );
}
