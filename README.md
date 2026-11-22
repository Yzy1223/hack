# 刹车片询盘工作台

前后端分离的本地工作台。React + TypeScript + Vite 前端，Express + TypeScript 后端，本地 SQLite 保存 Facebook 帖子链接。现有 gushi 型号资料只读接入。

## 启动

Node.js 24。项目目录：D:\\hacksong\\inquiry-workbench。

```powershell
cd D:\hacksong\inquiry-workbench
npm.cmd ci --cache D:\hacksong\.task-tmp\npm-cache
npm.cmd run dev
```

- 前端：http://127.0.0.1:5173/
- 演示：http://127.0.0.1:5173/?demo=1
- 后端：http://127.0.0.1:4310/api/health
- 生产预览：先运行 npm.cmd run build，再运行 npm.cmd start，访问 http://127.0.0.1:4310/。
- 也可以在 PowerShell 执行 .\\scripts\\start.ps1。

## 目录

| 目录 | 职责 |
|---|---|
| frontend/src/app | 应用布局、导航、共享数据状态 |
| frontend/src/pages/dashboard | 今日数据、紧急程度排序、来源与文本筛选 |
| frontend/src/pages/inquiries | 询盘列表、聊天、人工接管、连接二维码 |
| frontend/src/pages/facebook | 帖子链接管理、评论与私信入口 |
| frontend/src/components | 品牌图标、弹窗、状态和空态 |
| frontend/src/styles | 设计变量和公共样式 |
| backend/src/modules/deskcomm | DeskcommCRM 服务端适配器 |
| backend/src/modules/catalog | 本地型号 JSON 只读目录 |
| backend/src/modules/storage | SQLite 持久化 |
| backend/src/modules/demo | 独立演示数据，不访问真实渠道 |
| shared | 前后端共享数据契约 |
| docs | 接口依据、设计约定、验收记录 |

## 已实现与待接入

- 黑白界面：今日数据 / AI 询盘 / Facebook 监控。WhatsApp 和 Facebook 保留品牌色。
- 演示模式：筛选、人工接管、交回 AI、本地演示回复、链接添加和暂停。演示会话是内存数据，后端重启重置；不会向任何客户发送。
- 真实模式：默认空态；真实帖子链接保存在 backend/data/workbench.sqlite，状态为待接入。
- 型号目录：读取 ../gushi 下的 features.json，目前 29 个文件。只按型号检索；不把未复核的 JSON 当成已确认型号。
- Deskcomm 适配：实际路由、二进制二维码、状态轮询、重连、接管、消息读取、带幂等键的发送已编码；尚未针对部署实例联调。
- 未部署 DeskcommCRM / Supabase / WAHA，尚不能真实扫码或自动接客。
- AI 识别与自动接待由后续部署的 Deskcomm agent 承担；尚未配置或训练刹车片识别 Agent，不自动调用此前的第三方模型密钥。

## Deskcomm 配置（部署后）

复制 backend/.env.example 为 backend/.env。DESKCOMM_URL 是 CRM 根地址，不带 /api/v1。只在服务端配置集成令牌。没有 URL 与凭证时返回明确的未配置状态。

当前上游接口并非全都支持 Bearer：
- 列表、历史、发送：集成令牌，至少 mcp:read / mcp:write 及相应组织角色。
- 创建连接、二维码、重连、人工接管、交回 AI、标为已读：登录会话。开发适配器支持服务端 DESKCOMM_SESSION_COOKIE；这是临时联调方式，失效后明确报错。不得放到前端或提交版本库。
- 正式上线前需要确定长期会话刷新/SSO 或受限桥接方案，不能把手工 Cookie 配置视为最终登录方案。

运行环境仅绑定 127.0.0.1；Host 和 Origin 校验用于本地单用户工作台。尚未做工作台自身的多用户登录、RBAC 与公网 TLS，不能直接改为 0.0.0.0 后公开部署。

## 验证

```powershell
npm.cmd run build
npm.cmd test
npm.cmd exec -- prettier --check frontend/src backend/src shared
```

详见 docs/verification.md。代码已使用 Prettier 统一格式。


### 本地 Facebook 演示

打开 `http://127.0.0.1:5173/?demo=1` 并进入 Facebook 监控。预置样例支持离线展开评论、回复和规则识别的询盘线索。添加自己的公开帖子或 Reel 后，选择监控间隔并保存，即开始匿名读取；后台按间隔抓取，读取可见评论和回复，按评论 ID 合并保留。用户添加的链接和间隔保存在 SQLite。Windows 首次安装可从项目根目录运行：

```powershell
py -3.11 -m venv backend/data/facebook-scraper-venv
./backend/data/facebook-scraper-venv/Scripts/python.exe -m pip install -r scripts/facebook-requirements.txt
```

还可用 FACEBOOK_DEMO_PYTHON 指定装有该依赖的 Python 路径。匿名读取受帖子可见性和网络影响。
