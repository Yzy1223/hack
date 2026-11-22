import type { Message } from '../../../../shared/contracts.js';
import { lookupFitments, checkedFitments, type Fitment } from './fitments.js';

function measure(row: Fitment, field: number) {
  const value = row.dimensions.split('×')[field];
  return /^\d+(\.\d+)?$/.test(value || '') ? Number(value) : undefined;
}
function position(row: Fitment) {
  if (row.model.includes('前') && !row.model.includes('后')) return 'front';
  if (row.model.includes('后') && !row.model.includes('前')) return 'rear';
}
function distinct(rows: Fitment[]) {
  return [
    ...new Map(
      rows.map((row) => [[row.model, row.dimensions, row.holes, row.fitment].join('|'), row]),
    ).values(),
  ];
}
function question(rows: Fitment[]) {
  if (!rows.length) return '请提供旧件完整编号，或带标尺的正面和侧面照片。';
  if (rows.length === 1) return '请核对目录尺寸、孔数与旧件是否一致。';
  const holes = [...new Set(rows.map((r) => r.holes).filter((v) => v != null))].sort(
    (a, b) => a - b,
  );
  if (holes.length > 1) return '旧件一共有几个铆钉孔？目录中有 ' + holes.join('、') + ' 孔的候选。';
  if (new Set(rows.map(position).filter(Boolean)).size > 1) return '旧件装在前桥还是后桥？';
  const widths = [...new Set(rows.map((r) => measure(r, 1)).filter((v) => v !== undefined))].sort(
    (a, b) => a - b,
  );
  if (widths.length > 1) return '请量一下片宽，有 ' + widths.join('、') + ' mm 的候选。';
  const arcs = [...new Set(rows.map((r) => measure(r, 0)).filter((v) => v !== undefined))].sort(
    (a, b) => a - b,
  );
  if (arcs.length > 1) return '请量旧件外弧长度，目录候选分别为 ' + arcs.join('、') + ' mm。';
  if (new Set(rows.map((r) => r.dimensions)).size > 1)
    return '请提供完整尺寸（外弧×宽×厚），以核对规格。';
  return '这些候选的目录规格相近，请提供旧件完整编号或安装位置照片交销售复核。';
}

// Narrow only on affirmative, explicitly labelled measurements. Retain rows with unknown values.
export function inquiryEvidence(messages: Message[]) {
  let rows: Fitment[] = [],
    basis: string[] = [],
    conflict = false;
  let material = '',
    quantity = '',
    lastPrompt = '';
  let origin: Fitment[] = [];
  let filters: {
    holes?: number;
    width?: number;
    arc?: number;
    position?: string;
    dimensions?: string;
  } = {};
  for (const msg of messages.filter((m) => !m.revoked)) {
    if (msg.direction === 'outbound') {
      lastPrompt = msg.text;
      continue;
    }
    const text = msg.text.trim().slice(0, 1600);
    const bare = text.match(/^\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)?[.。!！]?$/i);
    const arc = text.match(/(?:外弧(?:长[度]?)?|arc length)\s*[:：=]?\s*(\d+(?:\.\d+)?)/i);
    const full = text.match(
      /(\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/i,
    );
    const holes = text.match(/(\d{1,2})\s*(?:个?孔|holes?\b)/i);
    const w = text.match(/(?:片宽|宽度|width|宽)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:毫米|mm)?/i);
    const pos = text.match(/(前桥|后桥|front(?: axle)?\b|rear(?: axle)?\b)/i);
    const ambiguous =
      /[?？]|不是|并非|可能|大概|大约|不确定|或者|\b(?:not|maybe|or|about)\b|\d\s*[-~至或/]\s*\d/i.test(
        full ? text.replace(full[0], '') : text,
      );
    const residual = text
      .replace(full?.[0] || /$^/, ' ')
      .replace(arc?.[0] || /$^/, ' ')
      .replace(holes?.[0] || /$^/, ' ')
      .replace(w?.[0] || /$^/, ' ')
      .replace(pos?.[0] || /$^/, ' ')
      .trim();
    const commercial = /\d+\s*(?:件|片|套|pcs\b|pieces?\b|sets?\b)|材料|材质|配方|material|grade/i;
    let next =
      residual &&
      !(bare && origin.length && /孔|holes?|片宽|width|外弧|arc length/i.test(lastPrompt)) &&
      (!commercial.test(residual) || /[a-z]\d|\d[a-z]/i.test(residual))
        ? lookupFitments(residual)
        : [];
    if (msg.mediaType === 'image') {
      rows = [];
      origin = [];
      filters = {};
      basis = [];
      conflict = false;
      material = '';
      quantity = '';
      if (!next.length && msg.photoMatch?.candidates.length) {
        next = msg.photoMatch.candidates.flatMap((c) =>
          lookupFitments(c.model).filter((r) => r.model === c.model),
        );
        if (next.length) basis.push('客户照片与外形档案相似，待核对');
      }
    }
    if (next.length) {
      origin = distinct(next);
      rows = origin;
      filters = {};
      basis = [text || '客户照片与外形档案相似，待核对'];
      conflict = false;
      material = '';
      quantity = '';
    }
    if (origin.length && !ambiguous) {
      const values: typeof filters = {};
      if (holes) values.holes = Number(holes[1]);
      if (w) values.width = Number(w[1]);
      if (arc) values.arc = Number(arc[1]);
      if (pos) values.position = /前|front/i.test(pos[0]) ? 'front' : 'rear';
      if (full) values.dimensions = full[1].replace(/\s+/g, '').replace(/[x*]/gi, '×');
      if (bare && !next.length) {
        if (/孔|holes?/i.test(lastPrompt)) values.holes = Number(bare[1]);
        else if (/片宽|width/i.test(lastPrompt)) values.width = Number(bare[1]);
        else if (/外弧|arc length/i.test(lastPrompt)) values.arc = Number(bare[1]);
      }
      if (Object.keys(values).length) {
        filters = { ...filters, ...values };
        rows = origin.filter(
          (r) =>
            (filters.holes === undefined || r.holes == null || r.holes === filters.holes) &&
            (filters.width === undefined ||
              measure(r, 1) === undefined ||
              measure(r, 1) === filters.width) &&
            (filters.arc === undefined ||
              measure(r, 0) === undefined ||
              measure(r, 0) === filters.arc) &&
            (!filters.position || !position(r) || position(r) === filters.position) &&
            (!filters.dimensions ||
              r.dimensions === filters.dimensions ||
              /[()（）]/.test(r.dimensions)),
        );
        if (!basis.includes(text)) basis.push(text);
        conflict = !rows.length;
      }
    }
    lastPrompt = '';
    if (!ambiguous && commercial.test(text)) {
      quantity =
        text.match(/\d+(?:,\d{3})*\s*(?:件|片|套|pcs\b|pieces?\b|sets?\b)/i)?.[0] || quantity;
      if (/材料|材质|配方|material|grade/i.test(text)) material = text;
    }
  }
  return { rows, basis, material, quantity, conflict, nextQuestion: question(rows) };
}

export function firstBatch() {
  return checkedFitments;
}
