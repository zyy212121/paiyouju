# PWA、离线与缓存策略

## 安装

生产 Vite 构建生成 `manifest.webmanifest`、`sw.js` 和 Workbox runtime。Manifest 使用 standalone、项目主题色、180/192/512 原创图标及不透明全幅 maskable SVG。支持浏览器安装提示；iOS 使用 Apple touch icon 和 safe-area viewport。

## 更新

Service Worker 使用 `registerType: prompt`，不自动 activate/reload。发现更新时由页面显示“安全更新”：

- 有活动 Hand 时禁用更新；
- 任一 HTTP/Socket 写命令 pending 时禁用更新；
- 只有安全状态下由用户确认才调用 update/reload。

因此不会在行动、牌桌点数领取/离桌、资料保存或钻石看牌结果不确定时刷新页面。

## 离线和重连

offline 事件显示固定状态条，并从 UI 与 API client 双层禁用所有写操作；Socket legal actions 同时失效。恢复网络后，Socket 使用 2–10 秒带抖动的指数退避重新连接，成功后请求当前 table canonical state；服务端账号级握手窗口继续限制异常重连。资源页按正常 no-store 请求重新获取。客户端不缓存或乐观重放 Poker Action、托管/保位、主动公开、牌桌点数领取、离桌、整手 paid reveal、软归档或模拟补牌。

## 缓存白名单

Service Worker 只预缓存 app shell、构建 JS/CSS、manifest 和项目原创图标；runtime cache 只接受同源且 `destination` 为 font/image/script/style 的公开静态资源。

以下路径明确 network-only/deny：`/api/*`、`/socket.io/*`、`/health`、`/ready`。浏览器 API client 还对每次请求设置 `cache: no-store`，Server 对每个 `/api/*` 响应发送 `Cache-Control: no-store, max-age=0` 与 `Pragma: no-cache`。

本机只持久化非敏感声音偏好 `wepoker.table-sound.enabled`、`wepoker.table-sound.volume` 和 `wepoker.table-sound.voice-gender`。完整/掩码手机号、牌码、房间邀请、历史详情、整手授权和模拟补牌都不写 localStorage/sessionStorage。16 张本地参考图不位于 `public/`，不进入 manifest、precache 或 Docker Build context。

`corepack pnpm test:e2e:pwa` 每次先 fresh production build，再由 Chromium 注册真实 Service Worker，验证 manifest/icon/standalone、离线 app shell，并枚举全部 Cache Storage request URL，确保 Hand Detail、paid reveal、Wallet、其他 API 和 Socket.IO 均未进入缓存。

Step 7 `/admin` 仍属于同一 SPA，生产 Caddy/fastify-static 支持深链刷新；管理 API 一律 network-only/no-store，不进入 precache/runtime cache。公共 WAV 行动/坐站音效作为版本化静态资源进入 PWA precache，事件和牌桌私有数据仍不缓存；其余短提示由 Web Audio 生成。减少动画不静音，后台不播放，初次进入和重连不补播旧事件。
