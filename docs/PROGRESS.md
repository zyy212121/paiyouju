# 项目进度

## 跨目录运行、服务器文档与仓库拆分（2026-10-14）

- 工作目录为当前游戏检出目录；机器人代码独立为相邻的 `paiyouju-bots` 检出。取消固定磁盘限制，脚本相对于自身位置定位资源，包名统一为 `paiyouju` / `@paiyouju/*`，产品界面与启动面板使用“牌友局”。旧条目中的路径只是当时操作记录，不构成部署要求。
- README 按最新要求仅保留环境依赖、如何运行、如何管理账户；服务器方式采用已经实际启动验证的 Docker Compose，局域网方式采用现有 Windows 启动面板。补充 development.md 并更新 deployment.md、admin-guide.md、备份与 Windows 文档。
- 自动行动客户端、系统协议验收工具、专用启动器与说明迁入独立私有仓库 `paiyouju-bots`；游戏 workspace 和生产构建不依赖该库。保留服务端测试账号协议与扑克核心内部模拟器，维持现有协议和规则验证。真实环境文件、报告、日志与用户未跟踪资产均未纳入提交。
- 开发启动器保留配置中的 CLIENT_ORIGIN，支持相对根目录的显式环境文件。备份默认目录改为相邻 `../paiyouju-backups`，配置相对路径以根目录解析，并修复 `..private` 子目录被误判为外部目录的边界。现有 Compose 项目/卷、数据库与协议标识保持兼容。
- 验证通过：游戏 lint、typecheck、build；完整单测 127 files / 700 tests（规则 164、共享 37、Server 299、Web 200）；完整 PostgreSQL 集成 24 files / 247 tests。机器人 lint、typecheck、30 files / 110 tests 与冻结锁文件安装通过，独立 GitHub CI 通过。Windows 面板校验退出码为 0；Linux 工具镜像的配置及路径专项 18 tests 通过。
- Docker runtime 与 migration 镜像构建成功。运行镜像 UID 1000，可加载更名共享包、Protocol 9，未包含私有客户端。独立随机项目启动 PostgreSQL → 34 条迁移 → App healthy → Caddy；内部 HTTPS `/ready` 成功，登录页标题“牌友局”。生产配置初始账户数为 0，交互命令成功创建隔离测试管理员，登录及管理员用户列表均 HTTP 200。测试结束后仅清理该随机项目及其三个临时卷，未启动公网服务或修改原开发库。
- 失败与修正记录：旧 PWA 测试要求强制覆盖 Origin，与新需求冲突，更新为检查默认配置并补实际配置行为测试。新增开发启动器测试最初的 Windows URL fixture 不合法，已改为由本机路径生成；进程启动测试在高负载下触及 5 秒限时，改为直接调用真实纯函数并保持断言。集成首轮与 Docker 构建并行时 Step 6 migration-upgrade、seed 幂等与 R11 recovery 三项超时；构建结束后完整串行重跑 247 项全通过，未放宽断言或超时设置。
- 容器命令实测修正：生产工具镜像用 pnpm 调用会触发依赖自动安装而权限失败，管理员命令改为直接 `node --import tsx scripts/admin-create.ts`，随后实际创建与登录验证成功。最初镜像验证误用 CommonJS require.resolve 检查 ESM-only 包，改用实际 ESM import 后成功；SPA 页面验证补齐浏览器的 Accept: text/html，随后通过。以上均记录为验证过程，不作为产品失败掩盖。
- 发布方式：游戏公开库 `paiyouju` 使用不含旧机器人历史的干净初始提交；原私有 `wepoker` 库保留历史备份，机器人库保持 private。公开前扫描提交文件，未发现真实本机凭据或私有客户端文件。独立代码复核已处理备份路径边界，无剩余重要发现。
- 边界：未连接真实公网服务器，DNS、公开证书签发和外部网络可达性仍需由部署主机验收。源码与容器启动方案已经验证，不将隔离环境结果声称为公网部署完成。

## GitHub 私有仓库上传（2026-10-13，完成）

- 工作目录 `D:\wepoker`，用户授权创建其 GitHub 私有仓库并上传 `main`，包含主程序和测试机器人。本机 Git 登录已验证为 `zyy212121`，现有分支为 `main`，使用已有 Git 身份；GitHub 插件未连接，改用本机 Git 凭据与 GitHub API。目标 `zyy212121/wepoker` 检查时不存在。
- 保留现有 54 次提交历史，准备提交本次站起/观战修复及回归测试。主程序 `apps/web`、`apps/server`、`packages`，机器人 `tools/system-test-runner`、`start-bots-ui.cmd`、`scripts/start-random-bots*.ps1` 和使用文档均已在跟踪范围。实际运行音频位于已跟踪的 `apps/web/public/audio/table`；根目录 `音效/` 的重复原始素材保留在本地，不另行上传。
- `.gitignore` 排除本地 `.env`、密码、数据库、依赖、构建产物、备份与运行/房间日志；历史环境文件仅包含三个 `.example` 模板。扫描 54 个历史版本无强特征令牌/私钥命中；检查 3566 个历史对象，没有出现本机 8 个实际密码/令牌值。最大历史 blob 约 521 KB。
- 本轮实际执行 `corepack pnpm --filter @wepoker/system-test-runner test`：30 files / 113 tests 全通过；前端 `MobileTableExperience.test.tsx`：23 tests 全通过。此前修复阶段全量 lint/typecheck/unit/integration/build 已验证；上传过程不修改业务或启动代码。远端创建、推送与私有属性/默认分支核验将在完成后记录。
- 已通过 GitHub API 创建 `https://github.com/zyy212121/wepoker`，创建响应与上传后再次查询均为 `private=true`。修复提交 `d950e8707c1ef401bbbb9ed22dd65ffa650913a9` 已执行 `git push -u origin main` 成功，远端默认分支为 `main`，本地/远端提交相同。远端完整树包含 672 个文件，主程序、机器人与启动脚本的 12 项必要文件检查全部存在，没有本地环境文件。最终另提交并上传本条完成记录。
- 上传后局域网运行服务 `/health` 仍返回 200，原根目录启动方式不变。`git diff --cached --check` 通过；没有未解决上传阻断。未跟踪的根目录原始 `音效/` 保持原样，程序实际使用的音频副本已包含在仓库中。

## 确认根目录脚本运行最新源码（2026-10-13，完成）

- 用户确认使用 `start-test-ui.cmd`。检查启动链为 `scripts/start-lan-test-ui.ps1` → `corepack pnpm dev:lan` → `scripts/start-lan-test.ps1` → `scripts/run-lan-child.ps1`；Web 使用当前仓库 Vite 源码，Server 使用 `tsx watch src/index.ts`，无需 Git 提交或 Docker App 镜像重建。
- 检查时 3000/5173 没有监听服务。按相同 LAN 启动脚本打开可操作的 PowerShell 窗口（启动器 PID 39604），保留运行供用户使用；脚本执行既有数据库启动、构建、Migration、Seed 流程，没有执行数据库重置。实际 Web PID 29420、Server PID 47628，2026-10-13 18:51 启动。
- 实测 `http://192.168.1.12:5173/health` 返回 200/status ok；首页及两个修复组件 HTTP 200，包含 `confirmedSquidMessage` 和 `data-view-mode`。CSS 初查普通模块地址因 Vite 返回 JS 转义文本未匹配原始选择器，改查 `table.css?direct` 后确认观战选择器与底部收回规则均存在。
- 通过 Playwright Chromium 打开同一 LAN 地址，跳转 `/login`，HTTP 200、标题与主标题“牌友局”、无页面异常。`start-lan-test-ui.ps1 -ValidateOnly` 返回退出码 0。本次没有修改启动脚本或业务代码；用户刷新原手机页面即可加载当前源码，以后仍使用原根目录启动脚本。

## 站起版本竞争与观战布局修复（2026-10-13，完成）

- 工作目录 `D:\wepoker`。生产改动为 `MobileTableExperience.tsx`、`MobileTableStage.tsx`、`styles/table.css`；新增前端行为测试、浏览器 `stand-spectator.spec.ts`，以及实时协议满六人/满九人回归。更新原始 `TODO-前端问题.txt`，保留复现描述并补根因。
- 根因证据：房间 `342752`（六人鱿鱼）在上海时间 2026-10-13 17:41:08 的 `seat:leave` 使用版本 138，服务端已为 139，返回 `STALE_STATE`；权威回执的本人仍未弃牌且 `ACTIVE`。旧九人鱿鱼房间 `995922` 也存在相同拒绝。失败请求本身没有修改座位或手牌，前端过去仅提示错误并终止离桌意图。
- 共享前端离桌路径在明确版本冲突后检查权威状态所属房间、用户与版本，以新编号/新版本重试最多一次；鱿鱼标记或费用变化时重新确认，退出意图保留。已安排离桌/已释放座位时同步成功状态。断线或响应超时不推断结果、不自动更换编号；手动重试仍复用未知结果操作。服务端 deferred 回执显示“已安排本手结束后站起，期间自动让或弃”，遵守本手后释放座位的既定规则。
- 观战留白由共享 `.table-play-space` 固定为底部操作区预留 13rem 引起：移除底牌内容不会改变布局；375×812 Chromium 实测旧规则仍留 208px。Stage 现在由本人是否仍占座控制 seated/spectator，观战时不挂载 hero/action 容器，并收回竖屏底部、横屏右侧预留。所有模式、2–9 人共享该修复。
- 技术版本：Node 24.16.0、pnpm 11.16.0、TypeScript 6.0.3、React 19.2.8、Vite 8.2.1、Vitest 4.1.10、Playwright 1.62.1、Prisma 7.9.1。验证使用隔离 PostgreSQL 测试库，未修改开发房间数据。
- TDD：18 项初始前端行为断言在旧逻辑上失败；实现后连同超时/断线编号保持、已离桌权威状态等边界共 22 项通过。浏览器 CSS 回归先去掉修复规则确认失败（208px > 20px），再恢复规则。服务端满桌矩阵覆盖四种模式 × 六人/九人，验证未弃牌站起、自动让或弃、结算释放座位、保留 GameSession 与后手；后续增加旧版本明确拒绝且零变更断言。
- 已执行通过：`corepack pnpm lint`、`corepack pnpm typecheck`、`corepack pnpm test`（153 files / 803 tests：Poker 164、Shared 37、Runner 113、Server 289、Web 200）、`corepack pnpm build`（含 PWA），前端专项 23 tests，服务端专项首轮 8 tests。Chromium 浏览器四模式 × 六人/九人八组合已全部通过（每桌两名实际参与者；满六人/满九人由 Socket + PostgreSQL 矩阵验证），含竖屏、横屏和刷新。
- 验证过程中已纠正的测试准备问题：首版服务端测试误用 `folded` 字段、未等待鱿鱼 10 秒开局宽限，并把九人鱿鱼支付额误写成六人的 20 点；确认权威协议后分别改为 `hasFolded`、按模式等待、九人 32 点支付。前端首轮 typecheck 发现 Testing Library 不支持 `getByRole` 的 `exact` 选项，已移除；`role=status` 查询同时匹配隐藏 output 与 toast，已按实际提示定位。初次浏览器启动命令在 Web scope 找不到 `cross-env`，改用 PowerShell 会话环境变量；首轮浏览器 7/8 通过，九人普通测试预设行动者失败，已改为同步远端连接状态并选择实际行动者后重跑。这些失败均未作为产品已通过证据。
- 独立代码复核发现“弹窗仍显示丢失标记，但玩家状态已变为无标记”时重算原始确认条件会错误扩大授权；新增时序测试先复现实际发送两次请求，再改为携带用户实际确认的 message，首次发送前和冲突重试前均核对条件，变化时重新确认且保留退出意图。23 项前端测试转绿，再次独立复核无剩余问题。
- 完整 PostgreSQL 集成首轮为 24 files / 247 tests，246 passed、1 failed：既有 `R6 broadcast fault restores the one settlement committed after Runtime update` 报 `socket has been disconnected`。该测试涉及真实子进程故障注入，本轮服务端生产代码未改；原断言保留，随后单独执行该测试通过。为检查完整运行的稳定性，停止并行构建后串行重跑完整集成；首次失败日志保存在被忽略的 `test-results/stand-integration-run.log`，不得把该首轮描述为全绿。
- 串行完整 PostgreSQL 重跑：24 files / 247 tests 全部通过，包含既有 R6，日志 `test-results/stand-integration-serial-run.log`。随后补强暴击测试为真正的暴击手（每人强制投入 40 点后进入 Flop），满六人/满九人离桌先自动 Check、不追加投入，其他玩家弃牌后正常结算释放座位并保存全部后手；四模式 × 六人/九人八项专项再次通过。该补强首轮误对已开始房间再次请求 table:start 而失败，确认该房间已自动进入开手倒计时后改为等待既有倒计时，未修改生产逻辑或降低业务断言。
- 鱿鱼确认时序修正后，六人/九人 Chromium 两项浏览器复验再次通过；新增真实暴击手测试后重新执行 lint、Server typecheck 与八项 Socket 专项均通过。`git diff --check` 通过。浏览器环境使用既有测试专用 5173/3104，测试进程已退出；没有操作开发房间或开发数据库。
- 主要实际命令：`corepack pnpm lint`、`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build`；Web `vitest run src/features/table/mobile/MobileTableExperience.test.tsx`；Server `cross-env WEPOKER_STANDARD_POSTGRES=1 vitest run --config vitest.integration.config.ts src/realtime/realtime.integration.test.ts -t 'stands an unfolded actor'`；`corepack pnpm --filter @wepoker/server test:integration`（首轮 R6 失败）、`cross-env WEPOKER_STANDARD_POSTGRES=1 vitest run --config vitest.integration.config.ts src/modules/tables/recovery/recovery-process.integration.test.ts -t 'R6 broadcast fault'`（通过）、`cross-env WEPOKER_STANDARD_POSTGRES=1 vitest run --config vitest.integration.config.ts`（完整重跑通过）；PowerShell 设置 `WEPOKER_E2E_ENV_FILE=D:/wepoker/.env.docker.test` 后在 Web scope 执行 `playwright test e2e/stand-spectator.spec.ts --reporter=line`（8 项通过），以及同命令附加 `--grep '鱿鱼'`（最终 2 项通过）。以上省略 package scope 的命令分别由对应 pnpm workspace 执行。
- 当前状态：本次前端修复完成，无待完成项；未创建提交、推送或部署。现有未跟踪音效目录未改动，原有 TODO 内容保留并补充根因和验证记录。

## 无域名临时公网测试入口（2026-09-01）

- 新增完全独立的 `wepoker-public-test` Docker Compose 栈：PostgreSQL 17、一次性 Migration、当前源码 Production Build、Fastify 和仅绑定 `127.0.0.1:18080` 的 Caddy。数据库没有宿主机端口，公网仅通过 Cloudflare Quick Tunnel 的随机 HTTPS/WSS 地址进入，不开放路由器端口，也不复用开发数据库。
- 根目录新增可双击的 `START_PUBLIC_TEST.cmd` 与 `STOP_PUBLIC_TEST.cmd`；PowerShell 同时提供 `public:test:start/status/stop`。启动窗口明确显示并复制手机地址，保持前台可见；既可在该窗口 `Ctrl+C`，也可从另一窗口停止。外部停止标记可让原启动窗口以成功状态退出，不留下无法控制的后台隧道。
- 首次启动自动下载官方 `cloudflared 2026.8.3` Windows AMD64 单文件，并强制校验 SHA-256 `83E726ED18EA78C5AD5213C4C3A3A27051393950D2BC8ED4DE69BEC12D14EAAE`。工具、运行状态和含随机数据库密码的 `.env.public-test` 均被 Git 忽略；停止不删除独立数据库卷，测试账号和记录可跨启动保留。
- 实际进行了两次完整启动。首次在全新独立库顺序应用 34 条 Migration；公网首页与 `/ready` 均返回 200，带精确 Origin 的登录请求到达认证层并返回预期 401，Socket.IO polling 返回 200 且声明 WebSocket upgrade。第二次验证状态查看、另一 PowerShell 停止和前台启动控制器干净退出；最终公网隧道与容器均已关闭，数据卷保留。
- 最终门禁：PowerShell 解析、Compose config、停止状态、Lint、全 Workspace TypeScript、Prisma Validate、Production Build/PWA、全仓 Unit/Component 152 files / 780 tests、标准 PostgreSQL Integration 24 files / 239 tests、34 条 Migration 无待部署项及 `git diff --check` 全部通过。Docker Engine 29.7.2、Compose 5.4.0；既有开发/测试 PostgreSQL 容器未被本轮启停。
- 该能力仅是小范围临时测试入口：随机地址每次启动变化，电脑、Docker、网络和前台启动窗口必须持续运行，Quick Tunnel 不提供固定域名或生产可用性保证。正式上线、备份恢复、监控告警与固定域名部署仍未完成。

## 九人历史记录与遗留恢复错误房间收口（2026-08-31）

- 房间 `606076` 的历史接口失败不是查询参数问题，而是九人桌旁观者可看到 9 名隐藏参赛者，`HandSummary.hiddenOpponentCount` 和整手偷偷看的 `revealedPlayerCount` 却错误限制为最多 8。两个公共契约现均允许 0–9；参与牌局的查看者仍自然最多为 8，九人围观者的第 4 页历史不再被响应校验误报为“请求参数不合法”。
- 遗留房间 `117065` 的第 98 手曾被旧版鱿鱼中途离桌结算破坏：数据库 Seat 后手增加了 20，但活动手 `startingStack` 保持旧值，重启严格校验因此以 `active-hand-seat-accounting` 隔离为 `RECOVERY_ERROR`。当前鱿鱼流程早已改为本手结束后结算；本轮补的是损坏房间的管理员退出通道，而不是放宽快照校验。
- 管理员现在可以对 `RECOVERY_ERROR` 房间执行安全关闭。该路径只在 Snapshot 与 Runtime 都仍为恢复错误时生效：锁定 Room/Snapshot，按数据库现存 `TableSeat.stack` 或 `detachedStack` 关闭活动 GameSession，废止无法验证且未完成的活动手，写入一个空座位 `CLOSED/READY` 快照，再允许使用既有永久删除流程。它不会猜牌、指定赢家、重算损坏底池或修改 Wallet；房主和其他写操作仍被隔离。
- TDD 红灯先稳定复现九人历史 Zod 上限、管理员关闭 `OPEN` 恢复错误房间返回 409，以及已进入 `CLOSING` 后重复关闭仍无法收口；实现后三类回归全部转绿。开发库操作前已创建并校验完整备份 `D:\wepoker-backups\wepoker-20260831T112729283Z.dump`；随后通过正式管理员 API 安全关闭并删除 `117065`，删除 97 条已完成手牌记录，根目录 `音效/` 未改动。
- 管理员永久删除房间会按既定保留策略删除其关联 Wallet 流水，因此合法地留下 sequence 缺口；审计器旧规则把这种缺口及跨缺口余额变化误报为 Wallet 链损坏。新回归先复现该误报，再把检查收紧为“每条自身算术始终正确；只有相邻 sequence 都仍存在时才校验余额连续”，开发库 `WALLET_LEDGER_CHAIN` 恢复 0。审计仍正确保留 362 条旧版底池记录告警，全部来自修复底池规则前的 `669232/562737/296403/589222` 四个房间；本轮没有改写这些历史手牌。
- 最终门禁：Lint 零警告、全 Workspace TypeScript、Prisma Validate、Production Build/PWA、全仓 Unit/Component 152 files / 780 tests、标准 PostgreSQL Integration 24 files / 239 tests、34 条 Migration 无待部署项和 `git diff --check` 全部通过。验证没有手动启动、停止或占用开发 Web/Server 的 3000/5173；仅正在运行的 `tsx watch` 自行加载源码更新。

