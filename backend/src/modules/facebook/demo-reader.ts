import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { backendRoot } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { facebookUrl } from './validation.js';

const run = promisify(execFile);
const output = z.object({
  title: z.string(), notice: z.string().optional(), comments: z.array(z.object({
    id: z.string(), text: z.string(), authorName: z.string().optional(), author: z.string().optional(),
    date: z.string().optional(), parentId: z.string().optional(),
  })),
});

export async function readDemoPost(url: string, onTitle?: (title: string) => void, authenticated = false) {
  const python = process.env.FACEBOOK_DEMO_PYTHON || path.join(backendRoot, 'data/facebook-scraper-venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  try {
    const job = run(python, [
      '-I', '-X', 'utf8', path.join(backendRoot, '../scripts/read-demo-facebook.py'), facebookUrl(url), '--report-title',
      ...(authenticated ? ['--authenticated'] : []),
    ], { cwd: path.join(backendRoot, 'data'), windowsHide: true, timeout: 360000, maxBuffer: 1024 * 1024 });
    const lines = createInterface({ input: job.child.stdout! });
    lines.once('line', line => {
      if (!line.startsWith('{"postTitle":')) return;
      const event = JSON.parse(line);
      if (typeof event.postTitle === 'string' && event.postTitle) onTitle?.(event.postTitle);
    });
    const { stdout } = await job;
    const value = JSON.parse(stdout.trimEnd().split('\n').at(-1)!);
    if (typeof value.error === 'string') throw new AppError(422, 'public_read', value.error);
    return output.parse(value);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const code = err instanceof Error && 'code' in err ? err.code : undefined;
    if (code === 'ENOENT') throw new AppError(503, 'public_read', '本机公开读取组件尚未安装');
    if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      throw new AppError(502, 'public_read', '本次评论数据超出读取上限');
    if (err instanceof Error && 'killed' in err && err.killed)
      throw new AppError(504, 'public_read', '本次读取超过 6 分钟，将按设定间隔重试');
    throw new AppError(502, 'public_read', '本地采集器未返回有效的评论数据');
  }
}
