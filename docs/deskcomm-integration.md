# DeskcommCRM 集成边界

2026-11-21 通过 GitHub 连接器读取上游 main 实际路由后实现。不是依赖旧 README 猜测端点。没有对上游代码做任何修改。

仓库：https://github.com/melgarafael/DeskcommCRM

## 路由与认证

| 操作 | 路由 | 认证 |
|---|---|---|
| 会话列表 | GET /api/v1/conversations | Bearer 或登录会话 |
| 聊天历史 | GET /api/v1/conversations/{id}/messages | Bearer 或登录会话 |
| 发送文字 | POST /api/v1/messages | Bearer 或登录会话 |
| WhatsApp 列表 | GET /api/v1/channel-sessions | Bearer 或登录会话 |
| 创建连接 | POST /api/v1/channel-sessions | 管理员登录会话 |
| 二维码 | GET /api/v1/channel-sessions/{id}/qr | 登录会话，返回图片二进制 |
| 重连 | POST /api/v1/channel-sessions/{id}/reconnect | 管理员登录会话 |
| 人工接管/暂停 AI | POST /api/v1/conversations/{id}/pause-ai | 登录会话 |
| 交回 AI | POST /api/v1/conversations/{id}/reactivate-bot | 登录会话 |
| 已读 | POST /api/v1/conversations/{id}/mark-read | 登录会话 |

发送文本字段是 body，不是 body_text。创建连接和发消息转发稳定的 Idempotency-Key。失败不自动重发。重连默认 force:false，不自动注销用户的 WhatsApp 登录。

## 上游文件证据

- app/api/v1/channel-sessions/route.ts：列表支持 resolveAuthDual；POST requireRole admin。
- app/api/v1/channel-sessions/[id]/qr/route.ts：loadAuthUser；图片代理；无会话返回 401。
- app/api/v1/channel-sessions/[id]/reconnect/route.ts：管理员与 MFA 校验；软重连/强制重新配对分离。
- app/api/v1/conversations/route.ts、messages/route.ts：Bearer 分支与组织过滤。
- lib/schemas/messaging.ts：body 文本发送字段、UUID 幂等键及长度限制。
- lib/types/messaging.ts：消息 body、direction、sent_at、status。
- lib/inbox/comando-da-conversa.ts：automatico / humano / aguardando 等状态；无已发布 agent 不应显示 AI 接待中。

## 当前限制与下一步

1. 必须先由用户确定部署在本机还是服务器。本机未发现 Docker；没有擅自安装虚拟化组件。
2. 部署上游需要 Supabase（DB/Auth/Storage/Realtime）、WAHA、公开可达或同网的 webhook 与 worker 调度。
3. 配置 agent、模型、刹车片特征库和人工交接规则。当前仅有 29 个未全部人工核验的型号 JSON，不足以宣称覆盖所有型号。
4. 真实扫码需要用户用手机完成；没有制造示例二维码。
5. 列表当前读取最近 100 条，超过时页面明确提示；尚未实现服务器分页。今日统计以已加载集合计算，不代表大型账号全量报表。
6. 当前离线期间表格展示未结束询盘的待办视图；精确离线时间窗口统计尚待连接真实数据后定义。
7. Facebook 公开帖子和评论由本地后端通过 Bright Data 单独采集。Facebook 私信仍待接入。