## 断线临时托管与停发文案收口（2026-08-31）

- 停发状态提示精简为“有效玩家不足，牌局停发”，删除房间计时相关的附加说明；全局检索确认生产 UI 和规则说明不再包含该文案。
- 断线玩家不再被结算流程自动改成 `SIT_OUT`，也不从当前手或后续开手候选中剔除。Seat、后手、底牌和 `ACTIVE` 状态保持不变，普通盲注及特殊模式强制投入照常；轮到断线玩家时服务端立即按临时 `TRUSTEESHIP` 执行 Check，否则 Fold。
- 临时断线托管只由本服务进程实际观察到的“最后一个 Socket 断开”边沿触发，多标签仍有任一连接时不触发；任一 Socket 重新订阅即取消临时标记并重新建立当前权威计时。玩家主动设置的 `trusteeshipEnabled` 独立持久化，不会被重连清除。服务端启动恢复阶段不会凭空把尚未重新订阅的 Seat 判成新断线，因而保留持久化中的原手牌、状态版本和绝对截止时间。
- 开手、首次房主开始、复盘结束续局和前端 `tableRunState/canOwnerStart` 全部按 `ACTIVE/stack>0` 判断，不再把网络 Presence 当作牌局资格；已失效的在线 Session 仍会断开其 Socket，但不会删除牌桌 Seat。断线因此不会造成停发，真实站起、保位、待离桌和后手不足仍按既有规则处理。
- TDD 红灯先覆盖停发旧文案、断线当前行动者未立即让或弃、断线 Seat 被后续手牌与前端资格排除，以及结算时被自动改为暂停；实现后相应 Unit/Integration 转绿。首次直接运行 11 项持久化集成用例因未设置标准 PostgreSQL 测试环境而在数据库清理阶段失败，补齐 `WEPOKER_STANDARD_POSTGRES=1` 后 11/11 通过；首次真实子进程恢复复测误用了未重建的旧 `dist`，重建后恢复进程 13/13、启动恢复 7/7 通过。
- 最终门禁：Lint 零警告、全 Workspace TypeScript、Prisma Validate、Production Build/PWA、全仓 Unit/Component 152 files / 779 tests、标准 PostgreSQL Integration 24 files / 237 tests、34 条 Migration 无待部署项全部通过。验证未启动、停止或接管开发 Web/Server、Docker、机器人，也未占用 3000/5173。

## 盲注配置、暴击倒计时与结算筹码归置（2026-08-31）

- 创建房间不再接收或显示小盲输入。大盲提供默认 20、10/20/30/40/50 五档托条，并允许手动输入大于等于 2 且严格小于初始带入（短牌为后手下限）的整数；服务端统一按 `ceil(大盲 / 2)` 派生小盲，并通过严格请求 Schema 拒绝客户端伪造 `smallBlind`。相关 HTTP、Smoke、E2E 夹具均改用同一外部契约。
- 暴击房间桌面中央新增权威绝对截止倒计时：开桌前显示“等待开桌”，运行中显示 `MM:SS`，到期后显示“下一手暴击”。房间规则说明移除了多余的托管/强制盲注解释句，底层强制盲注规则没有改变。
- 每轮结算新增由主池中心飞向每个实际收款座位的短筹码归置动画。主池、任意边池、多人平分和纯退回筹码都会生成独立飞行动画；同一结算动画批次只播放一次项目所有者提供的 `chipfly.wav`。源文件与正式目标 SHA-256 均为 `0D07F48B8F3AD5709BA164DBE0B817EEFEA4DF5B2C56B5551D286D06B7AC9422`，根目录源素材保持不提交。
- 胜利语义统一为“收到正数筹码”：`POT_AWARDED` 的每名收款人以及正数 `UNCALLED_BET_RETURNED` 的收款人都进入胜利集合，座位胜利态、结算摘要、`YOU WIN` 和本人胜利音效采用同一集合；没有收到筹码的玩家不会被误标为胜利。该兼容分支也覆盖旧日志、恢复数据和合成测试中的纯退回事件。
- TDD 红灯先确认旧创建请求仍要求小盲、暴击倒计时和筹码动画尚不存在、纯退回未进入胜利摘要/胜利音效；实现后目标 Web 4 files / 42 tests 与 Server 2 files / 52 tests 通过。期间 TypeScript 首次暴露 Integration 夹具把外部请求对象直接传给内部服务、第二次暴露可选密码缩窄问题，分别拆分“外部请求/Schema 归一化内部对象”并使用原始必填夹具后通过，没有放宽生产类型。
- 该功能与同批断线语义补强合并后的最终门禁为全仓 Unit/Component 152 files / 779 tests、标准 PostgreSQL Integration 24 files / 237 tests；其余 Lint、TypeScript、Prisma Validate、Production Build/PWA 与 34 条 Migration 检查同样全部通过。

## 特殊模式后端命令长测（2026-08-31）

- 第一轮分别连续测试鱿鱼、短牌和暴击至少 15 分钟，不使用机器人或前端。鱿鱼完成 331,295 手、6,062,027 次动作、8,450,076 次不变量检查及 34 条隔离 Socket/HTTP/PostgreSQL 命令；短牌完成 8,041 手及独立持久层上下限/流水场景；暴击完成 142,046 手、841,578 次接受命令、656,407 次生命周期命令以及 106,534 次快照恢复。三种模式的筹码、底池、边池、强制盲注、托管、站起重坐、幂等、历史和记账检查均未发现已确认产品缺陷。
- 第一轮鱿鱼在 331,295 手中记录到一次不可复现的 `Array.sort` 比较器类型异常，发生于确定性 seed `0x5a17c0de` 的第 269,463 手、9 人 8 层边池结算。完整牌序、19 条动作、底池和派奖已保存；相同输入原样重放 1,000 次全部成功，因此保留为未定位高风险异常，不把它误报为已确认业务 Bug。
- 第二轮在 06:00 硬截止前以 28 个独立 worker 满载复压鱿鱼；Windows CPU 采样 100%，260.004–261.848 秒内完成 578,911 手、13,918,850 次动作和 20,895,303 次不变量检查。测试专用可回退排序探针没有捕获非法比较器，`Array.prototype.sort` 身份也未变化，第一轮异常未复现。探针只存在于 Git 忽略的测试入口，worker 销毁后自动消失，没有修改业务源码。
- 同轮保留单实例短牌、暴击和发两次：短牌完成 240,000 手 Core、1,200 手 HandController 和 30 手持久层场景；暴击完成 184,568 手结算/回放、338,371 次真实托管动作；两者确认产品 Bug 为 0。发两次 852/852 项既有断言通过，新增直接序列覆盖各牌街触发、ONCE/TWICE、唯一剩余牌堆、奇数分池、历史分支和平分，但新增快照恢复夹具及专用持久层幂等未在截止前形成有效证明，继续列为未完成覆盖，不能写成全部通过。
- 第二轮因任务改为 06:00 硬截止时已经不足 10 分钟，实际有效时长分别为鱿鱼约 260 秒、短牌 521.651 秒、发两次 522.045 秒、暴击 545.007 秒；没有伪报时长。全部测试进程均已停止，未启停现有 Web/Server/Docker，未修改 tracked 业务文件。完整报告与复现 JSON 保存在 Git 忽略的 `test-results/manual-mode-soak/`，不得提交。
- 第三轮按 32 个逻辑线程给鱿鱼、短牌、暴击和发两次各分配 8 个 worker，并按每个 worker 的真实起点运行至少 600 秒。鱿鱼完成 534,492 手/12,874,059 动作，短牌完成 640,000 手/4,083,741 动作，暴击完成 334,331 个结算场景，发两次完成 92,820 个直接 case-unit；四组确认产品 Bug 均为 0。鱿鱼排序探针再次零命中。暴击测试昵称前缀超过回放 schema 的 40 字符上限，使本轮回放 round-trip 全部被正确拒绝，故只计底池/筹码/状态验证；发两次主动排除上一轮无效快照夹具，故本轮 `snapshotRecoveries=0`。首次准备命令和 Windows Job 串行创建导致四组没有同秒起跑，但每组实际 worker 数均为 8 且时长没有缩短；结束后确认无残留测试进程。

## 暴击模式与托管强制盲注（2026-08-31）

- 创建房间新增与“发两次”、鱿鱼、短牌互斥的暴击模式。暴击频率固定为 1、5、10、15、20、25、30 分钟，默认 10 分钟；1 分钟作为快速测试档，暴击盲注为 1–10 BB 整数档。Web、HTTP schema、服务层和 PostgreSQL CHECK 同时约束，6 分钟等非档位配置不能绕过界面写入。
- 牌桌首次正式开始时持久化绝对暴击截止；暂停、人数不足、站起和重连不暂停或重置。到期后的下一手实际开始时，全体参赛者（含原大小盲）各自投入 `min(后手, 暴击倍数 × BB)`，不叠加普通盲注，随后直接发 Flop；该开手同时写入下一绝对截止。短后手按强制 All-in 进入既有任意边池和零和结算。
- 常驻托管与一次性“让或弃”只处理可选择行动。普通 Small/Big Blind 和暴击盲注都在托管判断前强制提交；PostgreSQL Realtime 回归分别锁定托管玩家仍支付普通盲注和暴击全员盲注。
- Room、Protocol v9、Snapshot v6、恢复、备份、管理员诊断、完成历史和逐行动回放均携带暴击权威字段。历史冻结实际暴击盲注，并为每名参赛者生成强制投入后从 Flop 开始的回放；机器人沿用服务器 legal actions 自适应 Flop/Turn/River，不发送发两次或客户端盲注命令。
- TDD 红灯先后确认 Poker Core 尚未强制全员投入、Room schema 尚未识别暴击参数、创建页没有模式控件、调度模块不存在，随后实现转绿。本轮没有新增或下载图片、字体或音效，不需要占位素材。
- 新增普通盲注托管集成回归首次把首位行动者设为托管；开手后该玩家按既定“让或弃”立即 Fold，手牌已正常结束，测试却错误读取 `currentHand` 而失败。夹具改为让尚未轮到的 Big Blind 托管后，可直接验证 10/20 两笔普通盲注已经提交；没有修改业务逻辑掩盖这次失败。
- 最终独立测试库重建后的首轮 Integration 在 Server build 阶段停止：共享频率白名单函数被声明成字面量 type predicate，使数据库 Room 的通用 `number` 无法赋给 Realtime 的七值联合类型。保留相同运行时白名单并把函数返回改为普通 boolean 后，边界仍严格拒绝非法档位，同时 Runtime/Prisma 类型重新一致；修复后第一次直接重跑仍读取到未重建的 Shared `dist` 旧声明，按仓库标准先重建 Workspace packages 后同一命令通过。
- 最终门禁：全 Workspace TypeScript、Lint、全仓 Unit/Component 152 files / 766 tests、Prisma Validate、Production Build/PWA、34 条 Migration 的独立测试库从空 Schema 顺序部署、标准 PostgreSQL Integration 24 files / 235 tests，以及 `git diff --check` 全部通过。验证没有启动、停止或接管 Web、Server、Docker、机器人，也没有占用 3000/5173；只读取已健康运行的 Docker 状态并写独立 `wepoker_test`。

## 鱿鱼局开手卡死与过期房间座位隔离（2026-08-31）

- 管理员房间 `729786` 的完整日志显示，牌局并非卡在鱿鱼结算或发牌状态机：13 次失败命令均为可恢复的 `STALE_STATE`，真正阻塞开手的是反复出现的 `HAND_START_GATE / ACCOUNTING_REJECTED / TABLE_NOT_AVAILABLE`。开发库只读核对进一步定位到已过期约 3 小时、但因历史故障停在 `RECOVERY_ERROR` 的旧鱿鱼房间 `117065`；该房间仍以数据库 `OPEN` 状态保留两个机器人 `ACTIVE` 座位，旧记账门槛把这些残留座位误判成仍在另一张有效牌桌活动，导致新房间候选阵容只要包含对应机器人便取消开手。
- 开手记账现在只把“未过期且 `OPEN`”或正在安全收尾的 `CLOSING` 房间视为跨桌冲突；已过期的 `OPEN/RECOVERY_ERROR` 残留座位不再阻塞健康房间。入座路径同步增加同账号行锁和同一规则的前置检查：活跃房间间仍禁止重复入座，并发抢占两张桌时只允许一个事务成功，不会把冲突延迟到整桌开手阶段才暴露。
- TDD 红灯分别稳定复现了“过期旧房间阻塞新手牌”“同账号可以进入第二张活跃桌”和“并发入座同时成功”三类问题，修复后牌桌记账 Integration 26/26 通过。完整 Integration 首轮发现入座路径额外使用真实系统时间拒绝目标房间，会与房间启动前计时语义及 Realtime 假时钟冲突，造成 3 项既有场景失败；移除这项过宽判断后，定向 3/3 和最终标准 PostgreSQL Integration 24 files / 231 tests 全部通过。
- 最终门禁：Lint、全 Workspace TypeScript、全仓 Unit/Component 151 files / 756 tests、Production Build/PWA、标准 PostgreSQL Integration 与 `git diff --check` 全部通过。检查只读访问既有开发数据；隔离 Integration 仅写入 `wepoker_test`，没有启动、停止或接管 Web、Server、Docker、机器人，也没有占用 3000/5173。
- 本节完成时，已损坏的历史房间 `117065` 仍保持原样，没有对账务做猜测性修补；其后已按本文顶部“九人历史记录与遗留恢复错误房间收口”所述，在完整备份后通过新增安全关闭通道删除。现有日志与数据库证据已把原因唯一定位，因此没有临时占用 3–5 号探针，三个探针槽继续空置，后续仍可用于无法由现有日志定位的新问题。

## 发手牌、公共牌、三秒倒计时与鱿鱼新轮采样（2026-08-31）

- 项目所有者新增的 `fashoupai.wav`、`fapai.wav`、`daojishi.wav`、`youyu.wav` 已复制到正式牌桌 SFX 目录并替换对应的合成音触发。`fashoupai` 在新 Hand 的整段底牌飞行动画开始时播放一次；`fapai` 随 Flop/Turn/River 的每个可见展示阶段播放，发两次也按两副 Board 的实际展示阶段触发。
- 最后 3 秒提示现直接由本人行动倒计时驱动：只在当前登录玩家是 Actor 时，于 3、2、1 三个整数秒各播放一次 `daojishi`，100ms UI 刷新、React 重渲染和同一 deadline 不会重复触发；加时产生的新 deadline 可在之后再次正常进入三秒提示。`youyu` 只在新一轮鱿鱼 10 秒无惩罚站起窗口开始时播放一次。
- 四个源/目标 WAV 均通过 RIFF/WAVE 长度与 SHA-256 精确复制校验；持续时间分别约为 0.84、0.24、1.02、5.91 秒。PWA 构建继续预缓存全部 WAV。最终门禁：定向音效/倒计时 2 files / 15 tests、全仓 Unit/Component 151 files / 756 tests、Lint、全 Workspace TypeScript、Production Build/PWA 与 `git diff --check` 全部通过。
- 本轮没有启动、停止或接管 Web、Server、Docker、机器人进程，也没有占用或清理 3000/5173。根目录 `音效/` 源文件继续原样保留且不提交，复制到正式 Web SFX 目录的四个目标文件纳入版本管理。

## 统一应用弹窗、原创头像库与鱿鱼中途离桌一致性（2026-08-31）

- 牌桌房主关闭、普通/鱿鱼离桌以及管理后台的钻石调整、数据删除、房间操作和恢复操作全部改用同一套应用内 `UiDialog`。弹窗支持遮罩、Esc/背景关闭、忙碌态、危险态、原因输入和“永久删除”精确确认；Web 源码不再调用浏览器原生 `alert/confirm/prompt`。PWA 安装保留标准 `BeforeInstallPromptEvent.prompt()`，它是浏览器安装权限流程而不是业务确认框。
- 新增 16 个项目原创卡通头像组成的 4×4 WebP 精灵图。注册由服务端密码学随机选择头像；第 32 条 append-only Migration 为旧账户确定性回填并加数据库白名单约束；个人资料可从固定头像库切换昵称/头像，不接受 URL、Base64 或文件上传。本人、其他座位、Session、Realtime、Snapshot 和重启恢复共用同一 `avatarId`，在线改头像会在单桌队列中即时刷新。PWA 预缓存已加入 WebP。
- 项目所有者提供的 10 个新男女动作 WAV 已按文件名替换 call/raise/check/fold/all-in；新增 `win.wav` 作为仅本人可听的派奖音效。触发条件直接读取逐池 `winnerUserIds`，主池、边池、多人平分和发两次任一分支均覆盖，即使该玩家整手净结果为负也不会漏播；不在赢家集合中的玩家不会播放该胜利采样。所有源/目标文件通过 RIFF/WAVE 长度和 SHA-256 精确复制校验。
- 六份管理员日志复核中，`495453` 短牌长测完整结束 161 手，牌范围、唯一牌、底池和后手守恒均未发现异常；三个仅含最终 CLOSED Snapshot 的旧日志与一个仅含 9 个 Snapshot 的日志只能确认最终状态健康，不能反推完整动作过程。`117065` 鱿鱼长测在第 98 手复现真实故障：未参与当前手的第三名玩家确认惩罚离桌时，旧逻辑立即修改了仍在打牌玩家的数据库后手，随后 Hand 持久化发现开局值不一致而进入 `PERSISTENCE_ERROR/RECOVERY_ERROR`。
- 鱿鱼修复把“本手进行中、仍属于本轮且需承担离桌惩罚”的玩家统一视为延迟离桌，不再中途结算或改写 Hand Player 后手；本手安全完成后再执行鱿鱼账本和离桌。三名真实 Socket、PostgreSQL 与假时钟回归明确验证：离桌先返回 `LEAVE_AFTER_HAND`、本手中账本为 0、开局后手不变、随后弃牌可完成持久化且只结算一次。已经损坏的历史房间 `117065` 没有做不安全的猜测修复，后续在完整备份后废止未完成手牌并删除，详见本文顶部最新记录。
- 最终门禁：Lint 零警告、全 Workspace TypeScript、Prisma Validate、Production Build/PWA、全仓 Unit/Component 151 files / 755 tests、标准 PostgreSQL Integration 24 files / 228 tests、历史 Migration 升级 7/7、`git diff --check` 全部通过。完整 Integration 首轮只有迁移数量断言仍写死 31 导致 7 项失败，更新为当前 32 后定向与完整组均通过。
- 本轮没有启动、停止或接管 Web、Server、Docker、机器人进程，也没有占用或清理 3000/5173。头像为内置图像生成后本地优化的正式项目资产，没有下载失败和占位素材；根目录 `音效/` 源文件保持原样且不纳入提交，其复制到正式 Web 音频目录的目标文件纳入版本管理。

## 全模式历史隐私、All-in 展示与桌面状态一致性（2026-08-30）

