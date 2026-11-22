import { readFileSync } from 'node:fs';

export interface Fitment {
  sourceChecked?: boolean;
  id: string; model: string; series: string; dimensions: string; holes: number | null;
  fitment: string; references: string; warnings: string; duplicate: string; page: number;
}
const normalize = (s: string) => s.normalize('NFKC').toUpperCase().replace(/[\s‐‑–—-]+/g, '');
const records = JSON.parse(readFileSync(new URL('../../../resources/fitments.json', import.meta.url), 'utf8')) as Fitment[];
// Source crops are valid only while the compared catalogue fields still agree.
const checked: Record<string, unknown[]> = {
  "GL-P11-C4-R04": [
    "CA485前A",
    "208×160×16/20",
    8,
    "CA485前A",
    11
  ],
  "GL-P11-C4-R05": [
    "CA485前B",
    "202×160×9/20",
    8,
    "CA485前B",
    11
  ],
  "GL-P11-C4-R06": [
    "CA485后",
    "190×220×12/16",
    12,
    "解放485桥",
    11
  ],
  "GL-P12-C2-R11": [
    "解放J6前",
    "210×150×14.5",
    10,
    "解放J6前",
    12
  ],
  "GL-P12-C2-R12": [
    "解放J6后A",
    "169×200×14/19",
    10,
    "解放J6后A",
    12
  ],
  "GL-P12-C3-R01": [
    "解放J6后B",
    "206×200×11.5/19",
    16,
    "解放J6后B",
    12
  ]
};
for (const row of records) {
  const values = [row.model, row.dimensions, row.holes, row.fitment, row.page];
  row.sourceChecked = checked[row.id]?.every((v,i) => v === values[i]) === true;
}
export const checkedFitments = records.filter(row => row.sourceChecked);
const searchable = records.filter(row => !row.duplicate).map(row => {
  const name = normalize(row.model);
  const aliases = [row.model, ...row.fitment.split(/[、,，；;]/).map(v => v.replace(/^通用/, ''))];
  const codes = row.references.split('、').filter(Boolean).map(v => normalize(v.replace(/^目录适用栏参考号\s*/, '')));
  const family = /[前后][AB]$/.test(name) ? name.slice(0,-1) : '';
  return {row, name, family, aliases: aliases.map(normalize).filter(v => v.length >= 2), codes};
});

// Match codes as complete identifiers, including in a customer's sentence.
function containsKey(text: string, key: string) {
  let index = text.indexOf(key);
  while (index >= 0) {
    const after = text[index + key.length] || '';
    const before = text[index - 1] || '';
    if (!(/[A-Z0-9]/.test(key[0]) && /[A-Z0-9]/.test(before)) &&
        !(/[A-Z0-9]/.test(key.at(-1)!) && /[A-Z0-9]/.test(after))) return true;
    index = text.indexOf(key, index + 1);
  }
  return false;
}

export function lookupFitments(input: string) {
  const text = normalize(input);
  if (text.length < 2) return [];
  const tokens = input.normalize('NFKC').toUpperCase().match(/[A-Z]+[A-Z\d]*(?:[-‐][A-Z\d]+)*|\d+[A-Z\d]*(?:[-‐][A-Z\d]+)*|[\u3400-\u9fff]+/g) || [];
  const terms = tokens.filter(t => t.length >= 2).map(normalize);
  const scored = searchable.map(({row, name, family, aliases, codes}) => {
    const exact = name === text || codes.includes(text);
    let score = exact ? 100 : 0;
    if (!score && (codes.some(c => containsKey(text, c) || terms.includes(c)) || containsKey(text, name) || terms.includes(name))) score = 80;
    if (!score && name.startsWith(text) && /[\u3400-\u9fff]/.test(text)) score = 60;
    if (!score && family && containsKey(text, family)) score = 60;
    if (!score && aliases.some(a => containsKey(text, a))) score = 60;
    if (!score && (aliases.some(a => containsKey(a, text)) || normalize(row.series) === text)) score = 40;
    if (!score && terms.some(t => aliases.some(a => containsKey(a, t)))) score = 20;
    return {row, score};
  }).filter(item => item.score > 0).sort((a,b) => b.score - a.score);
  const best = scored[0]?.score;
  return scored.filter(item => item.score === best).map(item => item.row);
}
