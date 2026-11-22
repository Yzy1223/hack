import { useRef, useState } from 'react';
import { ImagePlus, ScanLine, Send, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { AgentResult } from '../../../../shared/agent-chat';
import './agent.css';

interface Turn { id: string; image: string; note: string; result?: AgentResult; error?: string }

async function prepare(file: File) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (file.size > 16 * 1024 * 1024) throw new Error('请选择 16 MB 以内的图片。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1,Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法读取图片。');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [.88,.72,.53,.35]) {
      const data = canvas.toDataURL('image/jpeg',quality);
      if (data.length < 960000) return data;
    }
    throw new Error('图片细节过多，请裁剪至单片刹车片再发送。');
  } finally { URL.revokeObjectURL(url); }
}

function Result({ result }: { result: AgentResult }) {
  const [grade,setGrade] = useState(''), [rate,setRate] = useState('');
  const priced = grade.trim() && Number.isFinite(Number(rate)) && Number(rate) > 0;
  const canPrice = result.candidates.some(c => c.specifications.some(r => r.coefficient !== null));
  return <div className="ag-result">
    <p>{result.observation}</p>
    {!result.candidates.length && <p className="ag-muted">暂未匹配到型号。可补拍旧件编号或带标尺的完整正面。</p>}
    {result.candidates.map(c => <section className="ag-match" key={c.model}>
      <small>候选型号 · 待核对</small><h3>{c.model}</h3>
      {c.evidence.map(e => <p key={e}>{e}</p>)}
      {!c.specifications.length && <p>缺少对应目录规格，待销售核价。</p>}
      {c.specifications.map(row => <div className="ag-spec" key={row.id}>
        <strong>报价依据</strong><p>{row.dimensions} mm{row.holes !== null && ' · '+row.holes+' 孔'}</p>
        <small>冠隆产品册 PDF 第 {row.page} 页 · {row.id}</small>
        {row.warning && <p>{row.warning}</p>}
        {row.coefficient === null ? <p>当前规格需人工核价。</p> :
          <><p>单片核算系数 {Number(row.coefficient.toFixed(8))} × 材料单价</p>
          {priced && <strong>{grade} · 内部参考 ¥{(row.coefficient*Number(rate)).toFixed(2)} / 片</strong>}</>}
      </div>)}
    </section>)}
    {canPrice && <details className="ag-price"><summary>按已选材料试算</summary>
      <p>外弧 × 宽度 × (厚度1 + 厚度2) ÷ 2 × 1.15 × 2.2 ÷ 1,000,000 × 材料单价</p>
      <div><label>材料档位<input value={grade} onChange={e=>setGrade(e.target.value)} placeholder="输入已选档位"/></label>
      <label>材料单价（元/kg）<input type="number" min="0" step="any" value={rate} onChange={e=>setRate(e.target.value)} placeholder="输入工厂现行价"/></label></div>
    </details>}
  </div>;
}

export function AgentChat() {
  const [turns,setTurns] = useState<Turn[]>([]), [image,setImage] = useState(''), [note,setNote] = useState('');
  const [busy,setBusy] = useState(false), [reading,setReading] = useState(false), [error,setError] = useState('');
  const picker = useRef<HTMLInputElement>(null), lock = useRef(false), end = useRef<HTMLDivElement>(null);
  const scroll = () => requestAnimationFrame(() => end.current?.lastElementChild?.scrollIntoView({block:'start'}));
  async function choose(file?:File) {
    if (!file) return;
    setReading(true); setError(''); setImage('');
    try { setImage(await prepare(file)); } catch(e) { setError(e instanceof Error ? e.message : '图片读取失败'); }
    finally { setReading(false); }
  }
  async function send(picture:string, message:string) {
    if (lock.current || !picture) return;
    lock.current = true; setBusy(true); setError('');
    const entry:Turn = {id:crypto.randomUUID(),image:picture,note:message};
    setTurns(list => [...list.slice(-9),entry]); setImage(''); setNote(''); scroll();
    try {
      const result = await api<AgentResult>('/agent/chat',{method:'POST',body:JSON.stringify({image:picture,note:message})});
      setTurns(list => list.map(t => t === entry ? {...t,result} : t));
    } catch(e) {
      const problem = e instanceof Error ? e.message : '识别失败，请重试';
      setTurns(list => list.map(t => t === entry ? {...t,error:problem} : t));
    } finally { lock.current=false; setBusy(false); scroll(); }
  }
  const last = turns.at(-1);
  return <section className="panel ag-chat">
    {turns.length === 0 && <div className="ag-empty"><ScanLine size={34}/><h2>识别刹车片</h2>
      <p>发送旧件正面或编号照片，查看候选型号和报价依据。</p></div>}
    <div ref={end} className="ag-log" aria-live="polite">{turns.map(t => <article key={t.id}>
      <div className="ag-user"><img src={t.image} alt="发送的刹车片照片"/>{t.note && <p>{t.note}</p>}</div>
      {t.result ? <Result result={t.result}/> : t.error ? <div className="ag-result"><p role="alert">{t.error}</p>
        <button className="button" disabled={busy} onClick={()=>void send(t.image,t.note)}>重试识别</button></div> :
        <p role="status">正在识别图片并匹配产品目录…</p>}
    </article>)}</div>
    <form className="ag-form" onSubmit={e => {e.preventDefault();void send(image || last?.image || '',note.trim());}}>
      {image && <div className="ag-preview"><img src={image} alt="待发送照片"/><button type="button" aria-label="移除照片" onClick={()=>setImage('')}><X size={17}/></button></div>}
      <label className="ag-note">补充说明<input maxLength={800} value={note} onChange={e=>setNote(e.target.value)} placeholder={last && !image ? '继续补充上一张照片的信息，或上传新图' : '例如车型、车桥或旧件编号（选填）'}/></label>
      {error && <p role="alert">{error}</p>}
      <div className="ag-actions"><input hidden type="file" ref={picker} accept="image/jpeg,image/png,image/webp" onChange={e=>{void choose(e.target.files?.[0]);e.target.value='';}}/>
      <button className="button" type="button" disabled={busy||reading} onClick={()=>picker.current?.click()}><ImagePlus size={17}/>{reading?'读取中…':'添加图片'}</button>
      <button className="button primary" disabled={busy||reading||(!image&&!(last&&note.trim()))}><Send size={16}/>{busy?'识别中…':'发送'}</button></div>
      <small className="ag-muted">图片将发送至工作台已配置的视觉模型，报价仅供销售参考。</small>
    </form>
  </section>;
}