- 历史牌局不再把现场主动亮牌当成公共授权：未进入 Showdown/All-in 且当前查看者未购买偷偷看时，两张牌始终投影为牌背。历史中移除“◉ 主动公开”和行动后的“（自动）”；完整可见的两张牌新增按标准/短牌规则及发两次分支 Board 确定计算的牌型，隐藏牌不返回牌型。
- 整手“偷偷看”改为单击即提交幂等扣费并刷新牌面，不再出现确认页；本地或服务端判定钻石不足时才弹余额不足。主动亮过的牌仍属于历史隐藏牌，可被整手授权安全展开；参与者与房间围观者沿用相同成员权限。
- 任意 Bet、Raise 或 Call 只要精确耗尽剩余后手，领域事件和持久动作均统一为 All-in，座位状态与男/女真人语音不会再误用下注、加注或跟注。Hero 姓名栏现与其他座位一致，显示本街最新动作；中央底池文案压缩为“主/边”。
- All-in 自动补牌保留服务端原子持久结算，同时新增客户端结算展示投影和可选的 `committedThisHand` Realtime 字段。Flop/Turn/River 未全部翻完前，后手保持派奖前数值，并隐藏赢家、最终牌型、派奖事件、结算框及鱿鱼新轮提示；最后一张牌展示后一次切换到权威结果。Protocol 仍为 v8，无数据库或 Snapshot 迁移。
- 聊天气泡改为 Store 级绝对生命周期：发送时未坐下只进入聊天记录，之后坐下不补播；发送后站起、换座或气泡自然到期都会从头像旁移除，不再因组件重新挂载而反复出现。
- 回归与门禁全部通过：全仓 Unit/Component 149 files / 747 tests；标准 PostgreSQL Integration 24 files / 225 tests，其中历史隐私定向 Integration 25/25；Lint、全 Workspace TypeScript、Prisma Validate、Production Build/PWA 与 `git diff --check` 全部成功。31 条 Migration 均已应用且无新增 Migration。
- 本轮没有启动、停止或接管 Web、Server、Docker、机器人进程，也没有占用或清理 3000/5173；仅连接既有 `wepoker_test` PostgreSQL 执行隔离集成测试。没有新增图片、音效或占位素材。

## 短牌模式（2026-08-30）

- 创建房间新增与“发两次”、鱿鱼互斥的短牌模式。短牌不显示普通初始带入，改用后手下限/上限两个分档托条，默认 500/2000；服务端把兼容 `initialBuyIn` 固定为下限，并在输入、服务和数据库约束层强制特殊模式关闭发两次。左上菜单现为发两次、鱿鱼和短牌分别显示当前规则说明，纯普通局仍禁用该按钮。
- Poker Core 新增显式 `STANDARD/SHORT_DECK` 变体：短牌使用 6–A 共 36 张唯一牌，A-6-7-8-9 为 9 高顺子，同花大于葫芦且顺子仍大于三条。牌组生成、最佳五张、胜者比较、底池结算、牌数/范围不变量和服务端密码学洗牌均按变体执行；未带变体的旧调用继续使用标准 52 张规则。
- 每手先保存真实零和 Poker 结果，再在同一完成事务中把未离桌参与者后手规范到短牌上下限：低于下限写 Hand 关联 BUY_IN 并增加 `totalBuyIn`，高于上限写 Hand 关联 CASH_OUT 并增加 `totalCashOut`。活动历史按 `当前后手 + totalCashOut - totalBuyIn` 计算，最终关闭把剩余后手追加到既有带出，避免覆盖逐手退点；人工补点和随机机器人均不能越过上限。
- Realtime 升级为 Protocol v8，TableSnapshot 升级为 v5；v1–v4 健康快照和 Protocol v5/v6/v7 备份清单继续兼容。第 29–31 条 append-only Migration 增加房间枚举、模式/上下限约束及 Hand 关联补退点流水约束；开发库和测试库均已原地部署，没有清空或重置用户、房间和牌局数据。
- 机器人识别短牌模式，首次/重坐使用后手下限，随机补点只使用到上限的剩余容量，不会发送发两次命令。短牌规则依据和服务器/记账边界记录在 `docs/short-deck-rules.md`，没有新增图片、音效或占位素材。
- 最终门禁：Lint 零警告、全 Workspace TypeScript、Prisma Validate、Production Build/PWA、全仓 Unit/Component 148 files / 738 tests、标准 PostgreSQL Integration 24 files / 225 tests、`git diff --check` 全部通过。定向 Snapshot/Deck 11/11、房间/完成手 Integration 27/27、迁移升级 7/7 通过。
- 真实失败均已修复并复验：新增结算测试首次缺少 `closeRequestedAt` 而触发数据库关闭时间约束；短牌结算测试的底牌夹具首次被推断为不定长数组；Snapshot hydrate 首次显式携带 `variant: undefined` 被严格可选属性拒绝；完整 Integration 首轮仍把 Migration 总数写死为 28，导致迁移升级 7 项失败。修正后对应目标测试及完整门禁均通过。
- 本轮没有启动、停止或接管 Web、Server、Docker、机器人进程，也没有占用或清理 3000/5173 端口。

## 创建房间 500 与 LAN 启动数据库客户端同步修复（2026-08-30）

- 鱿鱼/发两次开发分支快进到 `D:\wepoker\main` 后，开发数据库已应用 28 条 Migration，但 `apps/server/src/generated/prisma` 仍停留在旧 Schema。创建房间公共事务始终写入 `specialMode`、`runItTwiceEnabled` 等新字段，因此普通、鱿鱼和发两次三种房间都会由旧 Prisma Client 拒绝并返回服务器内部错误。
- 已对当前开发环境执行 Prisma Client 重新生成；正在运行的 `tsx watch` 自动重启 Server，`/health` 恢复正常。数据库 Migration 状态核对为 28/28、Schema up to date，没有重置或删除用户、房间及牌局数据。
- `dev:lan` 现在固定在开发库迁移之后、Seed 之前运行 `db:generate`，以后每次启动都会让运行时客户端与仓库 Schema 同步。System Test Runner 增加启动顺序回归，防止该步骤再次被遗漏。
- 本次未下载或新增媒体素材；没有启动、关闭或接管用户的 Web/Server/Docker 进程。

## 随机机器人按房间模式覆盖同步（2026-08-30）

- 机器人现在只在 `NORMAL + runItTwiceEnabled` 房间响应双人 All-in 协商；两名有资格者各自随机提交 `ONCE/TWICE`，投票优先于等待、重连和座位生命周期动作。鱿鱼房间即使收到异常投影也不会误发该命令。
- 鱿鱼站起按权威状态明确区分已标记惩罚、未标记惩罚、非参与者免罚与新轮10秒免罚。惩罚分支携带确认字段，免罚分支不携带；机器人仍不发送鱿鱼模式禁止的暂停参与或保位离桌。
- 为避免5–8分钟生命周期冷却使10秒窗口永远测不到，每个新鱿鱼轮次只由第一个机器人执行至多一次定向免罚站起；其他机器人不会同时被强制离桌，普通随机站起频率不变。报告新增房间模式、发两次开关以及 `runout-choice:*`、`squid-leave:*` 分支计数，能够和管理员房间 NDJSON 对照。
- 本轮只修改 `tools/system-test-runner` 与文档，没有启动/停止 Server、Web、Docker 或机器人，也没有占用 3000/5173；未新增媒体素材或占位素材。
- TDD 首轮按预期出现3条模式策略失败和2条命令/报告失败，实现后目标20/20通过。最终全仓 Unit/Component 145 files / 715 tests、相关 PostgreSQL Realtime/鱿鱼记账 Integration 2 files / 65 tests、Lint、全 Workspace TypeScript、Prisma Validate、Production Build/PWA 与 `git diff --check` 全部通过。

## 普通模式“发两次”与本人离桌状态修复（2026-08-30）

- 创建房间的 “All-in 后发两次” 已从占位升级为普通模式真实选项；鱿鱼及任何特殊模式在 Web、输入规范化、服务层和数据库 CHECK 四层强制关闭。本人处于 `LEAVE_AFTER_HAND` 时菜单不再显示不可执行的保位离桌；Hero 继续用黑色“站”、灰度弃牌、状态文字和参与中牌面表达本人权威状态。
- 双人 All-in 且没有后续合法下注时进入服务器权威 5 秒协商。只有两人都选择 `TWICE` 才立即发两次；任一 `ONCE`、未响应或超时均等待完整截止后发一次。选择命令带 operation ID/stateVersion，可修改、可幂等重放；对手具体选择不向客户端泄漏，围观者只能查看进度。
- 两副 Board 复用已经公开的前缀，从同一剩余唯一牌堆先完成第一副再完成第二副。每个底池独立拆分，第一副 `ceil(amount/2)`、第二副取余数；两副分别评牌、平分和处理奇数筹码，再合并为唯一真实最终后手。短小盲 All-in 且大盲无需补注会直接进入协商，不会留下无动作 Actor。
- 中央桌面增加 5 秒协商层与 320px 可容纳的双排紧凑五张牌 UI；Flop、Turn、River 逐街停顿，第一副结果出现后再发第二副，参与者分别看到 `YOU WIN/LOSE/PUSH`。物理新增牌数单独驱动两副公共牌提示音，重连到完成手不会补播整段动画或声音。
- Realtime 升级为 Protocol v7，TableSnapshot 升级为 v4；投票 deadline/选择、两副牌面和逐副结算均可恢复。第 28 条 append-only Migration 新增 Room 开关、投票幂等 scope、`HandRecord.runoutCount/runoutVotes`、`HandRunoutRecord` 与逐副 Pot；房间删除、30 天保留清理、测试清理和数据审计均覆盖新关系。
- 历史把同一权威 Hand 展开为 `<手数>-1`、`<手数>-2`，分别显示本副牌面、赢家、行动、投入、底池和净结果；所有金额按第一副向上取整、第二副取余数。偷偷看授权覆盖两个分支，发两次不提供发发看；分支详情不伪造不完整的合并 Replay。
- 协议升级审查发现旧 v6 备份清单会被误拒绝，已补为 v5/v6/v7 全部可验证；新备份写 v7。素材全部复用项目原创 React/CSS 卡牌和 Web Audio，没有外部下载、缺失素材或占位图。
- 收尾审查发现随机机器人仍把服务协议写死为 v6 且不会响应新协商；已同步到 Protocol v7，并让两名有资格的机器人优先各随机提交一次 `ONCE/TWICE`，从而可在管理员房间长测真正覆盖单次与双次分支。
- 最终门禁：全仓 Unit/Component 145 files / 711 tests、标准 PostgreSQL Integration 24 files / 223 tests、Lint 零警告、全 Workspace TypeScript、Prisma Validate、Production Build/PWA 全部通过。真实 Socket + PostgreSQL 已覆盖两票、幂等重放、两副唯一牌面及逐副底池；旧 Step 3/4/5/6/6.5/7 数据升级到 28 条 Migration 全通过。开发只在 `D:\wepoker-squid-dev` 和隔离 `wepoker_test` 数据库执行，没有启动/停止 Server、Web、机器人或占用 3000/5173。

## 鱿鱼模式、常驻托管与本人状态一致性（2026-08-30）

- 创建房间的原“低水保险”占位已替换为鱿鱼模式。开启后按 Initial Buy-in 的 `ceil(1/100)` 生成 1–5 倍五档人均结算额；唯一赢得主池的玩家获得鱿鱼标记，平分主池和边池赢家不授予标记。
- 每手结算后检查本轮参与者：仅剩一名无标记者时，该玩家向其余本轮参与者逐人支付固定额；不足部分自动补点并计入本桌战绩，随后全员清标记、进入新一轮。新轮开始前有 10 秒提示期，期间可以无惩罚站起；正常输光在鱿鱼模式下自动补到 Initial Buy-in，不自动站起。
- 鱿鱼局禁止保位离桌。非提示期站起时，未标记者须确认并立即结算本轮；已标记者须确认放弃本轮收款资格。普通中途加入者以无标记状态参加当前轮；若已有未标记者确认离开并冻结了本轮付款/收款集合，之后才加入者不追溯获标或收款。空闲阶段已有标记者离开后若只剩一名无标记者，也会立即完成结算，防止轮次永久卡住。
- 新增持久“托管 · 让或弃”：任意模式和任意时点可从左上菜单开启/取消；成为行动者后只 Check，否则 Fold，盲注等强制投入不受影响。状态进入 PostgreSQL Seat、Snapshot 与 Protocol v6；重连/重启继续生效，手工行动被隐藏以避免与托管竞争。
- 桌面增加原创鱿鱼标记、轮次提示动画与 Web Audio 提示音，菜单增加当前模式规则。本人 Hero 头像现在与他人座位共用权威状态映射：站起为黑色“站”，弃牌为灰度，保位/本手后离桌有明确状态；双视角组件测试锁定这一修复。
- Realtime 升级为 Protocol v6，TableSnapshot 升级为 v3；健康 v2/v1 仍按保守默认恢复。新增第 26–27 条 append-only Migration，并为鱿鱼结算增加账本唯一保护、零和数据审计及恢复/幂等覆盖。随机机器人同步 v6，可低频切换常驻托管，并在鱿鱼局避开被禁止的保位/暂停参与操作。
- 本轮没有下载素材；鱿鱼图标、动画和提示音均由项目代码原创生成。开发和验证只在 `D:\wepoker-squid-dev` 与独立 `wepoker_test` 数据库进行，没有启动/停止 `D:\wepoker` 的 Server、Web、Docker、机器人或占用 3000/5173 端口。
- 最终门禁全部通过：Lint 零警告、`git diff --check`、全 Workspace TypeScript、Production Build、Unit/Component 142 files / 690 tests、标准 PostgreSQL Integration 24 files / 221 tests、Prisma Validate。鱿鱼离桌错误码、持久托管、Snapshot 升级、结算零和及本人站起/弃牌/保位视觉状态均有回归覆盖。

## 可视化测试/机器人启动面板与1号日志总开关（2026-08-30）

- 根目录新增 `start-test-ui.cmd` 与 `start-bots-ui.cmd` 两个双击入口。测试面板提供1–5号独立勾选项：1号控制管理员房间完整文件 Log，2号控制现有连接/订阅/Session/状态同步/开手门槛动态探针，3–5号可勾选但保持空置且不传递任何设置。
- 1号总开关关闭后，管理员房间的 Snapshot、Command、Connection Probe 全部返回 no-op，且不查询房间元数据；普通用户房间继续无条件拒绝写入。2号关闭只停动态探针。两项均只在新 Server 启动时生效，测试面板会拒绝复用旧 Server，防止界面选择与实际运行配置不一致。
- 机器人面板限制数量为 1–9，强制六位房间号，房间密码可留空且非空时验证 4–64 字符。密码仅通过创建子进程时继承的环境传递，随后恢复父进程环境并清空输入框，不进入命令行；启动窗口保持可见，可由用户按 `Ctrl+C` 正常停止。
- 两个 UTF-8 BOM WinForms 脚本均通过不弹窗、不启动服务的 `ValidateOnly` 初始化检查；3–5号探针没有后端字段、环境变量或隐藏行为。最终 Lint 零警告、`git diff --check`、全 workspace TypeScript、Production Build、Unit/Component 139 files / 664 tests 全部通过。本轮未启动 Docker、Server、Web、机器人或占用运行端口；完整文件清单及独立 `git revert` 路径记录在 `change-log/2026-08-30-visual-test-launchers.md`。

## 可回退的机器人连接与开手门槛探针（2026-08-29）

- 为定位“机器人已落座但多次 5 秒倒计时结束仍回到 IDLE”的连接/订阅问题，管理员房间 NDJSON 增加 schema 1 的 `CONNECTION_PROBE`。固定事件覆盖 Socket 订阅、只读 state 重同步、断线原因、Session 失效位置、倒计时排程和最终开手门槛；`HAND_START_GATE.reason` 可区分 eligible 不足、认证后参与者不足、账务拒绝、暂停/关闭/过期、恢复/持久化状态和提交失败。
- 开手探针同时记录座位、Runtime Presence、eligible、prepared/retained candidate 的数量与 userId 集合、presenceVersion、stateVersion 和 deadline，不记录牌或命令正文。写入通过既有管理员房间队列异步执行，任何异常都被隔离，不等待、不改变 stateVersion，也不影响开手结果。
- 随机机器人 JSON 报告增加最多 64 项的连接/断线/订阅时间线、最后收到权威状态的时间/version/runtimeStatus、本人座位 connected 投影、重同步及意外断线计数。报告不包含 Cookie、Session、密码、手机号或牌值，可与服务器 NDJSON 按时间、roomId/userId/stateVersion 交叉核对。
- `ADMIN_ROOM_CONNECTION_PROBES_ENABLED` 在 development/test 默认开启、production 默认关闭，可显式覆盖；设为 `false` 只关闭探针，不关闭既有管理员 `SNAPSHOT/COMMAND`。严格变更编号 `WP-PROBE-20260829-01` 记录了基线 `80f3e6c`、固定 schema、文件清单、运行时停用和独立 `git revert` 两条回退路径。
- TDD 红灯先捕获 5 个 Server 失败和 1 个 System Runner 缺失模块；回归测试进一步锁定了“认证参与者不足取消本次开手，但 Presence 仍满足条件而立即再次排程”的现有链路。最终 Lint 零警告、`git diff --check`、全 workspace TypeScript、Production Build、Unit/Component 138 files / 660 tests 全部通过，其中 Server 35 files / 235 tests、System Runner 29 files / 103 tests。本轮未启动/停止 `dev:lan`、机器人、Docker 或 3000/5173 端口。

## 全部已投入点数入池与退款语义纠正（2026-08-29）

- 产品规则已按最终确认改为：所有已经提交的点数都通过 Pot Award 结算，新完成手不产生未匹配退款。两人 10/20 盲注中小盲投入 10 后弃牌时，相同获胜资格层合并为一个 30 主池，大盲获得 30；All-in 结算若最高层只有一名未弃牌贡献者，则保存为只由该玩家获胜的锁定末层池。此前进度中“退回未匹配最高投入”的规则由本节取代。
- `buildPots` 不再把单人最高层写入 `uncalledReturnsByPlayer`；结算最终后手只由剩余后手与 Pot Award 构成。整手不变量和 1,000 轮属性检查现在强制 `sum(pots) = sum(committed)` 且退款映射为空；10/20 正常弃牌、100/100/300 深度、九种不同投入层和真实五人奇数筹码牌局均有回归测试。
- 持久化继续逐池写入 `HandPotRecord`，现可记录单人贡献/单人获胜的锁定末层池。历史回放的新结构强制全部投入入池；只读兼容分支仍能打开修复前的旧式退款记录，不修改其后手。Hand Detail 已移除“未匹配退回”展示；数据审计则严格要求 Pot 总额等于玩家总投入、每名玩家的 `netResult + committed` 等于全部 Award，旧式退款记录会被报告为异常。
- TDD 红灯先稳定捕获 4 个 Poker Core 失败及 1 个历史兼容失败。最终 Lint 零警告、`git diff --check`、全 workspace TypeScript、Production Build、Unit/Component 137 files / 655 tests 全部通过；固定 seed `20260829` 的 10,000 手牌模拟完成 10,000、失败 0、不变量失败 0、原生进程重试 0，覆盖 7,422 手边池和 2,229 手 Short All-in。
- 本轮没有启动/停止 `dev:lan`、机器人、Docker 或 3000/5173 端口。检查时 55432/55433 均未监听，因此没有接管用户环境启动 PostgreSQL Integration；相关数据库集成夹具和审计断言已同步，等待既有测试数据库可用时执行。

## 底池规范化、实时投影与奇数筹码修复（2026-08-29；退款部分已由上节取代）

