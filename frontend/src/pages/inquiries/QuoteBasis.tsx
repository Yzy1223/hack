import { useEffect, useState } from 'react';
import type { Evidence, CatalogRow } from '../../../../shared/contracts';
import { api } from '../../lib/api';

function SourceRow({ row }: { row: CatalogRow }) {
  return (
    <details className="source-row">
      <summary>
        {row.model} · {row.holes == null ? '孔数待核' : row.holes + ' 孔'}
      </summary>
      <p>
        外弧 × 宽 × 厚（mm）
        <br />
        {row.dimensions}
      </p>
      {row.fitment && <p>目录适用栏 · {row.fitment}</p>}
      {row.references && <p>目录参考号 · {row.references}</p>}
      <small>
        冠隆产品册 PDF 第 {row.page} 页 · {row.id}
      </small>
      {row.warnings && <p>{row.warnings}</p>}
      {row.sourceChecked ? (
        <a href={'/api/catalog/source/' + row.id + '.webp'} target="_blank" rel="noreferrer">
          <img
            src={'/api/catalog/source/' + row.id + '.webp'}
            alt={row.model + ' 目录原行，点击查看大图'}
          />
        </a>
      ) : (
        <small>目录原行待核</small>
      )}
    </details>
  );
}

export function QuoteBasis({ evidence, demo }: { evidence: Evidence | null; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    api<CatalogRow[]>('/catalog/first-batch', { signal: controller.signal }, demo)
      .then(setRows)
      .catch(() => {
        if (!controller.signal.aborted) setError('目录加载失败，请重新展开。');
      });
    return () => controller.abort();
  }, [open, demo]);
  return (
    <section className="detail-section quote-basis">
      <h3>报价依据</h3>
      {evidence && (
        <>
          {evidence.basis.map((line, i) => (
            <p className="basis-line" key={i}>
              {line}
            </p>
          ))}
          <p>
            {evidence.conflict
              ? '客户信息与目录冲突，待人工复核'
              : evidence.count
                ? evidence.count + ' 条候选规格，待确认'
                : '等待客户提供旧件信息'}
          </p>
          {evidence.rows.map((row) => (
            <SourceRow row={row} key={row.id} />
          ))}
          <p>
            材料要求 · {evidence.material || '待确认'}
            <br />
            采购数量 · {evidence.quantity || '待确认'}
          </p>
          <p>下一步 · {evidence.nextQuestion}</p>
        </>
      )}
      <details
        onToggle={(e) => {
          setError('');
          setOpen(e.currentTarget.open);
        }}
      >
        <summary>首批已核对目录原行</summary>
        {rows.map((row) => (
          <SourceRow row={row} key={row.id} />
        ))}
        {error && <p>{error}</p>}
      </details>
    </section>
  );
}
