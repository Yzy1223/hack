import { AppError } from '../../lib/errors.js';

export interface DeskcommConfig {
  deskcommUrl: string;
  apiToken: string;
  sessionCookie: string;
}
export class DeskcommClient {
  constructor(
    readonly config: DeskcommConfig,
    private transport: typeof fetch = fetch,
  ) {}
  get configured() {
    return Boolean(this.config.deskcommUrl && (this.config.apiToken || this.config.sessionCookie));
  }
  async request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      admin?: boolean;
      key?: string;
      image?: boolean;
    } = {},
  ) {
    if (!this.configured)
      throw new AppError(503, 'crm_not_configured', '尚未部署或配置 DeskcommCRM');
    if (options.admin && !this.config.sessionCookie)
      throw new AppError(409, 'admin_session_required', '此操作需要 DeskcommCRM 管理员登录会话');
    const headers: Record<string, string> = {
      Accept: options.image ? 'image/png' : 'application/json',
    };
    if (options.admin || !this.config.apiToken) headers.Cookie = this.config.sessionCookie;
    else headers.Authorization = 'Bearer ' + this.config.apiToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.key) headers['Idempotency-Key'] = options.key;
    let response: Response;
    try {
      response = await this.transport(this.config.deskcommUrl + path, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
      const reasons: Record<string, string> = {
        ECONNREFUSED: '网络连接被拒绝',
        ECONNRESET: '网络连接被重置',
        ENOTFOUND: '域名解析失败',
        EAI_AGAIN: '域名解析暂时失败',
        ETIMEDOUT: '连接超时',
        UND_ERR_CONNECT_TIMEOUT: '连接超时',
        UND_ERR_SOCKET: '连接意外关闭',
      };
      const reason = error instanceof Error && error.name === 'TimeoutError'
        ? '请求超过 20 秒'
        : typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)
          ? (reasons[code] || '网络错误') + '（' + code + '）'
          : '请求未收到响应';
      throw new AppError(502, 'crm_unreachable', '本地工作台访问 DeskcommCRM 失败：' + reason);
    }
    if (!response.ok) {
      const status = response.status;
      const messages: Record<number, string> = {
        401: 'DeskcommCRM 登录已过期或凭证无效',
        403: 'DeskcommCRM 账号权限不足',
        404: '未找到资源，或二维码尚未生成',
        409: '当前状态不允许此操作，请刷新后重试',
        429: '操作过于频繁，请稍后重试',
        503: 'DeskcommCRM 的 WhatsApp 服务尚未就绪',
      };
      throw new AppError(
        status >= 500 ? 502 : status,
        'crm_' + status,
        messages[status] || 'DeskcommCRM 请求失败，请检查服务状态',
      );
    }
    if (options.image) {
      const mime = response.headers.get('content-type')?.split(';')[0];
      if (mime !== 'image/png' && mime !== 'image/jpeg')
        throw new AppError(502, 'invalid_qr', '二维码响应格式不正确');
      return { mime, bytes: Buffer.from(await response.arrayBuffer()) };
    }
    const result = (await response.json()) as {
      data?: unknown;
      meta?: unknown;
    };
    if (!('data' in result))
      throw new AppError(502, 'invalid_response', 'DeskcommCRM 返回了不兼容的数据格式');
    return result;
  }
}