- 管理员长测房间 `296403` 的 191 手投影/结算审查确认：开局 10/20 盲注被实时 UI 错显为 20；624 个活动状态没有显示全部已投入筹码；128 手曾在没有 All-in 时显示临时边池；44 个没有 All-in 的完成手被持久化为多个原始层。190 个已完成手仍保持总筹码守恒，但原始层对同一批并列赢家分别取整，存在真实的单数筹码错配风险。
- 根因分为两处：活动牌桌错误复用最终 `buildPots`，把最高未匹配投入在行动尚未结束时提前当成退款；最终结算又按每个不同投入深度保留原始切片，即使相邻切片的 `eligiblePlayers` 完全相同也不合并。现在活动投影始终显示所有已投入筹码，且只有 All-in 累计投入形成资格上限时才显示边池；最终结算先合并相同资格集合，再统一评牌和分配奇数筹码。
- 真实行动回归构造了五人牌局：三名玩家共享皇家同花顺，原实现把应合并的 102 点拆成 5、4、93，导致一枚筹码从 `p0` 错给 `p3`；当时实现规范化为 102 与 20 两个池并退回 11。上节最终规则现将该 11 改为只由 `p4` 获得的锁定末层池，因此完整结构为 102、20、11，所有投入都由 Pot Award 结算。
- 快捷底池加注继续使用“跟注后底池”计算；实时底池修复后 10/20 开局不再系统性低估所有快捷金额。精确滑杆的 `x Pot` 文案改为 Raise 增量除以跟注后底池，不再把 `raiseTo` 总值直接除以旧底池。历史回放验证接受新规范化记录，同时兼容修复前已持久化的原始分层；旧牌局保持当时结果，不静默改写玩家后手。
- TDD 红灯实际捕获 6 个 Poker Core 失败、2 个 Server 失败和 1 个 Web 失败；修复后定向 Core 20/20、Server 24/24、Web 5/5。最终 Lint 零警告、`git diff --check`、全 workspace TypeScript、Production Build、Unit/Component 137 files / 652 tests 全部通过；固定 seed `20260829` 的 10,000 手牌模拟完成 10,000、失败 0、不变量失败 0、原生进程重试 0，覆盖 6,649 手规范化边池和 2,229 手 Short All-in。
- 本轮没有修改机器人亮牌频率、管理员房间日志范围/容量、数据库 Schema 或持久化服务，也没有启动/停止 `dev:lan`、机器人、PostgreSQL 容器或 3000/5173 端口。检查时 55432/55433 均未监听，因此没有接管用户环境运行 PostgreSQL Integration；数据库写入仍复用既有逐个持久化 `settlement.pots` 的路径。

## 房间文字聊天、Emoji 与头像分段气泡（2026-08-29）

- 左侧牌桌信息抽屉的聊天占位已替换为真实房间文字聊天。房间参与者和围观者在完成 `table:subscribe` 后均可发送；单条最多 120 个 Unicode grapheme，连续空白会规范为单个空格，Emoji 组合按一个可见字符计，控制字符和双向伪装字符被拒绝。输入区与 Emoji 快捷键固定在抽屉底部，消息列表独立滚动。
- 已入座玩家的新消息在头像附近显示项目原创 CSS 气泡。座位布局按顶部/底部/左右位置选择气泡方向，顶部座位向下、底部座位向上，侧位向桌内可用空间；气泡不接收指针事件。长消息每段最多 24 个 grapheme，每 1.8 秒以新段替换而非内部滚动，最后一段保留 3 秒；本人气泡锚定 Hero 头像，围观者因没有座位头像只在聊天列表显示。
- Realtime 增加 `room:chat-send`、`room:chat-message` 与 `room:chat-history`，Protocol 继续保持 v5。服务端每次发送都复核 Session、RoomMember 和已订阅房间，已被移除的成员会退出 Socket room；相同发送者/房间/`clientMessageId` 精确去重，不重复广播。每账号跨 Socket 每 10 秒最多 5 条新聊天，仍同时受既有通用实时限流。
- 每个房间只在当前 Server 进程内保存最近 50 条，重连会恢复抽屉历史但不会把旧消息重新播放成头像气泡；进程重启清空。聊天不改变 Poker Runtime/stateVersion、Wallet 或 Table Stack，不写 PostgreSQL、Snapshot、管理员牌局 NDJSON、浏览器 Storage 或 PWA Cache。管理员房间集成测试明确反向扫描了聊天正文与 `room:chat-send`，两者均未进入诊断文件。
- 原生 Unicode Emoji 已实现；语音聊天未实现，因为 `AGENTS.md` 的不可变产品边界永久禁止语音聊天。本轮没有新增、下载或缺失图片、字体、音频，气泡/箭头均为原创 CSS，图标复用已登记的 Lucide ISC 组件。
- TDD 红灯先分别因缺少 `room-chat` 协议模块和 `PlayerChatBubble` 组件失败。最终 Lint 零警告、`git diff --check`、全 workspace TypeScript、Production Build、Unit/Component 137 files / 647 tests、标准 PostgreSQL Realtime Integration 2 files / 42 tests 全部通过；Vite 8.2.1 转换 1,998 modules，PWA precache 42 项。未启动、停止或接管 `dev:lan`、机器人及 3000/5173 端口。

## 管理员长测日志复盘与机器人补点修复（2026-08-29）

- 完整读取管理员房间 `562737` 的 17,539 条本地 NDJSON：249 手编号连续、每手牌桌点数守恒、底池与派奖一致，未发现重复牌、负数后手、卡死手牌、恢复失败或持久化失败。日志同时证明 653 次成功重坐中有 612 次恢复为 `BUSTED_WAITING_REBUY / stack=0`，而能对应到随后成功补点的只有 56 次，导致九人长测持续退化为少人牌局。
- 根因是客户端投影会在 `POST_HAND_REVIEW` 保留刚结束的手牌供展示，旧机器人策略却要求 `state.hand === null` 才强制补点。机器人因此在最关键的两手间窗口只随机等待、重连或离桌；现在只要权威座位为零后手破产状态，就把房间 Initial Buy-in 作为唯一强制决策。服务端仍负责校验该玩家没有参与正在进行的手牌。
- 回归测试先以“结算展示仍有投影 hand、机器人已重坐但为零后手”稳定复现旧实现返回随机决策，随后验证修复后只返回必需补点。System Test Runner 28 files / 102 tests、管理员日志范围测试 2/2、全 workspace TypeScript、Lint、Production Build、Unit/Component 134 files / 637 tests 全部通过。
- 实现与既有测试再次确认：完整 NDJSON 只对房主角色为 `ADMIN` 的房间写入，普通用户房间直接跳过。本轮按产品所有者决定不调整管理员测试日志的容量或保留机制；未启动、停止或接管 `dev:lan`、机器人、Docker 及 3000/5173 端口，也未对现有房间执行机器人实跑。

## 战绩离桌开关与 LAN 终端输出修复（2026-08-29）

- 桌面浏览器“显示离桌”无反应的根因是整个左侧抽屉在任何子元素 `pointerdown` 时都会调用 Pointer Capture；鼠标从按钮按下后，`pointerup/click` 被重定向到抽屉本身。侧滑 Hook 现在忽略从 Button、Link、Input、Tab 等交互控件开始的指针，空白区域的左右侧滑关闭保持不变；回归测试先证明旧实现确实抢占按钮指针，再验证修复。
- “显示离桌”只切换浏览器本地筛选，不发送 HTTP/Socket 命令，因此管理员房间 NDJSON 不会记录这次点击。对 `admin-room-669232-cmtdf66yi0001c8ahcdvl9n7v.ndjson` 的只读审查统计为 641 个 Snapshot、546 个 Command、19 手完成牌局；38 个拒绝全部是 `STALE_STATE`，Snapshot 版本无倒退，19 手均保持牌桌点数守恒、无负数后手，未发现新的持久化或恢复错误。开发库只读核对为 9 名 Session 玩家、1 名仍在座，证明服务端确有 8 名离桌玩家可供筛选；最终只剩 1 个座位属于本文件上一节已经修复的旧版机器人输光重坐问题。
- Windows PowerShell 5.1 的 LAN 父/子启动脚本显式使用 UTF-8 无 BOM 解码原生进程输出，并关闭 Vite ANSI 颜色，消除 `鉃?[39m` 等乱码。退出清理改为静默读取 `taskkill` 退出码，并在 PID 已自然退出时视为成功，不再把中文 `taskkill` 文本误解码后输出假警告。
- TDD 红灯分别捕获抽屉抢占按钮 Pointer Capture，以及启动脚本缺少 UTF-8/静默幂等退出约束。最终 Lint 零警告、全 workspace TypeScript、Production Build、Unit/Component 134 files / 636 tests、标准 PostgreSQL Integration 24 files / 212 tests 全部通过；Windows PowerShell 5.1 Parser 与原生 `➜ UTF-8` 输出探针通过。未启动、停止或接管 `dev:lan`、机器人、3000/5173 端口。
- 使用 `corepack pnpm dev:lan` 后按 `Ctrl+C` 时，Windows 的 `corepack.cmd` 外层仍可能显示正常的“终止批处理操作吗 (Y/N)?”；这是 Windows 批处理包装器的确认提示，不是乱码或应用错误。输入 `Y` 即可结束，本轮没有通过修改用户 PowerShell/Git/系统配置来隐藏它。

## 机器人输光后重坐与强制补点修复（2026-08-29）

- AFK 管理员房间 `669232` 的本地 NDJSON 显示初始 9 个座位在结算后先降为 6、再降为 4；期间没有任何 `seat:leave`、`seat:sit-out` 或 `seat:reserve-away` 命令，也没有一条 `stack:buy-in`。开发库只读核对进一步确认 `bot01/06/07/09` 的 ACTIVE GameSession 均为 `detachedStack=0` 且已无 TableSeat，证明是输光结算清座而非机器人主动离桌。
- 根因是机器人虽然已有“在座且 `BUSTED_WAITING_REBUY` 时强制补点”的策略，但服务端结算会先删除 0 Stack Seat；旧 Runner 对曾经坐过但当前无座位的机器人统一套用 5–8 分钟随机生命周期冷却，因此根本到不了在座补点分支。
- Runner 现在区分主动与非主动座位消失：只有成功执行 `seat:leave`/`seat:reserve-away` 才标记主动离座；无主动命令却丢失座位时持续绕过冷却抢空座。抢回成功后跳过普通 1–3.5 秒随机等待，立即读取权威状态；恢复为 0 Stack 时在当前两手间窗口强制发送 Initial Buy-in，服务端随后把座位恢复为 `ACTIVE`。
- TDD 红灯先稳定复现旧策略只返回 `wait`，并锁定主动离座不得被自动反悔。聚焦回归 13/13、完整 System Test Runner 27 files / 99 tests 通过。
- 最终门禁：Lint 零警告、`git diff --check`、全 workspace TypeScript、Production Build、Unit/Component 133 files / 633 tests、标准 PostgreSQL Integration 24 files / 212 tests 全部通过。Vite 8.2.1 转换 1,995 modules，PWA precache 42 项；未启动、停止或接管 `dev:lan` 与机器人进程。

## 管理员清理、固定机器人租约与本地房间日志（2026-08-29）

- 开发 Seed 改为从空库创建 1 个管理员与 `bot01`–`bot09` 九个固定机器人，不再创建 Alice/Bob 等示例账户。机器人钻石每次 Seed 或租约领取时补至安全上限 2,000,000,000；服务器用三分钟续期租约和数据库行锁按序分配，多个机器人进程不会竞争同一登录，释放租约时撤销对应 Session。
- 随机机器人只在登录后通过管理员接口查询一次房间，只接受管理员创建的 OPEN 房间；没有目标时保持登录静默直至 Ctrl+C/到期，不轮询、不自动进入后来创建的房间。并发上限从 50 收紧为固定账号数 9。
- 管理后台新增 CLOSED 房间完整删除和普通玩家永久删除。两者均要求原因、UUID 操作号及“永久删除”确认；玩家有关联房间时先拒绝，管理员/self 永不允许删除。房间级联删除共用 30 天保留任务的同一删除图，并删除对应本地日志。
- 第 25 条 Migration 删除 PostgreSQL `TableDiagnosticTrace`、`ServerFeatureFlag` 和 Snapshot Trace Trigger，新增固定机器人/租约字段与约束。完整诊断改为只对管理员房间写入 Git 忽略的 `D:\wepoker\room-logs\admin-room-<roomCode>-<roomId>.ndjson`，同时包含完整权威 Snapshot 和变更命令/ACK；普通房间不记录。
- 删除前已生成并校验恢复备份 `D:\wepoker-backups\wepoker-20260828T195146035Z.dump`，894,061 bytes，SHA-256 `d9ac2a1b10b2e12557abdb026f26bf40c0058bab43dfb82449a09f6aaf817a48`。最初备份调用因缺少显式环境参数而安全失败，未发生任何删除；补齐开发环境参数后备份成功并再次校验。
- 已按产品所有者授权重置且只重置 `wepoker_dev` 的 `public` schema，顺序应用 25/25 Migration 后 Seed 显示 `created=10, existing=0`。最终只保留 1 个管理员与 9 个固定机器人，房间、牌局、Snapshot 均为 0；`bot01`–`bot09` 槽位为 1–9，每个 Wallet 钻石为 2,000,000,000；`D:\wepoker\room-logs` 为空。
- TDD 目标单元检查 44/44；首轮目标 PostgreSQL 49/50 只暴露 CLOSED 测试夹具缺 `closeRequestedAt`，修正后管理员集成 8/8。完整 Integration 首轮 205/212 的 7 项失败均来自升级测试仍写死 24 条 Migration，更新到 25 后旧库升级 7/7、最终 24 files / 212 tests 全通过。
- 最终门禁：Lint 零警告、Prisma Validate、`git diff --check`、全 workspace TypeScript、Production Build、Unit/Component 133 files / 629 tests、标准 PostgreSQL Integration 24 files / 212 tests 全部通过。Vite 8.2.1 转换 1,995 modules，PWA precache 42 项。未启动 `dev:lan`、机器人或 3000/5173 常驻服务。

## 围观历史、站起托管与牌桌 UI 修复（2026-08-28）

- 站起但仍在当前手的玩家立即进入持续到手末的 `Check else Fold`，服务端新增 `LEAVE_AFTER_HAND` 自动原因并保持未弃牌者的两张牌背。行动区对围观者完全不渲染；普通超时继续能过则过、否则弃，绝不追加投入。
- 房间内围观者现在可读取本房间全部已结算手牌的公共历史、公开牌与回放，并可独立购买偷偷看和发发看。围观投影把 OWN 底牌、个人起止后手和净结果设为 `null`；非成员仍统一得到 not-found。第 24 条 Migration 移除旧“买方必须参局”外键，RoomMember、目标参与者、Wallet/Hand/Room 约束继续生效。
- 玩家座位以本街最新动作替换昵称，覆盖跟注、过牌、下注、加注、弃牌和全下；全下仍显示独立筹码与数字。弃牌头像保持灰态，主动公开牌保持彩色。行动倒计时在权威 deadline 归零但尚未清除时继续显示 0，不会提前消失。
- 购物车托条改为 10 个离散档位并默认最大档；围观状态删除整个 Hero 说明框和“点击空座/恢复后手”文字。随机机器人的站起、重坐、暂停/返回、保位与非必要补点冷却进一步降频到 5–8 分钟。
- 首次开局仍由房主触发；首次开始后人数不足只停发，单一 30 秒服务端复核会在人数恢复后自动进入 5 秒倒计时。房主主动暂停会取消自动恢复，仍需房主手动继续。
- 牌桌页面接入标准 Screen Wake Lock，并在页面重新可见时重取。生产 HTTPS/PWA 且浏览器支持时生效；普通 LAN HTTP、系统强制省电或不支持该 API 的浏览器无法保证不息屏，这是浏览器平台限制而不是可由网页绕过的权限。
- TDD 红灯先分别捕获围观者仍出现预操作、站起玩家丢失牌背/未托管、动作状态缺失、自由拖动补点、短频机器人生命周期和缺少 Wake Lock。首次完整 Integration 为 201/212：7 项仍写死 22 条迁移、2 项仍期待人数恢复后房主重启、1 项恢复场景因新的立即托管提前结束、1 项诊断追踪异步写与测试清理竞态；按新规则重写场景并关闭清理窗口后最终 25 files / 212 tests 全通过。
- 最终门禁：Lint 零警告、Prisma Validate、`git diff --check`、全 workspace TypeScript、Production Build、Unit/Component 133 files / 633 tests、标准 PostgreSQL Integration 25 files / 212 tests 全部通过。Vite 8.2.1 转换 1,995 modules，PWA precache 42 项；24 条 Migration 已部署到测试库。未启动 `dev:lan`、机器人或 3000/5173 常驻服务。

## 房间计时与补充后手动线（2026-08-28）

- 房间创建后、首次正式开始前不运行倒计时；首次开始时写入唯一开始时间与截止时间。之后停发、暂停下一手、人数不足、退出、站起、保位离桌和重连均不暂停或重置截止时间。
- 购物车直接打开补充后手托条，移除“牌桌点数与钻石”二级弹窗；托条默认位于最大值，单次最大值固定为房间 Initial Buy-in，可多次补充。
- `stack:buy-in` 同时支持在座 Seat stack 与站起后活动 GameSession `detachedStack`，两者都写独立牌桌点数流水且不读取、不修改 Wallet 钻石。服务端强制单次 Initial Buy-in 上限，不能绕过界面提交超额金额。
- 本轮只核对未修改：核心引擎在仅剩一名未弃牌玩家时立即无人争夺结算；手机防息屏已记为待实现；公共坐下/站起音效现状已记录。
- 门禁结果：全仓 Lint、TypeScript、Production Build、Unit/Component 130 个测试文件共 620 项，以及标准 PostgreSQL Integration 25 个文件共 211 项均通过。未启动 `dev:lan`、机器人或 3000/5173 开发服务。

## 当前阶段

Step 0–Step 8 已完成到 Release Candidate 门禁。当前版本 `0.1.0-rc.1`，Realtime Protocol v9，34 条 append-only Migration。Step 8 后按产品所有者实测反馈继续修复阻断级问题，并完成钻石语义调整、压力测试诊断能力、鱿鱼模式、普通模式双人 All-in 发两次、短牌模式和暴击模式。

## 真人行动语音、坐站音效与 Realtime 防刷（2026-08-28，已完成）

- 项目所有者提供的 12 个 WAV 已从仓库根目录剪切到 `apps/web/public/audio/table/`：男声和女声各包含跟注、加注、过牌、弃牌、All-in，另有坐下与站起音效；根目录旧 `male/female/sfx` 空目录已删除。所有文件移动前均验证为 RIFF/WAVE，PWA 静态预缓存已纳入 WAV。
- 行动历史现在按 `PLAYER_CALLED / PLAYER_BET|PLAYER_RAISED / PLAYER_CHECKED / PLAYER_FOLDED / PLAYER_ALL_IN` 播放对应真人语音；Bet 与 Raise 都归入“加注”，All-in 始终使用独立语音。Seat 成员新增/移除分别播放坐下/站起；初次进入和重连只建立基线，不补播旧事件。
- 默认男声。牌桌左上角菜单新增“声音”，可切换男声/女声并调整音量；启用状态、音量和声线仅作为当前浏览器的非敏感偏好保存，不改变服务器牌桌状态。浏览器仍用首次真实手势解锁 AudioContext，WAV 通过同源 fetch 解码后接入同一音量链。
- 随机机器人默认决策间隔由 250–1200ms 调整为 1000–3500ms；主动 Socket 重连至少间隔 5 分钟，站起、重坐、暂停/返回、保位和非必要补点共用 5–8 分钟随机冷却。真实断线恢复独立使用 30 秒节流，遇到连接限流仍等待完整 61 秒窗口，避免把测试行为做成重连风暴。
- 服务端保留每 IP 每分钟 30 次连接、每用户最多 5 个并发 Socket、单 Socket 每 10 秒 120 条命令，并新增每账号每分钟 12 次连接、跨 Socket 每账号每 10 秒 80 条实时命令、跨 Socket 每账号每 30 秒 6 次座位生命周期命令。座位限流覆盖坐下、站起、暂停、返回和保位；限流发生在业务处理前并返回稳定 `RATE_LIMITED`，不能靠新开 Socket 重置。
- TDD 红灯已实际确认旧实现缺少声线、采样播放、坐站触发、机器人生命周期冷却和跨 Socket 限流。完整 Realtime 首轮 37/38 暴露座位限流误计同 `operationId` 幂等重试，修正为只对新意图计座位额度后 39/39 通过；未知/无效事件在通用额度前漏计的缺口也由红灯捕获并修复。最终 Lint 零警告、全 workspace TypeScript、Production Build、Unit/Component 130 files / 620 tests、标准 PostgreSQL Realtime Integration 39/39 全部通过；Vite 8.2.1 转换 1,995 modules，PWA precache 42 项且明确包含 12 个 WAV。ffprobe 验证所有音频均为 44.1kHz 单声道 PCM。未启动/停止 `dev:lan`、机器人或用户测试窗口，未占用 3000/5173。

