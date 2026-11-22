import { useEffect, useState } from 'react';
import { Modal } from '../../components/Primitives';
import sample from './buyer-evidence-demo.json';
import './buyer-leads.css';

// Start from evidence so a procurement plan can identify a user without an import record.
const buyers = sample.entityEvidence.map((buyer) => ({
  ...buyer,
  rows: sample.tradeRows.filter((row) => row.entityId === buyer.entityId),
}));
const storagePrefix = 'kooying.demo.buyer-follow.v1.';

function readFollowed() {
  try {
    return buyers
      .filter((buyer) => localStorage.getItem(storagePrefix + buyer.entityId) === '1')
      .map((buyer) => buyer.entityId);
  } catch {
    return [];
  }
}

export default function BuyerLeadsPanel() {
  const [selected, setSelected] = useState<(typeof buyers)[number] | null>(null);
  const [followed, setFollowed] = useState(readFollowed);
  const [onlyFollowed, setOnlyFollowed] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(storagePrefix)) setFollowed(readFollowed());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  function toggleFollow(id: string) {
    try {
      const key = storagePrefix + id;
      if (followed.includes(id)) localStorage.removeItem(key);
      else localStorage.setItem(key, '1');
      setFollowed(readFollowed());
      setError('');
    } catch {
      setError('浏览器未能保存跟进状态。请允许本站使用本地存储后重试。');
    }
  }

  const visible = buyers.filter((buyer) => !onlyFollowed || followed.includes(buyer.entityId));
  return (
    <section className="panel buyer-leads" aria-labelledby="buyer-leads-title">
      <header className="buyer-leads-header">
        <div>
          <h2 id="buyer-leads-title">终端买家核验</h2>
          <small>样例证据 · 菲律宾 · {buyers.length} 家机构</small>
        </div>
        <button
          className="small-button"
          aria-pressed={onlyFollowed}
          onClick={() => setOnlyFollowed(!onlyFollowed)}
        >
          我的跟进（{followed.length}）
        </button>
      </header>
      <div className="buyer-leads-list">
        {visible.map((buyer) => (
          <article key={buyer.entityId}>
            <small>
              {buyer.roleLabel}
              {followed.includes(buyer.entityId) && ' · 已加入跟进'}
            </small>
            <h3>{buyer.name}</h3>
            <p>{buyer.productFit}</p>
            <button
              className="small-button"
              onClick={() => {
                setSelected(buyer);
                setError('');
              }}
            >
              查看证据
            </button>
          </article>
        ))}
        {!visible.length && <p>暂无已加入跟进的机构。</p>}
      </div>
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)} drawer>
          <div className="buyer-evidence">
            <h3>{selected.roleLabel}</h3>
            <p>{selected.evidence}</p>
            {selected.sourceUrl ? (
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                {selected.sourceLabel} ↗
              </a>
            ) : (
              <small>
                {sample.workbook.fileName} · {sample.workbook.sheet}
              </small>
            )}
            {selected.rows.length > 0 && (
              <section>
                <h3>原始货描（{selected.rows.length} 行）</h3>
                {selected.rows.map((row) => (
                  <div className="buyer-goods" key={row.workbookRow}>
                    <small>
                      {row.date} · 明细表第 {row.workbookRow} 行
                    </small>
                    <p lang="en">{row.rawGoods}</p>
                    {row.sourceUrl && (
                      <a href={row.sourceUrl} target="_blank" rel="noreferrer">
                        贸易数据来源 ↗
                      </a>
                    )}
                  </div>
                ))}
              </section>
            )}
            <h3>销售下一步</h3>
            <p>{selected.nextStep}</p>
            <button className="button primary" onClick={() => toggleFollow(selected.entityId)}>
              {followed.includes(selected.entityId) ? '移出我的跟进' : '加入我的跟进'}
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
    </section>
  );
}
