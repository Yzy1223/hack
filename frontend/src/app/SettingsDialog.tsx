import { useState, type FormEvent } from 'react';
import { Modal } from '../components/Primitives';
import { useWorkspace } from './WorkspaceContext';
import { api } from '../lib/api';
import type { Workspace } from '../../../shared/contracts';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { data, demo, refresh } = useWorkspace();
  const [token, setToken] = useState('');
  const [address, setAddress] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [savedModel, setSavedModel] = useState<Workspace['llmSettings']>();
  const [saving, setSaving] = useState<'model' | 'facebook' | null>(null);
  const [modelMessage, setModelMessage] = useState('');
  const [tokenMessage, setTokenMessage] = useState('');
  const saved = savedModel ?? data?.llmSettings;
  const baseUrl = address ?? saved?.baseUrl ?? '';
  const model = name ?? saved?.model ?? '';
  const needsRestart = Boolean(data) && !demo && !saved;
  const disabled = Boolean(saving) || demo || !data;
  const modelChanged = Boolean(baseUrl.trim() && model.trim() && (apiKey.trim() || saved?.hasApiKey)
    && (baseUrl.trim() !== saved?.baseUrl || model.trim() !== saved?.model || apiKey.trim()));

  async function save(event: FormEvent, group: 'model' | 'facebook') {
    event.preventDefault();
    if (disabled) return;
    const feedback = group === 'model' ? setModelMessage : setTokenMessage;
    setSaving(group);
    feedback('');
    try {
      if (group === 'model') {
        const settings = await api<NonNullable<Workspace['llmSettings']>>('/settings/llm', {
          method:'PUT', body:JSON.stringify({baseUrl:baseUrl.trim(), model:model.trim(), apiKey:apiKey.trim() || undefined}),
        });
        setSavedModel(settings);
        setName(null);
        setAddress(null);
        setApiKey('');
        feedback('大模型配置已保存');
      } else {
        await api('/settings/apify', {method:'PUT', body:JSON.stringify({token:token.trim()})});
        setToken('');
        feedback('Apify Token 已保存');
      }
      void refresh();
    } catch (error) {
      feedback(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setSaving(null);
    }
  }

  return <Modal title="配置设置" onClose={onClose}>
    {demo && <p>请切换到真实数据后配置。</p>}
    <details className="settings-group" open>
      <summary>大模型</summary>
      <form className="stack-form" onSubmit={e => void save(e,'model')} onChange={() => setModelMessage('')}>
        <small>WhatsApp 自动回复和 Facebook 评论意向判断共用此模型。支持兼容 Chat Completions 的服务。</small>
        <label>LLM 接入地址
          <input type="url" required maxLength={2048} spellCheck={false} disabled={disabled || needsRestart}
            placeholder="https://api.example.com/v1" value={baseUrl} onChange={e => setAddress(e.target.value)} />
        </label>
        <label>API Key
          <input type="password" autoComplete="new-password" spellCheck={false} maxLength={4096}
            required={!saved?.hasApiKey} disabled={disabled || needsRestart} value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder={saved?.hasApiKey ? '已配置，留空保留现有密钥' : '输入模型服务的 API Key'} />
        </label>
        <label>模型名称
          <input required maxLength={256} spellCheck={false} value={model} onChange={e => setName(e.target.value)}
            disabled={disabled || needsRestart} placeholder="填写服务商提供的模型 ID" />
        </label>
        {needsRestart && <small role="status">双击项目目录中的 start-workbench.cmd 更新后台，然后刷新页面即可保存。</small>}
        <button className="button primary" disabled={disabled || needsRestart || !modelChanged}>
          {saving === 'model' ? '保存中…' : '保存大模型配置'}
        </button>
        {modelMessage && <small role="status">{modelMessage}</small>}
      </form>
    </details>
    <details className="settings-group">
      <summary>Facebook 采集</summary>
      <form className="stack-form" onSubmit={e => void save(e,'facebook')} onChange={() => setTokenMessage('')}>
        <label>Apify API Token
          <input type="password" required autoComplete="new-password" spellCheck={false} maxLength={4096}
            disabled={disabled} value={token} onChange={e => setToken(e.target.value)}
            placeholder={data?.apifyConfigured ? '已配置，可输入新 Token 替换' : '输入 Apify API Token'} />
          <small>从 <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noreferrer">Apify 的 API &amp; Integrations</a> 复制完整 Token。</small>
        </label>
        <button className="button primary" disabled={disabled || !token.trim()}>{saving === 'facebook' ? '保存中…' : '保存 Token'}</button>
        {tokenMessage && <small role="status">{tokenMessage}</small>}
      </form>
    </details>
  </Modal>;
}