## 房间后手连续性与机器人断线诊断（2026-08-28，已完成）

- 重复 2000 的根因是旧模型把每次站起当作 CASH_OUT 并关闭 GameSession，再次坐下必然创建新 GameSession 和新 BUY_IN；排行榜按所有 session 的 `totalBuyIn` 求和，因此每次重坐都重复增加总带入。第 22 条 append-only Migration 增加 `Room.initialBuyIn`、`GameSession.detachedStack` 和每用户/房间唯一 ACTIVE Session 的 partial unique，并移除把 session 身份错误绑定到固定 seatIndex 的外键。
- 新规则为同一房间一份后手：首次坐下只领取一次 Initial Buy-in；站起、退出、保位到期、0 Stack 自动站起和本手后离桌只把后手保存到活动 GameSession；再次进入或换座恢复原后手，不写第二笔 BUY_IN。两手之间补点金额由玩家自由选择，不再受旧 minimum/maximum 限制，但个人累计、在座加离座整桌总额仍受 20 亿安全上限。
- 房间最终关闭统一结算仍在座和已站起的活动会话，非零最终后手各写一次 Table CASH_OUT，随后关闭 GameSession；所有人已站起的房间也必须经过 CLOSING，不能绕过结算直接 CLOSED。开发与测试数据库均已原地应用第 22 条 Migration，没有 reset、truncate 或删库。
- 既有开发库中已存在的旧重复 GameSession 不做破坏性改写；排行榜和个人累计改按 Table Stack Ledger 识别每次重坐的首笔旧座位赠予，只保留每个房间第一次初始带入和之后真实主动补点。实际开发库只读检查发现的 10 组旧重复记录因此不再继续造成展示虚高，原始牌局与流水仍完整保留。
- 机器人全部断线的可证明根因是重连风暴，不是牌桌数据损坏：6 个机器人把 `reconnect` 当作 250–1200ms 随机动作，异常分支还会立即再次连接并绕过全局节流，最终触发服务端每 IP 每分钟 30 次 Socket 限流。最后持久快照为 OPEN/READY/IDLE、无 current hand 或 recovery/persistence error。机器人所有连接共用全局 pacer；主动重连至少 5 分钟，座位生命周期当前为 5–8 分钟冷却，限流后等待完整窗口，普通命令拒绝只请求权威状态。
- 旧启动窗口没有持久 stdout/stderr，因此现有证据不能证明父进程当时为何退出；Windows 事件中没有 Node 崩溃记录。`dev:lan` 现在把 Server/Vite 输出同时显示并保存到 `test-results/lan-runtime/`，下次即使窗口关闭也能读取确切退出错误。本轮不启动或停止用户测试服务，不占用 3000/5173。
- TDD 与最终门禁：Accounting 17/17、Rooms 16/16、Hand Persistence 7/7、Schema Contract 18/18；新增真实 HTTP/Realtime 回归验证离座后手 500 在关房时只结算一次，并以旧两次重坐数据验证排行榜从错误的 4800 修正为初始 2000 加主动补点 500+300，共 2800。全仓 Lint 零警告、TypeScript、Prisma Validate、Production Build、Unit/Component 129 files / 613 tests、标准 PostgreSQL Integration 25 files / 208 tests、开发数据审计 29/29 和 PowerShell 5.1 脚本语法全部通过。dev/test 原地 Migration Deploy 均通过且当前为 22 条；未 reset、truncate 或删库，也未启动 `dev:lan`、机器人或占用 3000/5173。

## 随机多机器人与完整牌桌诊断追踪（2026-08-27）

- 在既有 `tools/system-test-runner` 增加 `random-bots` 模式和根命令 `bot:random`。每个机器人通过公共注册/登录取得独立测试账号，优先选择账号已加入的第一个 OPEN 房间，否则使用本机管理员只读列表发现第一个 OPEN 房间；不增加公开房间列表，也不私自创建房间。机器人并行连接同一桌，按权威投影随机执行下注、站起/重坐、暂停/恢复、保位离桌、补点、托管/取消、逐张亮牌/取消、最后 3 秒加时和重连；零 Stack 时先强制补到默认 100 BB 目标。
- 超时路径核对并新增回归：`TURN_TIMEOUT` 能 Check 时只 Check，否则 Fold；两者 action amount 都是 null，不自动 Call、不追加桌上点数。机器人保留随机等待候选，使这条真实服务器超时路径也能进入压力覆盖。
- 新增第 21 条 append-only Migration：`ServerFeatureFlag.TABLE_DIAGNOSTIC_TRACE` 默认开启；PostgreSQL Trigger 对每次 TableSnapshot INSERT/UPDATE 同事务追加完整 `to_jsonb(NEW)`，Realtime 对所有变更命令异步追加完整命令及成功/失败 ACK。Trace 禁止 UPDATE，统一保留任务在 30 天后删除；完整 payload 含私牌/牌堆，只供本机数据库事故排查，不进入公开日志/API。
- 新增 `trace:status/disable/enable` 即时开关和独立操作文档。dev/test PostgreSQL 已从 20 条迁移顺序升级到 21 条；实际开关完成 true→false→true 验证，开发库最终保持开启。六种旧库基线到当前版本的 Migration Matrix 7/7 通过；期间修复了升级测试会错误拆开 PostgreSQL dollar-quoted Trigger 函数的测试工具缺陷。
- 最终门禁：Lint 零警告、全 workspace TypeScript、Prisma Schema Validate、Production Build、Unit/Component 129 files / 611 tests、标准 PostgreSQL Integration 25 files / 203 tests 全部通过；开发数据审计 29/29 PASS，诊断开关最终为 `enabled: true`。首次直接运行 `audit:data` 因其默认连接本机 5432 而得到 `ECONNREFUSED`，明确指定 `.env.docker.dev` 的 55432 后同一只读审计通过。为避免接管用户测试窗口或改变真实 OPEN 房间，本轮没有启动 `dev:lan`、没有操作 3000/5173 进程，也没有对现有房间运行会产生业务数据的机器人实跑。
- 首次由 Windows PowerShell 5.1 启动机器人时，UTF-8 无 BOM 脚本中的中文提示被按旧代码页读取，乱码破坏字符串边界并导致 ParserError；改为 ASCII-only 运行时提示，并新增源码回归及 Windows PowerShell 5.1 实际 parser 验证。启动器仍不接管应用进程或端口。

## 本机账号管理、牌桌点数解绑与 30 天保留（2026-08-27）

- 账号与钻石继续由本机 PostgreSQL 的 `User`、`Wallet`、`WalletLedgerEntry` 维护，管理入口是应用内 `/admin/users`，不是 Docker Desktop。开发环境里的 Docker 只负责运行这一本机 PostgreSQL 进程和持久化 Volume，不承担账号管理逻辑；服务日志也改为准确的 `postgres database connected`。
- 登录框现在同时接受手机号或管理员账号；开发 Seed 每次都会修复管理员角色、昵称、手机号和当前本机配置的密码哈希，同时保留普通测试账号已有密码。当前本机管理员账号为 `admin`，正确 Seed 手机号为 `19900000001`；实测截图中的 `19000000001` 少了一位 `9`。本机开发配置已改用简短密码，Migration/Seed 后已直接验证数据库中的 Argon2 哈希可通过。
- 牌桌点数与钻石完全解绑：入座、补充点数、输赢结算、站起和关闭房间都不再借记或贷记 Wallet，也不再生成新的 Wallet `BUY_IN/CASH_OUT` 转换流水。牌桌点数只在 Room/GameSession 生命周期内流转，离桌后保留最终点数与手牌历史；历史配对流水仍只读兼容。钻石只用于每手开局 10、偷偷看 50、发发看 10、行动加时 10，以及管理员调整。
- 新增第 20 条 append-only Migration 和定时保留任务。已关闭且关闭时间超过 30 天的房间、牌局、行动、快照、牌桌点数流水及关联付费记录会整组删除；过期/撤销 Session、旧幂等记录、旧审计与无外键引用的旧 Wallet 流水同步清理。活动房间不会删除；账号身份和当前钻石余额长期保留，避免把“一个月历史上限”误实现成自动注销账号。
- TDD 红灯先捕获了登录框只接受手机号、旧 Seed 不修复管理员密码、在座调钻石被拒绝、牌桌点数仍影响 Wallet 和缺少保留任务；实现后补齐认证、Seed、牌桌会计、恢复、并发、Realtime、审计、保留期与 Migration 回归。最终 Lint、全仓 TypeScript、Production Build、124 files / 583 tests、PostgreSQL Integration 24 files / 200 tests、开发数据审计 29/29 全部通过。为避免接管用户的测试环境，本轮没有启动浏览器 E2E、没有启动 `dev:lan`，也没有操作 3000/5173 上已有的进程。

## UI 文案、音效与全押公共牌节奏（2026-08-27）

- 删除大厅、已结束房间、加入房间和历史页中的解释性副文案；Web 用户界面源代码中的“不会 / 仅 / 因此”冗余表达完成扫描与清理。钻石合规提示保留业务含义并改为直接表达。
- 无声音的确定根因是首次进入时 `localStorage.getItem(volume)` 返回 `null`，旧代码执行 `Number(null)` 后把默认音量误设为 0。修复为缺值时使用 70%，同时加入 Safari `webkitAudioContext` fallback、移动端手势解锁、开启音效即时反馈、更清晰的音量包络和一次更新包含多个结算事件时的赢家音效识别。仍使用项目原创 Web Audio，无需下载音效文件。
- 全押导致服务器一次投影剩余公共牌与结算时，客户端现在独立呈现：翻牌、1 秒后转牌、1 秒后河牌、再等待 1 秒显示结算框。刷新或重连到已完成牌局时直接显示完整权威状态，不重播陈旧动画；服务器结算、持久化和 4 秒观察期保持不变。
- 开发账户由 PostgreSQL `User`、`Wallet` 与 `WalletLedgerEntry` 维护；`/admin/users` 可查看账号并在详情页执行有审计的正负钻石调整。开发 Seed 管理员为 `admin` / `19900000001`，密码继续只从 `DEV_SEED_PASSWORD` 读取。
- 针对声音与全押呈现新增回归；全仓 Lint、TypeScript 与 Production Build 通过，Unit/Component 124 files / 583 tests 通过，PostgreSQL 结算持久化 1 file / 7 tests 通过。Windows 检查结束时 3000/5173 均未监听，因此没有擅自启动服务做手机实机验收；Codex 内置浏览器也无法跨容器访问 Windows LAN 地址。

## All-in 结算、归档与固定钻石费率修复（2026-08-27）

- 复现并定位 unequal-stack heads-up all-in 后 Call/All-in 卡死：玩家在开手前选中单张待亮，随后到达强制 Showdown 时，结算仍把 `[0]` 与 voluntary timestamp 写入 `HandPlayerRecord`，同时又写 `holeCardsPublic=true/reason=SHOWDOWN`，触发 `HandPlayerRecord_public_reason_check`，整个结算事务回滚并把 Runtime 冻结。修复为 Showdown 永远清除 voluntary 槽位/时间，由领域规则公开两张；Review 投影同样不把强制摊牌误算为自愿亮牌。新增真实 PostgreSQL unequal-stack all-in 回归并通过。
- 同类故障审查：持久化失败日志现在携带安全的原始 `err`，结算 fallback 不再吞掉 cause；预期的 4xx 开手业务拒绝只清除倒计时并回到 IDLE，不再错误升级为 `PERSISTENCE_ERROR`。新增“开局钻石不足不冻结、不产生半条流水”回归。
- 已结束房间无法归档的根因是 Archive Service 把可过期的 Runtime Snapshot 状态当成安全权威；实际 Room 已 CLOSED、Seat 已清空、ACTIVE GameSession 为 0，却被旧 `RECOVERY_ERROR` Snapshot 拦截。归档改为只依据这三项关系型权威事实；客户端用应用内确认层替代浏览器 `window.confirm`，支持逐个移除和房主“一键清空”。两者都是软归档，历史、Wallet Ledger、看牌授权和牌局记录全部保留。
- 旧快照兼容：7 份开发快照早于房间时钟字段，恢复曾以 `payload-schema:room.durationMinutes` 标错。Codec 与只读审计统一从 Room 行采用权威 `durationMinutes/expiresAt`，且允许先前 `RECOVERY_ERROR` 标记在修复后重新验证。进一步发现成功恢复若只把状态改回 `READY` 却保留旧 `lastRecoveryError`，会触发 `TableSnapshot_recovery_error_check`；Repository 现在以 revision/stateVersion CAS 清除过期错误，正常持久化也显式清空该字段。实际开发启动恢复 8/8、degraded 0、Readiness ready，开发库 29/29 数据审计通过，无清库、无改账。
- 钻石替代用户界面的“积分”，复用既有 Lucide Diamond 图标。费率基准固定 `x=10` 且与 BB 解耦：每位参与者每手开局 10、偷偷看 50、发发看 10、行动加时 10。新增 `HAND_ENTRY_FEE` 和第 19 条 append-only Migration；开局扣费、Hand 创建、Snapshot 与 Ledger 同一事务提交，结算后补齐 Hand 关联。新房间偷偷看固定 50；既有完成手保留冻结历史费用。
- Review 4 秒内现在仍可逐张添加或撤回自愿展示；已展示牌移动到本人头像区并可点击撤回，未选牌仍在手牌区。强制 Showdown 不可撤回。待亮标记删除文字，只保留小型半透明 Eye；Hero 手牌容器与嵌入框改为居中对齐。
- 来源/断线体验审查：Realtime 在可信 Origin 下保持强校验；若用户误用非启动终端公布的网址导致 WebSocket 被拒绝，空牌桌页不再无限伪装为“正在恢复”，而是稳定提示无法连接和正确打开方式。
- LAN 启动脚本增加前置端口/健康检查：已有健康 `dev:lan` 时直接复用并返回成功，残缺或外部占用在 Docker/Migration 前报告端口与 PID；新实例只有 Server 与 Vite 代理的 `/health` 均通过后才宣告启动完成。真实连续执行两次 `corepack pnpm dev:lan` 已验证第二次 exit 0、无 `EADDRINUSE`。
- 最终门禁：Lint、全仓 TypeScript、Production Build 通过；Unit/Component 122 files/577 tests、标准 PostgreSQL Integration 23/199、开发数据审计 29/29 全部通过。375×812 浏览器验收确认大厅、钻石图标/余额、已结束房间列表和应用内清空确认层；错误使用 `localhost` 的来源拒绝亦被实测并验证上述明确错误页。当前 `dev:lan` 的 `/health` 为 200。

## Step 8：多客户端系统测试、最终审计与 Release Candidate（2026-08-26）

- 新增 `tools/system-test-runner` 黑盒多客户端驱动器，只通过普通 HTTP、独立 Session/Cookie、CSRF 与 Socket.IO Protocol v5 访问应用；不导入 Server、Prisma、Snapshot、TableRuntime 或 Poker Core 内部对象。100 个客户端在 20 房间完成 2,000 手真实链路：2/3/5/6/9 人分别 400/400/500/350/350 手，Side Pot 1,464、All-in 1,748、Short All-in 1,321，非法动作、Server 错误、隐私违规、Invariant 与 ACK timeout 均为 0。
- Poker Core 精确枚举全部 2,598,960 个五张牌组合，九类分布完全匹配；固定 Seed 20260826 的百万手完成 1,000,000、失败/Invariant/native retry 均 0，另 10 个 Seed 各 10,000 手全部通过。
- 完整测试为 Unit 121 files/575、PostgreSQL Integration 23/192、Chromium 23/23、Firefox 23/23、WebKit 23/23、PWA 1/1、Production-like 6/6、恢复数据 1/1。Migration Matrix 覆盖空库和 Step 3/4/5/6/6.5/7 Fixture 到最新 18 条；旧 17 条未修改。
- 100 用户负载：100 Socket/20 桌/1,000 命令，Ack p50/p95/p99/max 为 24.997/239.244/330.170/355.283 ms，错误、断线、隐私与 Invariant 为 0。30 分钟 Soak 完成 8,666 手，5 分钟清理后 Runtime/Socket/Timer/Action Cache 全为 0，RSS 从 192,757,760 经峰值 549,646,336 回落至 163,848,192，数据审计 28/28。负载故障覆盖 App graceful/abrupt、PostgreSQL 与 Caddy restart，20 个连接均恢复且 Wallet/Table Stack/Snapshot/幂等保持。
- 修复行动加时结算约束升级和 Admin Point Action 对历史加时 Hand 的元数据关联；修复生产浏览器矩阵启动对 PostgreSQL 的隐式依赖；Wallet 补齐发发看与加时流水标签；生产镜像删除 integration helper，实际镜像无 Scenario Runner、源码、测试文件、环境文件、Dump、密钥或开发 CLI。
- 后端 13 条主要查询经 `EXPLAIN ANALYZE`，约 0.05–0.92 ms；无阻断 N+1、无界列表或不稳定 Cursor。Web 主 JS 降为 347.57 kB（gzip 105.46 kB），Admin/History/Replay 路由懒加载。依赖策略只有 Prisma CLI 配置路径 advisory 1145093 精确 allowlist，生产可达 High/Critical 为 0。
- 正式恢复演练备份 275,540 bytes、SHA-256 `2a75a39cbb1f8a4fe87994c4b895787b3a781ff27b137ee8390043209a82b2b2`，恢复到全新 Volume/数据库后 18 Migration、28/28 Audit、登录/Wallet/History/Replay/费用/Admin、活动 Snapshot 和新 Hand 均通过。独立 Clean Clone 从 committed Candidate 完成 frozen install、空库 Migration、build/image/Compose/ready、6/6 E2E、备份/恢复和 28/28 Audit。
- Requirements Traceability 为 51 PASS、0 PARTIAL、0 FAIL；Release Blocker 为 0。摘要证据位于 `docs/release-evidence/0.1.0-rc.1/`，不含 Dump、完整日志、手机号、Cookie、Secret 或私牌。已知限制集中在 `KNOWN_LIMITATIONS.md`。

## Step 7：管理后台、安全、生产部署与备份恢复（2026-08-26）

