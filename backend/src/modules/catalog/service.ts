import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { lookupFitments } from './fitments.js';
import type { CatalogItem } from '../../../../shared/contracts.js';
export class CatalogService {
  private items: CatalogItem[] = [];
  constructor(private root: string) {}
  async load() {
    const found: CatalogItem[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name));
        else if (entry.name === 'features.json') {
          try {
            const data = JSON.parse(await readFile(path.join(dir, entry.name), 'utf8'));
            const model = String(data.model_label || path.basename(dir));
            const features = data.features;
            const flat = typeof features?.summary === 'string' ? features.summary : '暂无形状摘要';
            found.push({
              model,
              summary: flat.length > 800 ? flat.slice(0, 800) + '…' : flat,
              reviewed: data.analysis?.human_reviewed === true,
            });
          } catch {
            /* A damaged model file must not prevent the workbench from starting. */
          }
        }
      }
    };
    await walk(this.root);
    this.items = found.sort((a, b) => a.model.localeCompare(b.model, 'zh-CN'));
  }
  count() {
    return this.items.length;
  }
  search(query: string) {
    const term = query.trim().toLowerCase();
    const visual = this.items.filter(i => !term || i.model.toLowerCase().includes(term));
    const rows = lookupFitments(term);
    const names = new Set(rows.map(row => row.model));
    return [...rows.map(row => ({
      model: row.model, reviewed: false, catalogId: row.id, page: row.page,
      summary: [row.dimensions + ' mm', row.holes == null ? '' : row.holes + '孔', row.fitment, row.warnings,
        '产品册 PDF 第' + row.page + '页'].filter(Boolean).join(' · '),
    })), ...visual.filter(row => !names.has(row.model))].slice(0, 30);
  }
}
