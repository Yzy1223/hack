import { AppError } from '../../lib/errors.js';
export function postLabel(url: string): string {
  const reel = new URL(url).pathname.match(/^\/reel\/(\d+)\/?$/);
  return reel ? 'Reel · ' + reel[1] : 'Facebook 帖子';
}
export function facebookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(422, 'invalid_url', '请输入完整的 Facebook 链接');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch')
  ) {
    throw new AppError(422, 'invalid_url', '请使用 https:// 开头的 Facebook 帖子链接');
  }
  if (url.pathname === '/') throw new AppError(422, 'invalid_url', '请填写具体帖子链接');
  url.hash = '';
  for (const name of ['fbclid', 'mibextid']) url.searchParams.delete(name);
  return url.toString();
}