- 只追加第 17 条 Migration `20260825100000_step7_admin_audit`：新增不可修改/不可删除的 `AuditLog`、管理员调账幂等 scope 和必要索引；16 条既有 Migration 未修改。从空标准 PostgreSQL 顺序应用 17/17、Step 6.5 升级、两次幂等 Seed 均通过，Readiness 要求 17 条已完成 Migration，Realtime Protocol 保持 v5。
- 现有 Web App 新增桌面优先且手机可读的 `/admin` 路由体系，覆盖 Dashboard、用户/掩码手机号搜索和详情、房间、活动桌、Game/Hand、Wallet Ledger、三类积分行为、整手偷偷看、发发看、AuditLog、Recovery 和 System。普通用户由前端 Gate 提示无权限，所有 API 仍独立按数据库当前角色返回 `ADMIN_REQUIRED`。
- `ADMIN_ADJUSTMENT` 在同一 PostgreSQL 事务中重新验证 Admin、锁 Wallet、调用 Wallet Service、追加 `WalletLedgerEntry` 与 `AuditLog`；非零整数、8–200 字符安全 reason、0/`MAX_POINTS` 边界和在桌保护均在服务端执行。同 operationId/同 payload 精确返回原结果且不重复余额/流水/审计，不同 payload 返回 `IDEMPOTENCY_CONFLICT`，不修改 Table Stack、Pot 或 Hand。
- 房间管理复用既有 Pause/Resume/CLOSING/Review/Cash-out/Closed 流程；管理页面显示 30–180 分钟时长、`expiresAt`、到期待完成当前手、10–45 秒行动时间、Snapshot revision/stateVersion 与 Recovery 状态。活动桌 API 不返回 Snapshot payload、未来 Board、剩余牌堆或未公开底牌；管理员查看已完成 Hand 全部底牌会写不含牌值的 `ADMIN_VIEW_FULL_HAND` 审计。
- Point Action Audit 按操作发生时冻结的 Big Blind 比较：偷偷看 `ceil(BB/2)`、发发看 `ceil(BB/5)`、加时 `ceil(BB/10)`；显示 Expected/Actual、Ledger 与 operationId。每手唯一发发看结果、每位玩家独立购买、逐张待亮公开、未选择牌不泄漏均纳入管理查询和 28 项数据审计。
- HTTP 写请求要求可信 Origin 与 `X-Wepoker-Request: 1`；精确 CORS、HttpOnly/SameSite Cookie、生产 Secure Cookie、Session 过期/撤销/当前角色复核、认证/写/管理分层限流和稳定安全错误均已覆盖。Socket.IO 精确 Origin/Session、每用户最多 5 个连接、连接/命令频率、payload 大小和未知事件拒绝已覆盖。CSP 无 unsafe-inline/eval，并启用 nosniff、frame-ancestors、Referrer/Permissions Policy 和生产 HSTS。
- 日志只保留 requestId/roomId/handId/userId/版本等安全关联字段；完整手机号、密码/hash、Cookie/Session、DATABASE_URL、Snapshot payload、牌堆、未公开/未选择底牌均不输出。管理员搜索可提交完整手机号，但响应只返回掩码；镜像历史、Config、文件路径和导出层已用真实运行时 Secret 反向扫描，无 Secret、`.env`、Dump、私钥或 Playwright 产物。
- Production Dockerfile 使用固定 Node 24 Alpine digest、多阶段 build/migration/runtime、生产依赖裁剪和非 root 用户；`compose.prod.yaml` 提供固定 PostgreSQL 17 digest、持久卷、一次性 Migration Job、App health/readiness 与 Caddy。Caddy 模板覆盖 HTTP→HTTPS、TLS、安全头、SPA、API 与 Socket.IO WebSocket；本阶段只做 localhost Production-like，没有公网部署、域名购买或镜像推送。
- `backup:create/list/verify/restore/prune` 使用项目外 custom-format Dump、Manifest v1、SHA-256、Protocol/PG/App/Migration 元数据、原子 partial、恢复锁和新数据库保护。实际恢复 `wepoker-20260825T163747213Z.dump`（SHA-256 `b3c61f2ca0f6fdd4d613c52d6b1c040311ea1a3dae89f9c0a49dec383945331e`）到 `wepoker_step7_restore_populated`；17 条 Migration、28/28 数据审计、独立 App/Caddy Ready、登录/Wallet/History/Replay/偷偷看/发发看/Admin 和恢复后新 Hand 均通过。Prune 只处理合法且未锁定的配对，未知文件保持不动。
- `audit:data` 只读执行 28 项 Wallet/Ledger/Table/Hand/Pot/Room/三类费用/待亮牌/发发看授权/Action Receipt/Snapshot 审计，异常只输出安全聚合与非零退出码，不自动修账。生产数据和恢复副本最终均为 28/28 PASS、违规计数 0。
- GitHub Actions CI 覆盖 frozen install、lint、typecheck、unit、PostgreSQL integration、build、Chromium E2E、Docker build 和 production Compose config；手动 Release Check 覆盖 100000 手、备份恢复/审计及扩展浏览器，不部署、不打 Tag、不推镜像。

### Step 7 最终验收证据

- Docker 29.7.2、Desktop 4.86.0、Compose 5.3.1、linux/amd64；frozen install、Prisma validate、空库 17 Migration、幂等 Seed、lint 0 warning、全 workspace typecheck 和 production build PASS。Vite 8.2.1 转换 1,994 modules，PWA 预缓存 16 项（720.29 KiB）；525.94 kB 主 JS chunk 是已记录的性能限制。
- Unit：97 files / 489 tests PASS（Poker Core 143、Shared 28、Server 202、Web 116）。Standard PostgreSQL Integration：23 files / 182 tests PASS，使用 `--trace-deprecation` 最终无 warning。定时器修复后的最终 Chromium：22/22 PASS（0 retry，5.3 分钟）；Production PWA：1/1 PASS。
- Production-like 最终有效场景 6/6 PASS：Admin/掩码搜索/调账/AuditLog、历史/偷偷看、加时、逐张待亮、唯一发发看与用户独立购买、关房/归档；均经 localhost Caddy HTTPS、生产镜像、Migration Job 和持久 PostgreSQL，而非 Vite Dev Server。
- 最终生产数据 28/28 audit PASS。完整 Compose `down`（无 `-v`）/`up` 后 Ready 200，前后计数均为：32 User、91 Wallet Ledger、13 Hand、4 AuditLog、13 Room、13 Snapshot、3 偷偷看购买、4 发发看购买。App 手动 restart 优雅完成且无 shutdown timeout；PostgreSQL 真实 restart 10/10 每次都观察到 Ready 暂时失败并自动恢复，前后持久化计数不变。
- 12 类独立稳定性均 10/10、首错即停、无业务重试：Admin Adjustment 并发幂等、Admin Room Close、Preflop 进程重启、PostgreSQL restart、偷偷看并发、发发看并发、加时幂等、Settlement Exactly-once、Flop 进程重启、9 人实时、Backup/Data Audit、Audio Event Dedup。
- Poker Core 固定 `seed=123456` 的 100000 手：completed 100000、failed 0、invariantFailures 0、elapsed 149485.567 ms、nativeProcessRetries 0；覆盖 81768 手边池和 23028 手 Short All-in。
- Dependency policy：Critical 0、可达 High 0、Moderate/Low 0；raw audit 的唯一 High `1145093` 位于 Prisma CLI `@prisma/config` 的 `deepmerge-ts` 配置合并路径，不接收生产不可信对象，已写入 allowlist 与 `THIRD_PARTY_NOTICES.md`。`pg@9` warning 根因是 Prisma adapter 在同一 transaction client 上并发 relation include；服务改为锁内顺序查询并加 warning 回归，继续固定 `pg@8.23.0`，不盲升 pg 9。

### Step 7 真实失败与修复

- 第一轮完整 Integration 为 180/181：Admin 在桌调账保护用例缺少新的 CSRF 标头，得到 403 而非目标 409；补齐可信请求后目标 6/6、最终 182/182。随后 `pg@9` busy-client warning 被跟踪到发发看 transaction relation include，先写捕获 warning 的失败测试，再顺序化读取，最终 trace 扫描为 0 warning。
- 初版数据审计错误地要求总投入等于 Pot，误报合法未跟注返还。新增盲注 20/10、最高投入未被跟齐的失败回归后，审计改为验证 Pot award、合法赢家/参与者/奇数筹码及唯一最高非弃牌玩家的精确返还；生产和恢复库最终 28/28。
- 第一轮 Production-like 组合测试受生产 IP 认证限流影响，后续注册显示“请求过于频繁”；按独立 App 进程拆分场景后通过，没有放宽限流。另一条 E9/E10 暴露真实过期 Review 停留：权威 Scheduler 曾对必须执行的桌面 deadline 调用 `unref`。新增 `hasRef` 回归先稳定失败，移除 `unref` 后 Unit/Integration 全绿；启动 Recovery 将卡住的 state 10/revision 9 线性推进到 IDLE state 11/revision 10，新的生产 E9/E10 通过。
- 最终镜像生产 deploy 两次遇到 npm Registry `ECONNRESET`；pnpm 下载层自身重试后同一 build 退出 0。该网络重试不是业务测试 retry。镜像 build、导出、真实 Secret 层扫描和 Compose 启动最终通过。
- 原始 production/default Compose 在缺少必填变量时按设计非零拒绝；使用 `.env.production.example` 的无秘密占位配置静态展开通过。raw `pnpm audit` 因已审查 advisory 1145093 返回 1，策略审计返回 blocking `[]`；两者未互相冒充。

### Step 7 已知限制

- 仍为单活动 App 实例；无 Redis/水平扩展/跨区域/自动故障转移。无真钱、支付、提现、短信验证码、真实聊天后端或管理员编辑 Snapshot/牌堆/赢家能力。
- 尚未公网部署、未购买正式域名、未验证公网 ACME/TLS、未推送 Registry、未创建 GitHub Release。备份未自动上传云端，需运维保存至少一份异机副本。
- 前端主 chunk 525.94 kB 和传递依赖 `glob@11.1.0` deprecated 留待正常性能/依赖维护；均不影响本阶段功能与可达安全门禁。

## 房间时钟、固定积分费率与待亮牌（2026-08-25）

- 创建房间新增两条分档滑杆：牌桌时长默认 60 分钟、范围 30–180 分钟、步长 30 分钟；行动时长默认 30 秒、范围 10–45 秒、步长 5 秒。桌面运行时间改为服务器权威的剩余时间；到期时允许当前手牌和 4 秒结算展示完成，随后强制停发、关闭房间并仅允许玩家站起离开。重启恢复会重新建立房间和行动 deadline，不依赖浏览器本地计时。
- 行动最后 3 秒显示独立的中央紧迫倒计时，不挤占公共牌或行动按钮。玩家可无确认立即加时，每次扣除 `ceil(Big Blind/10)` 娱乐积分并增加初始行动时长的一半；余额不足时静默无效，可在每次再次进入最后 3 秒时继续购买。扣分、幂等与 deadline 更新在同一服务器事务中完成并写入可审计流水。
- 本桌固定费率为偷偷看 `ceil(Big Blind/2)`、发发看 `ceil(Big Blind/5)`、行动加时 `ceil(Big Blind/10)`；创建房间不提供改价入口，右上菜单新增可关闭的“积分说明”。发发看仍使用每手唯一的五张 `fullBoard`，但改为每位参与者独立付费解锁；同一手所有购买者获得相同结果，购买记录和钱包扣款均可恢复、可审计。
- 底牌改为待亮状态：进行中点击任意一张牌可单独切换 Eye/待亮，再次点击撤销；4 秒结算阶段冻结选择并只公开已选槽，下一手开始全部重置。自己底部区域改为头像居中、手牌靠右，结算时待亮牌移动到头像区域；其他座位删除会与姓名/筹码冲突的可见“行动中”标签，当前行动改由主框强调，筹码图标继续明确标识本街投入。
- 删除右侧可拖动历史入口，只保留顶栏入口；历史抽屉删除“精彩对局”占位。牌面 Rank `T` 改为不越界的 `10`。音效改为在第一次真实指针、触摸或键盘手势时解锁/恢复 Web Audio，浏览器“减少动态效果”不再错误地静音；声音、筹码、牌背和倒计时均由项目代码生成，没有素材下载失败，也不需要占位素材。
- 实时协议升为 v5；新增 `BuyTimeExtension`、逐槽 `pendingShow`、房间到期和固定费率投影。只追加第 15、16 个 migration：`20260825030000_room_clock_show_fees` 与 `20260825033000_existing_room_clock_compat`；第二个 migration 为升级前仍开放的旧房间补安全的未来截止时间，避免部署后立即误关。dev/test PostgreSQL 均已部署，Readiness 要求 16 个已完成 migration。

### 最终验收证据

- lint 零警告、全 workspace typecheck PASS、Prisma schema validate PASS、production build PASS；Vite 8.2.1 转换 1,990 modules，PWA 预缓存 16 个静态条目（692.84 KiB）。
- 根级单元测试 456/456 PASS：Shared 27、Poker Core 143、Server 177、Web 109。
- Standard PostgreSQL integration 17 files / 159 tests PASS（164.59 秒），覆盖旧库升级兼容、关闭时序、重启恢复、并发加时扣费、待亮牌隐私、逐用户发发看购买和账本关联。
- Docker PostgreSQL Playwright 20/20 PASS（约 4.7 分钟）；Production PWA Playwright 1/1 PASS。最终完整浏览器回归覆盖创建滑杆、房间到期、逐张待亮、固定费率、发发看唯一结果、声音解锁、移动端布局和资金守恒。
- 应用内浏览器以 390×844 人工复核：创建页两条滑杆的默认值/范围/步长正确；牌桌无横向溢出，Hero 头像居中、手牌靠右，右侧悬浮历史入口为 0，菜单显示偷偷看 10、发发看 4、加时 2（10/20 牌桌），console error/warn 为 0。

### 本轮真实失败与修复

- 首轮数据库集成暴露旧恢复 fixture 使用已移除的 60 秒行动时长和旧亮牌顺序；同时发现旧开放房间在新增截止字段后可能被立即判过期。更新 fixture，并新增只追加的兼容 migration 后，最终 159/159 PASS。
- 首轮完整 E2E 仅 1/20：公共 helper 仍选择旧 `15` 秒选项并填写已删除的收费表单。更新为分档滑杆和强制费率后第二轮 16/20；剩余两条移动 fixture 缺少房间时长，一条仍在结算阶段选择亮牌，一条仍假设首位买家替所有玩家付费。按新协议补齐后目标 4/4、最终完整 20/20。
- 测试环境启动期间出现的 Vite 代理 `ECONNREFUSED`、关闭浏览器上下文时的 `ECONNABORTED/ECONNRESET` 均为服务启停瞬间日志；PWA 用例故意不启动 API，用来证明私人请求保持 NetworkOnly。所有相应断言最终通过。PostgreSQL integration 仍输出一条 `pg@9` 并发 `client.query()` 弃用预警，不影响本轮 159 条测试结果，后续升级数据库适配层时再消除。

## 头像座位、筹码投入与服务器权威预操作（2026-08-24）

- 对手座位改为头像式信息区：彩色表示参与，弃牌后灰度/半透明，保位站起显示纯黑“站”；未公开底牌以叠放牌背覆盖头像一侧，合法公开牌直接占据头像区域。删除会被牌面遮挡的可见“参与中”标签，状态仍保留在可访问名称中；当前 actor 继续使用主框、倒计时和“行动中”强调。
- 新增代码生成的筹码组件，把每位玩家和 Hero 的本街投入放到筹码旁；Hero 的昵称、后手、两张底牌、实时牌型和投入沉到底部。快捷加注/主行动区固定在 Hero 上方，390×844 真实三人桌测得行动区 bottom 761.6、Hero top 768.0，页面无横向或纵向溢出。
- Showdown/两张均公开后，服务器只有在五张完整可求值牌存在时才投影 `publicHandLabel`；其他接收者不会从标签侧信道获得未公开底牌。座位 Stack 区可显示该公开牌型。
- 等待区现在有可反悔的“让或弃”和按当前欠注显示的“自动跟注 N”，两者都有 `aria-pressed` 与明显按下态。让或弃在最高投入变化后仍保持；自动跟注由服务器绑定点击时的 `currentBet/callAmount`，绑定不变时只 Call 一次，任何玩家改变最高投入会在持久 transition 中先取消，绝不自动 Bet/Raise/All-in。
- 实时协议升为 v4；Snapshot、Runtime、恢复与关系 Seat 同步保存自动跟注绑定，动作审计新增 `NEXT_DECISION_AUTO_CALL`。只追加第 14 个 migration `20260824203000_next_action_auto_call`，dev/test PostgreSQL 均已部署；Readiness 要求 14 个完成 migration。
- 本轮头像、筹码、牌背和按下态均由原创 HTML/CSS/Unicode/Lucide 生成，没有新增或下载位图、字体、音效，没有下载失败，也不需要素材占位；资产记录已更新。

### 最终验收证据

- lint 零警告、全 workspace typecheck PASS、production build PASS；Vite 8.2.1 转换 1,988 modules，PWA 预缓存 16 个静态条目。
- 根级单元测试 429/429 PASS：Shared 24、Poker Core 143、Server 159、Web 103。
- Standard PostgreSQL integration 17 files / 156 tests PASS（182.34 秒）；新增实时文件完整 26/26，覆盖绑定自动跟注的持久化、执行、清理、投影与重连。
- Docker PostgreSQL Playwright 20/20 PASS（4.9 分钟）；新增三人场景证明第二位玩家加注后可武装自动跟注，第三位玩家再次改变最高投入时服务器取消绑定且不代替 Hero 行动。375/390/430 多尺寸、6/9 座、资金守恒、Review、历史和隐私均回归通过。
- 应用内浏览器以 390×844 真实双人/三人桌人工复核：彩色/弃牌灰态/黑色“站”、叠放牌背、筹码投入、行动按钮在 Hero 上方、让或弃及自动跟注按下/取消均符合需求，页面操作未出现错误提示。

### 本轮真实失败与修复

- TDD 首轮按预期暴露旧 `CHECK_OR_FOLD` 单模式协议、无自动跟注绑定、旧座位框和旧行动区层级；实现协议/持久化/UI 后目标测试转绿。
- 首次完整 E2E 为 18/20：一条旧几何断言仍要求 Hero 位于行动区上方，与本轮需求相反；另一条仍依赖被精简掉的“保位剩余”文案。分别更新为行动区在 Hero 上方，并恢复有用的剩余期限文案后，目标 2/2、最终 20/20。
- 人工三人验证时复用了仍在另一桌进行中的 Seed 玩家，首个定时开手事务按约束失败；安全关闭旧测试桌、释放既有 GameSession 后，同一三人桌恢复发牌并完成验证。未放宽多桌记账约束，也未把该测试准备错误当成产品通过。

## 结算、逐张亮牌、动效与抽屉交互补充（2026-08-24）

- `POST_HAND_REVIEW` 从 3 秒调整为 4 秒，统一承载赢家、结算和亮牌；连续发牌条件成立时到期直接开始下一手，不再出现第二段“等待下一手”或重复 5 秒倒计时。Review、重启恢复、CLOSING 和 deadline 竞态继续由单桌队列与 Snapshot 裁决。
- 主动公开升级为逐张不可撤销操作：协议版本升为 3，请求只携带本人 `cardIndex`；数据库/Snapshot 保存已公开槽，历史和实时投影对未公开槽保持 `null`。本人未公开牌保持普通牌面，已公开牌才显示暖色与 Eye/“已亮”；第一张公开后第二张不泄漏，第二张仍可继续公开。
- 快捷底池比例与 All-in 点击后立即提交，不再打开确认层；主下注/加注按钮继续提供 min/max、精确值滑杆和确认。公共牌与 Hero 底牌先显示牌背，再按顺序逐张翻面；刷新/重连安静恢复，`prefers-reduced-motion` 仍直接落位。
- 普通 `table:error`/状态刷新横幅增加 3 秒自动清理和新旧计时隔离，新的错误不会被旧 timer 误删；`RECOVERY_ERROR` 保持持久显示。左右抽屉除侧滑外可点击露出的桌面关闭；排名玩家列表与历史玩家/行动独立滚动，公共桌况、公共牌、翻页、偷偷看和发发看固定在底部。
- 登录与注册密码输入增加 Eye/EyeOff 显示/隐藏按钮；文字标签与按钮使用独立可访问名称。390×844 本机浏览器实测默认隐藏、双向切换、左/右抽屉固定区和背景点击关闭，页面 console error/warn 为 0。
- 新增第 13 个 migration `20260824200000_per_card_voluntary_reveal`，不编辑既有 migration；旧整手主动公开记录回填为 `[0,1]`。dev/test PostgreSQL 均部署成功，就绪检查同步要求 13 个已完成 migration，12 个时保持 unavailable。
- 本轮没有新增或下载位图、字体、音效，也没有下载失败；翻牌、牌背和亮牌高亮由原创 CSS/HTML 生成，眼睛图标复用已记录的 `lucide-react` ISC 组件，不需要新增占位图，详见 `docs/asset-log.md`。

