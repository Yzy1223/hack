import { readFileSync } from 'node:fs';

interface Fitment {
  id: string; model: string; series: string; dimensions: string; holes: number | null;
  fitment: string; references: string; warnings: string; duplicate: string; page: number;
}
const normalize = (s: string) => s.normalize('NFKC').toUpperCase().replace(/[\s‐‑–—-]+/g, '');
const records = JSON.parse(readFileSync(new URL('../../../resources/fitments.json', import.meta.url), 'utf8')) as Fitment[];
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
