export async function api<T>(path: string, options: RequestInit = {}, demo = false): Promise<T> {
  const query = path.includes('?') ? '&' : '?';
  let response: Response;
  try {
    response = await fetch('/api' + path + query + 'demo=' + demo, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Workbench-Request': '1',
        ...options.headers,
      },
    });
  } catch (error) {
    if (options.signal?.aborted || !(error instanceof TypeError)) throw error;
    if (['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '4310') {
      throw new Error('未连接到本地工作台（4310）。请双击项目目录中的 start-workbench.cmd，再刷新页面。');
    }
    throw new Error('工作台未收到服务器响应，请检查连接后刷新页面。');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || '请求失败，请稍后重试');
  return body as T;
}
export const time = (value: string) =>
  new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
export const initials = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase();