### 最终验收证据

- lint 零警告、全 workspace typecheck PASS；单元测试 423/423 PASS：Shared 24、Poker Core 143、Server 155、Web 101。
- Standard PostgreSQL integration 17 files / 155 tests PASS，包含逐张历史投影、实时双人牌局、Snapshot 恢复、migration upgrade、数据库约束、4 秒 Review 和 timer race。
- Docker PostgreSQL Playwright 19/19 PASS（4.4 分钟）；逐张亮牌目标用例另 1/1，快捷加注/托管/翻牌目标 3/3。Production PWA Playwright 1/1 PASS。
- Production build PASS：Vite 8.2.1 转换 1,988 modules，Service Worker 预缓存 16 个静态条目；API/Socket/private traffic 保持 NetworkOnly/no-store。

### 本轮真实失败与修复

- TDD 首轮按预期暴露旧的整手公开协议、3 秒 Review、二段倒计时、快捷确认、常驻错误条、静态牌面与抽屉布局；逐域实现后 Shared/Server/Web 目标测试全部转绿。
- Eye 按钮加入后，Playwright 的非精确 `getByLabel("密码")` 同时匹配输入框和“显示密码”按钮。表单改为 `htmlFor/id` 独立关联，E2E 选择器改为精确标签；登录、注册及全套浏览器回归通过。
- 首轮全 E2E 仍等待已删除的 All-in 确认按钮而超时；测试改为断言快捷键立即产生第一笔 Raise，再由另一玩家使用主滑杆精确加注至 80，目标 3/3、最终 19/19。
- 文档审计发现 readiness 仍只要求 11 个迁移；先把“12 个仍 unavailable”写成失败回归，再把生产门槛更新到 13，目标测试 3/3。
- 本机已有 Prisma 开发守护进程占用 `127.0.0.1:3000`，首次人工登录请求误入该进程并返回 `not_found`。未结束外部进程，本项目临时改用 3001 完成视觉验收；这不是账号或 Origin 逻辑失败。

## 认证入口、本地启动与快捷加注稳定性补充（2026-08-24）

- 登录/注册卡片删除“积分仅供娱乐”“使用旧账号登录”和“手机号仅用于登录；本阶段不发送短信验证码，也不验证号码归属”等冗余行，并同步压缩留白；375×812 浏览器实测登录、注册均无横向溢出或空占位格。公开入口现在只接受手机号，旧 Username 登录仅作为服务端迁移兼容保留，供既有 Seed/开发账号绑定手机号，不重新暴露在公共 UI。
- 默认 `pnpm dev` 现在由本地启动器固定加载 `.env.docker.dev`，连接持久化的 `wepoker_dev` 数据库，并固定使用 `http://localhost:5173`；Vite 默认只显示/监听该本机地址且端口冲突时直接报错。重启 PowerShell 不会删除开发账号；Docker 命名卷在容器停止/重启后仍保留数据。Integration 每条测试前清库，E2E 每次启动重建 `wepoker_test.public`，单元测试使用进程内替身，三者都不会被误认为开发账号持久化。
- Origin 防护仍执行精确来源校验；从 `127.0.0.1`、旧端口或其他来源打开页面时继续返回 403，但提示改为“访问地址与服务器配置不一致，请使用启动终端显示的网址重新打开”。这属于 CSRF 来源校验，不是账号、密码或手机号错误。
- 快捷底池加注确认层不再因同一行动期间无关的牌桌展示版本更新而关闭；其生命周期改为绑定稳定的 Hand/当前行动座位/deadline 标识。新增单元回归验证同一行动更新时保持打开、真正换到下一行动时关闭；真实浏览器的快捷金额、最小/最大、拖动精确值和服务器提交均通过。

### 最终验收证据

- `pnpm@11.16.0 install --frozen-lockfile`、lint、typecheck、production build 均 PASS；根级单元测试 64 files / 414 tests PASS：Shared 23、Poker Core 143、Server 153、Web 95。Standard PostgreSQL integration 17 files / 154 tests PASS。
- Docker PostgreSQL Playwright 最终 19/19 PASS（5.2 分钟）；修复后的 E3/E5 快捷加注与一次性托管、手机号注册登录、既有账号绑定、资金守恒和完整牌局生命周期均由真实浏览器覆盖。Production PWA Playwright 1/1 PASS；Vite 8.2.1 构建 1,987 modules，Service Worker 预缓存 16 个静态条目且不缓存私人 API/Socket 流量。
- 本机真实 `pnpm dev` 验证连接 PostgreSQL 17.10 的 `wepoker_dev`，`http://localhost:5173/health` 返回 200；可信 localhost Origin 获得允许，故意使用 127 Origin 返回带新说明的 403。退出后 3000/5173 均无监听残留。
- 本轮没有新增或下载美术素材，没有下载失败，也不需要占位图；认证卡片变化全部由现有组件和 CSS 完成，已同步写入 `docs/asset-log.md`。

### 本轮真实失败与修复

- TDD 首轮 5 条 Web 断言按预期因旧文案、旧账号入口、旧 Origin 提示和宽泛 Vite 监听而失败；实现后目标测试 10/10 PASS，服务端 Origin 集成目标 1/1 PASS。
- 新启动脚本首次 lint 报 9 个 Node 全局未定义；改为显式导入 `process`、`URL` 等运行时对象后，最终 lint 零警告。早期用 `tsx watch` 嵌入并行启动时退出传播不稳定，最终改用 Node 24 内建 watcher 和信号转发，并以真实根级启动验证。
- 首轮完整 E2E 为 18/19：E3 等待 All-in 确认时，同一行动的一次延迟展示更新关闭了快捷加注层并最终触发超时弃牌。以稳定 action key 修复后，目标用例 1/1、最终完整套件 19/19 PASS。
- 两次直接聚焦 E3 的命令在业务测试启动前分别因测试数据库尚未启动、未指定 Docker test env 而失败；启动 test DB 并显式使用 `.env.docker.test` 后目标用例通过，随后使用标准 Docker runner 完成最终全量结果。Playwright 关闭浏览器上下文时 Vite 记录的 `ECONNABORTED/ECONNRESET`、PWA 故意不启动 API 时的 `ECONNREFUSED` 均为测试隔离/NetworkOnly 证据，对应断言全部 PASS。

## 现有 UI 问题修复（2026-08-24）

- 逐一读取 `现有ui问题/` 的 5 张复现图并写入 `docs/ui-issue-matrix.md`；该目录已加入 Git/Docker ignore，没有复制第三方品牌视觉，也没有素材下载失败。
- 删除无意义的旧房间中转页：创建、加入和旧 `/rooms/:roomId` 都直接进入全屏牌桌；未坐下即站起围观状态。
- 点击空座自动带入 100BB（受房间最小/最大值约束），不弹首次买入表单；Wallet 不足完整默认带入时禁止坐下。站起、再次坐下有资金守恒集成/E2E 回归；结算后 Stack=0 自动释放 Seat，不写 0 金额 CASH_OUT，也不再提示强制补码。
- 快捷底池加注显示明确金额；本轮后续按最新需求改为点击即提交，只有主加注按钮打开精确确认滑杆。Raise 的底池比例使用 call 后底池。原生 range 使用真实竖向布局，轨道不再漂移；牌面改成单角 Rank 与居中花色，去掉越界的倒置 Rank。
- 每手持久化唯一五张 `fullBoard`；普通投影仍只公开实际 Board。历史中首次“发发看”保存隐藏后缀，同一手对所有参与者一致，刷新、抽屉切换和手牌切换后直接恢复既有结果。
- 积分看牌和发发看仅保留在历史抽屉/历史详情；结算观察层不提供入口。历史中的技术性与重复否定文案已压缩。
- 左右抽屉支持向外侧滑关闭；两侧半透明入口支持纵向拖动并在本机记住位置。
- 新增本桌排行榜 API/左抽屉：按盈亏降序，展示入池率、胜率、本局总带入、盈亏；正数红、负数绿、零中性。离桌玩家可切换且灰度半透明，不显示活跃度积分；底部展示总带入、总底池、手数、平均底池、运行时间和在桌人数。
- 新增第 12 个 migration `20260824170000_ui_issue_fixes`，只增加/回填 `HandRecord.fullBoard` 及长度防线，不编辑旧 migration、不删除历史。

### 最终验收证据

- `pnpm@11.16.0 install --frozen-lockfile`、Prisma validate/generate、lint、typecheck、production build 均 PASS；Vite 8.2.1 构建 1,987 modules，PWA 预缓存 16 个静态条目。
- 专用测试库从空 schema 顺序应用 12 migrations PASS；Seed 第一次 `created=5, existing=0`，第二次 `created=0, existing=5`。升级测试实际验证三张旧 Board 与两张 `remainingDeck` 会回填为同一五张 `fullBoard`。
- 根级单元测试 411/411 PASS：Shared 23、Poker Core 143、Server 153、Web 92。Standard PostgreSQL integration 17 files / 154 tests PASS。
- Docker PostgreSQL Playwright 19/19 PASS（5.1 分钟）；其中资金守恒、快捷加注、抽屉拖拽/侧滑、排行榜、唯一发发看、0 Stack 自动站起和无弹窗 100BB 重坐均由真实浏览器覆盖。抽屉移动流程另连续复测 3/3 PASS。Production PWA Playwright 1/1 PASS。
- 固定种子模拟 10,000 hands：completed 10,000、failed 0、invariantFailures 0、sidePotHands 8,217、shortAllInHands 2,341。Docker Client/Engine 29.7.2、Compose 5.3.1；dev/test PostgreSQL 均 healthy；production Compose `config --quiet` PASS。
- `docker build -t wepoker:ui-issue-fixes .` PASS；容器内完成 frozen install、Web/PWA、Prisma、Server build 与 production deploy。Build context 439.22 kB，`现有ui问题/` 未进入镜像。

### 本轮真实失败与修复

- 首次完整 integration 为 153/154：旧升级测试硬编码 11 migrations。测试扩展为 12 migrations 并验证 `fullBoard` 数据回填后，目标测试及完整 154/154 均 PASS。
- 首次 E2E 为 15/19：两条旧断言仍依赖已删除的 Room 中转页/未格式化的 `2000` 文案；同步为直接牌桌跳转和 `2,000` 后对应 4/4 定向场景 PASS。
- 历史抽屉的真实鼠标侧滑暴露抬手命中竞态；实现增加 pointer capture，并在移动超过 72px 且横向意图明确时立即关闭，抬手仍作兜底。E2E 同时等待 180ms 入场动画完成后按稳定坐标操作；目标连续 3/3，最终全量 19/19 PASS。
- 裸 `docker compose ps` 按设计因未提供必填 Compose 变量而拒绝；使用项目的忽略测试环境文件后两个 PostgreSQL 服务均 healthy。所有最终门禁均使用显式环境，没有提交秘密。

## Step 6.5 实现

- 新增第 11 个 migration `20260824120000_step6_5_mobile_lifecycle`，未编辑既有 10 个 migration；增加手机号账号、手动开局/房间归档、保位离桌/输光状态、复盘/主动公开、整手付费授权、权威剩余牌堆和一手一个假想 runout 等持久模型与约束。
- 牌桌改为 2–9 人全屏移动舞台，不使用椭圆桌框；提供离散座位、Hero 底部视角、中心底池/公共牌/状态、顶部工具栏、左右抽屉、左上菜单、右上购物车、竖向加注器、安全区和 375/390/430 宽度适配。
- 房主必须在至少两名合资格玩家时手动开始；开始后连续发牌，人数不足只停发不停表。CLOSED/CLOSING 是终态，presence 更新不能把它降回 IDLE；软归档不删除 Game/Hand/Ledger。
- 一次性托管只对下一次行动生效：可过牌则 Check，否则 Fold；永不自动 Call/Bet/Raise，也不额外投入筹码。保位离桌保留 Seat 并进入托管，60 秒内可返回，过期只 cash-out 一次；活动手则安全延后到手末。
- Hero 手牌、实时牌型、行动倒计时、合法动作、快捷底池比例、min/max 和触摸/键盘竖向加注完整接入 typed Ack 与服务器校验；赢家反馈、发牌/Flop/Turn/River 事件动画和 Web Audio 原创短音均不改变权威 deadline 或状态。
- 0 筹码在 Review 清理后自动站起并关闭 Session；不产生无意义 cash-out，也不显示强制补码 UI。
- Settlement 完整提交后进入持久 `POST_HAND_REVIEW`；当前窗口已调整为 4 秒，连续发牌到期后直接开始。Review 内禁止提前开下一手和付费看牌，玩家可免费逐张主动公开本人底牌，仅已公开牌显示 Eye/高亮，截止竞态由牌桌串行队列和持久状态裁决。
- 右侧历史抽屉一手一页；旧逐目标授权升级为本手整手授权且不二次收费。整手购买在 Wallet/Hand 行锁内只产生一个 entitlement、一个 debit 和精确幂等响应；关系读取改为同一事务内顺序执行，消除 Prisma adapter-pg 对单 pg client 并发查询的 pg@9 弃用风险。
- 当时“发发看”只允许原参与者使用；2026-08-28 已升级为房间成员均可购买。新 Hand 使用持久化唯一 `fullBoard` 的隐藏后缀，legacy Hand 才从 `remainingDeck` 或排除真实牌的 CSPRNG 补齐；一手只持久化一份结果、所有购买者相同、不改原结算、不泄漏隐藏牌。
- 新用户使用 11 位手机号注册/登录，后端生成稳定内部 Username；同手机号并发最多成功一次并原子创建 Wallet/Initial Grant。旧开发账号可用当前密码一次绑定手机号，普通用户不可换绑；Profile/API 只返回 `1xx****xxxx`，公共房间/牌桌/历史不包含号码，认证日志 redact 原号码与凭据。本阶段没有短信、号码归属验证或实名认证。
- 当时的左侧聊天、积分购买、桌面皮肤、精彩对局、保险和发两次均为明确禁用的原创 UI 占位；没有消息/支付/保险/发两次后端、协议或假成功。精彩对局占位已按 2026-08-25 的后续要求删除。
- 16/16 张本地参考图已逐文件读取并映射到 `docs/ui-reference-matrix.md`；未复制 WePoker 品牌、Logo、水印、广告、网址、头像、牌背、字体或纹理。`学习素材/` 同时被 Git 与 Docker build context 忽略，原图未进入应用、PWA、镜像或提交。

## Step 6.5 最终验收（2026-08-24）

### 数据库、容器与构建

- Docker Client/Engine 29.7.2、Desktop 4.86.0、Compose 5.3.1、context `desktop-linux`；postgres-dev/test 均 healthy。
- 专用 `wepoker_test.public` reset 后从空库顺序应用 11 migrations PASS；Seed 第一次 `created=5, existing=0`、第二次 `created=0, existing=5`；Prisma validate PASS。
- `pnpm@11.16.0 install --frozen-lockfile` PASS；根级 lint、typecheck、test、production build/PWA 均 PASS。
- `docker build -t wepoker:step6-5 .` PASS；最终重建时 build context 为 25.53 kB，镜像应用目录没有 JPG/JPEG 或 `学习素材`。production Compose 使用无秘密占位值 `config --quiet` PASS，services 为 `db/app/caddy`，未启动公网环境。
- Poker 固定种子模拟：10,000 hands、seed 123456、completed 10,000、failed 0、invariantFailures 0、nativeProcessRetries 0、sidePotHands 8,217、shortAllInHands 2,341。

### 自动化数量

- Poker Core：19 files / 143 tests PASS；Shared：6 files / 22 tests PASS；Server unit：26 files / 152 tests PASS；Web unit：34 files / 86 tests PASS；根级总计 403 tests PASS。
- Standard PostgreSQL integration：17 files / 153 tests PASS，包含最终新增的双参与者并发假想 runout。
- Realtime：2 files / 27 tests；typed protocol：6 files / 22 tests；Web typed Ack：1 file / 5 tests；Runtime cleanup：1 file / 8 tests；Snapshot codec/repository：5 + 4 tests；Recovery component：1 file / 7 tests；true-process recovery：1 file / 13 tests；Settlement exactly-once：1 file / 7 tests；PostgreSQL concurrency：2 files / 11 tests，均 PASS。
- 最终 Docker PostgreSQL Playwright：19/19 PASS（4.7 分钟）；Step 6.5 专项：10/10 PASS（含真实 60 秒 deadline）；Production PWA Playwright：1/1 PASS。
- PWA build 使用 Vite 8.2.1，1,984 modules，Service Worker 预缓存 16 个静态条目；API/Socket/health/readiness 不缓存。

### 14 项、每项 10 次稳定性

- 9 人桌 430×932 布局：10/10；两轮底牌动画：10/10；Flop/Turn/River 动画：10/10（后两项由同一 E6/E7 实例分别断言）。
- 一次性托管：10/10；Reserved Away 真实 60 秒 deadline：10/10（12.2 分钟）。
- POST_HAND_REVIEW：10/10；主动公开与 Review Deadline 竞态：10/10（同一 E8 实例分别断言）。
- 最终代码的整手付费查看双 client 并发：10/10；发发看双参与者/双 client 并发：10/10。
- 输光补码：10/10；房间关停/软归档/历史保留：10/10；同手机号并发注册及原子 Wallet：10/10。
- Settlement Exactly-once：10/10；Flop true-process force-kill/restart：10/10。

最终矩阵为 70 个独立 Playwright test instance 和 50 个独立 Vitest 进程，共 120 次最终代码运行、覆盖 140 次规定场景断言；全部 `retries=0`、首错即停，没有无条件自动重试。

### Step 6.5 真实失败、诊断与修复

