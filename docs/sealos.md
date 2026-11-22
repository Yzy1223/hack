# Sealos 询盘工作台部署

源项目运行 `python scripts/package-sealos.py` 会生成 workbench-sealos.zip。解压到新目录后，在该目录构建 Linux 镜像。镜像内含刹车片型号和形状摘要，使用自己的私有镜像仓库。

```sh
docker build -t workbench:demo-1 .
docker tag workbench:demo-1 REGISTRY/NAMESPACE/workbench:demo-1
docker push REGISTRY/NAMESPACE/workbench:demo-1
```

把 REGISTRY/NAMESPACE 换成有写入权限、目标节点能拉取的仓库路径，按仓库要求登录。有 Docker 的 Linux 主机或云构建环境都可以构建，镜像架构需匹配目标节点。

| Sealos 应用管理设置 | 值 |
| --- | --- |
| 镜像 | 上一步推送的私有镜像及拉取凭据 |
| 固定实例数 | 1 |
| 工作台初始资源 | 建议 0.5 CPU、512 MiB 内存，视实际使用调整 |
| 服务端口与外网入口 | 4310，启用 HTTPS |
| 持久卷 | /app/backend/data，需允许容器用户 UID 1000 写入 |
| 环境变量 | WORKBENCH_PASSWORD，设置至少 16 字符的独立密码 |
| 健康检查 | HTTP GET /healthz，端口 4310 |

打开分配的 HTTPS 地址并在后面加 /?demo=1。浏览器提示登录时用户名填 demo，密码填部署时配置的值。演示会话和回复在内存中，重启会重置；真实模式保存的 Facebook 链接写入持久卷的 SQLite 文件。登录验证位于前端与 API 之前，此方案用于单人或共享演示账号。

真实 WhatsApp 需要可用的 DeskcommCRM、其依赖的 Supabase、WAHA 与后台任务。CRM 可独立部署，并从后端设置 DESKCOMM_URL、DESKCOMM_API_TOKEN 和管理操作需要的 DESKCOMM_SESSION_COOKIE；Cookie 到期需更新。WAHA 的会话数据单独持久化，确认其运行节点可连 WhatsApp 并完成发图回传。在目标节点检查 CRM 和模型服务的连通性。工作台设置中选择支持图片输入的模型，启用指定测试会话的「工作台 AI」后，使用另一测试号发送旧件原图。聊天记录可展开图片特征及候选，左侧「报价依据」显示目录规格、来源和客户要求。

测试目标为原新加坡工作区。使用原 Sealos 账户查看应用状态和剩余预算。官方说明 https://sealos.run/docs/guides/app-management 。

图片通过 DeskcommCRM 的 /api/v1/messages/{id}/media 读取。自托管存储若与 CRM 域名不同，在工作台后端设置 DESKCOMM_STORAGE_ORIGIN 为 Supabase Storage 的实际 origin。测试时确认原图可见、收到追问，并在人工接管后确认 AI 停止回复。
