import { AppError } from '../../lib/errors.js';
import type { DeskcommConfig } from './client.js';

const limit = 8 * 1024 * 1024;
export async function readPhoto(cfg: DeskcommConfig, id: string, transport: typeof fetch = fetch) {
  if (!cfg.deskcommUrl || (!cfg.apiToken && !cfg.sessionCookie))
    throw new AppError(503, 'crm_not_configured', '尚未配置图片来源');
  const source = new URL('/api/v1/messages/' + encodeURIComponent(id) + '/media', cfg.deskcommUrl);
  const headers: Record<string, string> = cfg.sessionCookie
    ? { Cookie: cfg.sessionCookie }
    : { Authorization: 'Bearer ' + cfg.apiToken };
  const signal = AbortSignal.timeout(20000);
  let response = await transport(source, { headers, redirect: 'manual', signal });
  if (response.status === 302 || response.status === 307) {
    const location = response.headers.get('location');
    if (!location) throw new Error('缺少图片下载地址');
    const target = new URL(location, source);
    const allowed = [source.origin, process.env.DESKCOMM_STORAGE_ORIGIN];
    const hosted = target.protocol === 'https:' && target.hostname.endsWith('.supabase.co');
    if (
      target.username ||
      target.password ||
      (!allowed.includes(target.origin) && !hosted) ||
      !target.pathname.startsWith('/storage/v1/object/sign/whatsapp-media/')
    )
      throw new AppError(502, 'media_origin', '请核对 CRM 私有媒体存储地址');
    await response.body?.cancel();
    response = await transport(target, { redirect: 'error', signal });
  }
  if (!response.ok || !response.body) throw new AppError(502, 'media_unavailable', '原图暂不可读');
  const mime = response.headers.get('content-type')?.split(';')[0].toLowerCase();
  if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime))
    throw new AppError(415, 'media_format', '请提供 JPG、PNG 或 WebP 原图');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError(413, 'media_size', '原图超过 8 MiB');
    }
    chunks.push(part.value);
  }
  const bytes = Buffer.concat(chunks);
  const valid =
    mime === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : mime === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new AppError(415, 'media_invalid', '原图格式无法识别');
  return { mime, bytes };
}