- E12 首次暴露 CLOSED 房间在 presence 变化后被手动开局判断降为 IDLE；调整恢复/评估优先级使 CLOSED/CLOSING 终态先于 manual-start，并补单元回归，随后专项与 10 次归档稳定性全 PASS。
- 完整 E2E 首轮在历史页面沿用了全屏牌桌的连接 selector；按实际 Room detail DOM 修正后该场景 PASS。下一轮为 18/19：旧 showdown 断言要求两个赢家，但固定 board 上口袋 K 实际组成 K full of 2 且是唯一赢家；改为按真实牌力断言唯一 winner，随后两次完整套件均 19/19。
- 整手付费并发最初全 PASS 但 pg@8 打出 `client.query()` 并行弃用警告；`--trace-deprecation` 定位到 Prisma adapter-pg 的 multi-relation include。改成锁内顺序关系读取后警告消失，typecheck、目标测试及最终 10/10、全量 153 integration 全 PASS。
- 两条 PowerShell 聚焦命令把 `E3|E4|E5` / `R6|R10` 中的管道符交给 cmd 解释，命令在测试启动前失败；之后只使用无管道的精确标题，未把未运行命令算作测试结果。
- 开发 Compose `ps` 首次误加载 `.env.docker.test`，因缺少 compose 所需 dev 变量被拒绝；改用只含双库容器变量的 `.env.docker` 后两个容器均 healthy。
- 手机号字面量静态扫描首次未给 ripgrep 开启 PCRE2，look-around 语法被拒绝；加 `--pcre2` 后扫描完成，命中仅为 development/test seed、测试 fixture 与其文档。
- 首次镜像媒体审计过宽，把 `@fastify/static` 生产依赖包自带的 4 个 `sample.jpg` 测试/示例文件当作项目资产；按正确边界排除 node_modules 后，应用目录 JPG/JPEG 0、`学习素材` 目录 0。参考图文件名、内容和品牌从未进入镜像。
- Playwright 关闭独立浏览器上下文时 Vite 偶发记录 `ECONNABORTED/ECONNRESET`；PWA 隔离检查故意在 API 未启动时记录 `ECONNREFUSED`。两者均为测试代理清理/NetworkOnly 证据，所有对应断言 PASS。
- Docker production deploy 报告 transitive `glob@11.1.0` deprecated，但 frozen lockfile supply-chain policy、应用构建、镜像导出全部 PASS；后续正常依赖维护时升级，不在本阶段越级改依赖。

最终静态审计：Critical 0、Important 0、Minor 0。生产源码无 TODO/FIXME/HACK、跳过/独占测试、`@ts-ignore`、eslint 绕过、`console.log`、`Math.random` 或 `as any`；Shared 核心实时协议无裸 `unknown` escape hatch。隐藏牌只投影为本人/公开/本人已购授权，手机号只出现在认证输入、数据库私有字段或本人掩码；日志、公共 Room/Table/History、DOM 辅助属性、PWA cache 和 Docker 均未发现泄漏。聊天、支付、保险和发两次后端搜索结果为 0。

## Step 6 实现

- 追加第 10 个 migration `20260820090000_step6_history_paid_reveal`；旧 9 个 migration 未编辑。
- Hand 结算持久化开手时冻结的积分看牌 enabled/cost；旧 Hand 安全默认不可购买。
- `PaidCardReveal` 以复合外键保证 Hand/Room/买方/目标参与者/Wallet debit 一致，并以业务唯一键和 RequestIdempotency 提供精确重放。
- 本人 GameSession/Hand keyset 历史、详情、筛选和 Profile/Wallet API；游标绑定当前 user、资源种类和筛选范围。
- 服务器在序列化前投影 OWN/PUBLIC_SHOWDOWN/PURCHASED/HIDDEN；HIDDEN 的 holeCards 固定为 null，浏览器、DOM、辅助文本、URL、日志、Ledger metadata 和缓存均不接收牌值。
- 从已提交 Hand/Player/Action/Pot 记录严格重建盲注、行动、街道、board、主/边池、folded dead money、未跟注返还、平分/奇数筹码、award 和最终 stack；不完整或不一致历史返回 `REPLAY_NOT_AVAILABLE`。
- 当时积分看牌只允许该手参与者；2026-08-28 已升级为房间成员均可购买。Wallet 锁内一次提交 debit/Ledger/授权/精确响应，费用销毁且不触碰 Table Stack/HAND_RESULT、不广播。
- Games、Game detail、Hands、Hand detail、Replay、Profile 和 Wallet 完整移动 Web 页面；中文流水标签、回放 previous/next/reset/play/pause/speed、昵称更新与实时座位昵称刷新。
- 2/6/9 人离散座位模板、本人视觉底部旋转、375×812/390×844/430×932、44px 触控、安全区、响应式底栏与 Lucide ISC 图标。
- PWA prompt 注册、原创 full-bleed maskable SVG、显式安全更新；活动手或 pending HTTP/Socket 写期间不 reload。Service Worker 只预缓存静态壳，API/Socket/health/readiness 全部 NetworkOnly/no-store。
- 离线统一禁用登录、创建/加入、房主命令、座位/筹码/行动、资料修改和积分看牌；恢复网络后请求服务器权威状态。
- Step 6 未下载第三方图片、字体或音效，没有素材缺失/下载失败，不需要占位图；来源和 Lucide 许可证已记入 asset log。
- 新增 `scripts/start-lan-test.ps1` 与 `pnpm dev:lan`：在 Windows PowerShell 一键启动 Docker 开发数据库、migration/Seed、Server 和绑定局域网的 Vite，供同一 Wi-Fi 手机访问；后端仅监听本机回环地址，支持私有防火墙规则、多网卡地址和退出清理。

## Step 6 最终验收（2026-08-20）

### 数据库、容器与构建

- Docker Client/Engine 29.7.2、Desktop 4.86.0、Compose 5.3.1、context `desktop-linux`、Server `linux/amd64`；postgres-dev/test 均 healthy。
- 专用空 `wepoker_test.public` 依次应用 10 migrations PASS；Seed 第一次 `created=5, existing=0`、第二次 `created=0, existing=5`；Prisma validate/generate PASS。
- Step 5 → Step 6 隔离升级测试 PASS；legacy hand 保持 non-revealable，hand number 回填不变。
- `pnpm install --frozen-lockfile` 与 lockfile supply-chain policy PASS。
- `docker build -t wepoker:step6-verify .` PASS；Linux 镜像内完成 frozen install、Argon2、Prisma、Server/Web/PWA build 和 production deploy，生成 `sw.js`。
- Production Compose 无必填变量时按设计拒绝；使用无秘密占位值后 `config --quiet` 与 `db/app/caddy` services PASS。本阶段未启动公网 Compose。

### 自动化数量

- Poker Core：18 files / 139 tests PASS。
- Shared：5 files / 18 tests PASS。
- Server unit：26 files / 143 tests PASS。
- Web unit：25 files / 57 tests PASS。
- 全仓 `pnpm test`：357 tests PASS。
- Standard PostgreSQL integration：17 files / 130 tests PASS。
- Replay builder：13 tests PASS；包括 fold、全街 showdown、side pot/all-in runout、odd chip、folded dead money、连续版本/行动状态机校验和拒绝不完整历史。
- Realtime：2 files / 20 tests PASS；Snapshot codec/repository：5 + 4 tests PASS；Recovery component：6 tests PASS。
- Process restart/fault injection：13 tests PASS；PostgreSQL concurrency：11 tests PASS；Exactly-once settlement：5 tests PASS；Runtime cleanup：8 tests PASS。
- Docker PostgreSQL Playwright：9 tests PASS；包含真实历史/积分看牌/Profile/Wallet、375×812/390×844/430×932 全资源页、2/6/9 座边界、Flop refresh、fold、showdown/replay。
- Production PWA Playwright：1 test PASS；真实注册 Service Worker、检查 manifest/maskable、枚举 Cache Storage、验证离线壳与写禁用。
- Mobile E7：375×812、390×844、430×932 的大厅、房间、2/6/9 桌、行动、历史、Hand Detail、Replay、Wallet、Profile 与关键 44px 控件均 PASS；满桌座位无 viewport/ring 越界或重叠。
- lint、typecheck、production build/PWA PASS。
- Poker simulation：10,000 hands，seed 123456，completed 10,000、failed 0、invariantFailures 0、nativeProcessRetries 0。

### 局域网手机测试启动器补充（2026-08-21）

- Windows PowerShell parser、`corepack pnpm lint`、`corepack pnpm typecheck` PASS。
- 使用 `-LanAddress 192.168.1.8 -RunForSeconds 35` 启动真实开发环境；从该局域网地址访问 Vite 首页和 `/health` 均返回 HTTP 200，页面标题为“牌友局”。
- 诊断结束后启动器清理 Server/Vite 进程树，无 3000、5173、5174 残留监听；PostgreSQL 默认按文档保留运行。
- 修复手机通过非安全局域网 HTTP 访问时浏览器不提供 `crypto.randomUUID()`，导致创建房间等持久写操作在发送请求前失败的问题；操作编号改由非安全上下文仍支持的 `crypto.getRandomValues()` 生成 RFC 4122 UUID v4。回归测试先稳定复现 `TypeError`，修复后 Web 25 files / 58 tests、lint、typecheck、production build PASS。

### 10 次独立稳定性

- Paid Reveal 不同 operation 双 PostgreSQL client 并发：10/10 PASS。
- Paid Reveal debit exactly once 与买方专属牌投影：10/10 PASS。
- Replay 三人全下 runout、主/边池和 unmatched return：10/10 PASS，同时覆盖 Side Pot 与 All-in Runout 两项要求。
- Step 5 Settlement 双 client Exactly-once：10/10 PASS。
- Flop true-process force-kill/fresh-process recovery：10/10 PASS。
- Nine-player 实时座位、按钮/盲注/actor 与 per-user 私牌：10/10 PASS。

以上为 50 个独立 Vitest 进程、70 个要求场景验证；遇错即停，无业务测试自动重试。完成后确认没有 `D:\wepoker` Node 进程或 3000/3104/5173/4173 监听残留。

### 真实失败与修复记录

- 首次当时的完整 E2E 为 7/8：9 座边界测试只等待 DOM count，瞬时读取到尚不可见节点的 0×0；改为逐座 condition-based visibility wait 后当时套件 8/8，扩充完整移动资源矩阵后的最终套件 9/9。
- 首次 Step 6 Docker build 在 Corepack 准备 pnpm 时退出 139；同一基础镜像独立验证 Node/Corepack/pnpm 成功，完全相同 build 再次执行后完整 PASS。生产 deploy 期间外部 npm registry 出现 ECONNRESET，pnpm 自身下载重试后成功；未把首次失败写成 PASS。
- 无变量 `docker compose -f compose.prod.yaml config` 按必填变量保护 FAIL；加入无秘密占位变量后静态配置 PASS。
- 一次 Docker info/ps 组合证据调用在 Docker 元信息响应超过 30 秒后转为会话等待；同一进程最终返回 linux/x86_64 与两个 healthy 数据库，EXIT 0。
- 最终聚焦命令第一次误用系统 pnpm 11.19.0，被仓库的 11.16.0 engine 门禁拒绝；改用 `corepack pnpm` 后相同测试、typecheck 全部 PASS。
- 一次稳定游标 EXPLAIN 在极小 fixture 上由 PostgreSQL 选择可等价完成过滤的索引加 Sort；测试事务禁用 Sort 后连续三次证明目标 cursor index 可用，随后全量 integration 17/130 PASS。

最终独立代码/隐私审查结论：Critical 0、Important 0、Minor 0，Ready to merge；所有确认问题均已补回归。最终 clean gate 包括 frozen install、Prisma validate/generate、空库 10 migration、幂等 seed、lint、typecheck、357 unit、130 integration、9 Docker E2E、1 production PWA E2E、production build/image、Compose 静态配置、`git diff --check`、端口/进程与生成物检查。

## Step 5 实现

- Docker Desktop + Windows PowerShell 标准 PostgreSQL 开发/测试环境：`postgres-dev` 55432、`postgres-test` 55433、独立 named volumes/healthcheck。
- 实测 Docker Client/Engine 29.7.2、Desktop 4.86.0、Compose 5.3.1、linux/amd64；PostgreSQL 17.10、`max_connections=100`。
- 应用池 `DATABASE_POOL_MAX=10`；两个独立 clients 观测至少两个 backend PID，并验证 Wallet/Seat/Close/Action/Settlement 真实锁竞争。
- 9 个 migration 从空标准 PostgreSQL 顺序部署；新增 `20260814013000_step5_durable_table_recovery`，旧 8 个未编辑。
- `TableSnapshot` Schema Version 1、CAS snapshotRevision、严格 Zod/关系/Poker/牌/筹码校验。
- `TableActionReceipt` 持久行动 fingerprint 与精确 result；重启/并发 exact replay。
- Step 5 Migration 按历史最大牌号回填 `Room.nextHandNumber`；开手事务在 Room 行锁内校正并单调分配。
- Snapshot CAS 冲突不应用候选状态；服务器重载并验证数据库权威 Snapshot、恢复 timer，失败时隔离为 RECOVERY_ERROR。
- 所有牌桌状态按 commit-before-runtime-before-broadcast；故障前回滚、故障后恢复 canonical Snapshot。
- Completed Hand settlement fingerprint、历史/HAND_RESULT/Seat/deferred/closing/Snapshot 同事务，Exactly-once。
- 启动恢复 active hand/deck/private cards/actor/stacks/version/deadline；future/expired timeout；CLOSING；legacy occupied；损坏隔离。
- `/health` 与 `/ready` 分离；migration/recovery/shutdown 影响 readiness。
- Runtime cleanup 接入生产路径；活动手/timer/错误状态不误删；graceful shutdown 等待队列并清 timer/socket/cache。
- 真实 child process 强制终止/重启、test-only fault injection 和 graceful SIGTERM harness。
- Shared 实时核心协议无 `unknown`；typed generic Ack/Zod round trip。
- Web 10 秒 Ack timeout、断线清 pending、action uncertain resync、不自动 replay action；安全持久命令手动复用 operationId。
- Session logout/revoke/expiry 主动断开；广播和开手持续复核，防止失效连接接收私牌或 ghost presence。
- Step 5 未新增或下载美术素材；无缺失素材、无占位图。

## 进程恢复覆盖

- R1 Preflop kill/recover。
- R2 Flop kill/recover。
- R3 Future Deadline。
- R4 Expired Deadline exactly once。
- R5 Action commit 后 Runtime 前、Runtime 后 broadcast 前、Receipt 前 rollback。
- R6 Settlement commit 后 Runtime 前、Runtime 后 broadcast 前。
- R7 Settlement commit 前 rollback。
- R8 LEAVE_AFTER_HAND。
- R9 SIT_OUT_AFTER_HAND。
- R10 active Room CLOSING。
- R11 corrupt/unsupported Snapshot → RECOVERY_ERROR。
- R12 occupied legacy Room → safe IDLE Snapshot。

## 数据与安全不变量

- 所有积分整数 `0..2_000_000_000`；整桌 aggregate 和最坏赢家可带出检查。
- Wallet/Table paired ledgers、GameSession、Seat、Hand actor/HAND_RESULT participant 由复合外键/CHECK/unique 提供最终防线。
- Snapshot/Deck/Remaining Deck/未公开 Hole Cards/Session/Cookie/DATABASE_URL 不记录、不广播。
- PERSISTENCE_ERROR/RECOVERY_ERROR 投影不泄漏未提交或无法验证的 hand/stacks。

## Step 5 最终验收（2026-08-14）

### 数据库与容器

- Docker Client/Engine 29.7.2、Desktop 4.86.0、Compose 5.3.1、context `desktop-linux`、Server `linux/amd64`；hello-world PASS。
- `postgres-dev` / `postgres-test` 均 healthy；实际 PostgreSQL 17.10，`max_connections=100`，应用 pool max 10。
- 四条同时活跃连接观察到 4 个不同 backend PID：22248、22255、22269、22276；真实多连接 PASS。
- 空 `wepoker_test.public` 依次应用 9 migrations PASS；Seed 第一次 `created=5, existing=0`，第二次 `created=0, existing=5`。
- `docker build -t wepoker:step5-verify .` PASS，Linux 镜像内执行 frozen install、Prisma generate、Server/Web/PWA build 和 production deploy。首次构建因 Docker Hub frontend OAuth 网络超时 FAIL；移除未使用的 syntax frontend 依赖、从官方公共 ECR mirror 拉取同 digest Node 基础镜像后构建成功。
- 开发 Compose config/services/up/ps PASS。Production Compose 不带必填变量的首次 config 按设计 FAIL；使用无敏感占位变量后 config/services PASS，未进行公网部署。

### 自动化数量

- Poker Core：18 files / 139 tests PASS。
- Server unit：25 files / 127 tests PASS。
- Shared protocol：2 files / 9 tests PASS；typed acknowledgement：5 tests PASS。
- Web full unit：5 files / 13 tests PASS。
- Standard PostgreSQL database integration：16 files / 113 tests PASS（普通 `test:integration` 默认 migrate + Docker 标准测试库）。
- Realtime：2 files / 19 tests PASS。
- Snapshot：codec 4 + repository 4 = 8 tests PASS。
- Recovery component：6 tests PASS。
- Process restart/fault injection：13 tests PASS。
- PostgreSQL concurrency：10 tests PASS。
- Step 4 → Step 5 隔离 schema Migration upgrade：1 test PASS。
- Exactly-once settlement：5 tests PASS。
- Runtime cleanup：8 tests PASS。
- Docker PostgreSQL Playwright：5 tests PASS（买入带出、375×812、Flop refresh、fold、showdown）。
- 全仓 `pnpm test`：Poker 139 + Shared 9 + Server 127 + Web 13 = 288 tests PASS。
- lint、typecheck、build/PWA、`git diff --check` PASS。
- Poker simulation：10,000 hands，seed 123456，completed 10,000、failed 0、invariantFailures 0、nativeProcessRetries 0。

### 10 次独立稳定性

- 九人实时桌：10/10 PASS。
- Action/Timeout race：10/10 PASS。
- Settlement Exactly-once：10/10 PASS。
- Action Receipt PostgreSQL concurrency：10/10 PASS。
- Runtime cleanup：10/10 PASS。
- Flop true-process force-kill/restart recovery：10/10 PASS。

共 60 个独立进程运行，遇错即停，无业务测试自动重试。完成后确认无 recovery/E2E 孤儿 Node 进程。

### 主要实际命令

PASS：`docker version`、`docker desktop version`、`docker compose version`、`docker info`、`docker run --rm hello-world`、开发 Compose config/services/up/ps、PostgreSQL version/user/database/max_connections 查询、`pnpm install --frozen-lockfile`、`db:validate`、空库 reset/migrate/seed×2、全部专项测试脚本、`lint`、`typecheck`、`test`、`build`、`test:e2e:docker`、10,000-hand simulate、Dockerfile build、`git diff --check`。

FAIL 后已修复并重新验证：首次 Dockerfile build（外部 frontend OAuth 超时）；首次无变量 production Compose config（必填变量保护）；Docker Compose contract 测试最初从错误的 package scope 读取 `test:integration`；Snapshot conflict 修复后的首次 lint 命中 3 个 `no-ex-assign`；一次并发运行遗留进程导致重叠 integration 认证失败；两个一次性只读检查命令的 PowerShell/引号写法错误。另有两条组合证据命令分别因未加载 `.env.docker` 和 Docker 元信息查询超时而整体 FAIL；其中已完成的子命令单独记录，未执行部分随后以正确独立命令通过。所有失败均未被误报为 PASS，业务测试未使用自动重试。

独立代码复核结论：Critical 0、Important 0；手牌编号升级回填、自愈式分配、Snapshot conflict 权威重载与普通 `test:integration` Docker PostgreSQL 入口均经回归测试确认。

## 已知限制

- 只支持一个活动应用实例；没有 Redis、消息队列、跨实例 table lease、多副本或跨区域。
- 无 RECOVERY_ERROR 在线牌局修复或 Snapshot 编辑；仅支持完整备份后的管理员安全关闭。无未知 Snapshot Schema 自动升级。
- 无正式公网部署、生产备份/恢复/告警完成声明。
- 无管理后台、管理员敏感审计读取、聊天、好友、头像上传、音效、支付或真钱能力。
- 移动端界面完整可用但不是最终品牌美术；真实 iPhone Safari/Android Chrome 上线前仍需设备手工验收。

## 下一阶段（未开始）

这是 Step 6 验收时的历史停止点：当时 Step 7/8 均未开始，也未创建 tag 或进行公网部署；当前权威状态以本文顶部 Step 7 小节为准。
