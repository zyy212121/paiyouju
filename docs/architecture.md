# 系统架构

## 边界与依赖

```text
React/PWA ── HTTP + typed Socket.IO ──> Fastify/Realtime
                                                │
                                 ┌──────────────┴──────────────┐
                                 v                             v
                           Poker Core                  PostgreSQL 17
                         (pure domain)          (authority + audit log)
```

- `packages/poker-core` 无数据库、系统时间和隐式随机数，负责规则、下注、边池、评牌和守恒校验。
- `packages/shared` 用严格 Zod Schema 定义网络 DTO、事件、错误和泛型 acknowledgement；核心实时协议无裸 `unknown`。
- `apps/server` 负责 Cookie 身份、房间/历史权限、单桌队列、计时、事务、恢复、回放验证与按接收者投影。
- `apps/web` 只呈现权威投影和提交意图，不乐观计算筹码、牌、底池或胜者；PWA Service Worker 只缓存静态壳。

## 单实例 Runtime 与持久权威

当前部署边界是一个活动 Fastify/Socket.IO 进程和一个标准 PostgreSQL 数据库。`TableRuntimeManager` 为每个已加载 Room 维护一个内存 Runtime 和一个 `SerializedQueue`；不同桌可并发，同一桌严格串行。多应用实例同时管理同一牌桌不受支持，也没有租约或跨进程协调。

内存用于低延迟执行，但 PostgreSQL 保存最后一次已提交的权威状态。每个成功转换遵循：

```text
Prepare candidate
→ validate Poker + accounting invariants
→ lock Room/Snapshot/resources
→ commit Snapshot/Receipt/Settlement transaction
→ update in-memory Runtime
→ project separately for each recipient
→ broadcast
```

数据库失败或 CAS 冲突时不更新 Runtime、不广播候选结果。持久化失败会冻结该桌；恢复失败会进入 `RECOVERY_ERROR`。

## 持久化组成

- `TableSnapshot`：Schema Version 6 的完整进行中权威状态与 CAS revision；健康 v1–v5 以安全默认读取并在后续提交升级。
- `TableActionReceipt`：玩家行动 fingerprint 和精确 typed result，唯一键 `(roomId,userId,clientActionId)`。
- `Room.nextHandNumber`：Migration 从历史牌局回填，开手在 Room 行锁内校正并分配手牌号。
- `HandRecord` 及 Player/Action/Pot/HAND_RESULT：只保存已经完成并原子结算的手。
- `PaidCardReveal`：只保存已结算手的买方授权，并与唯一 Wallet debit 复合关联。
- `RequestIdempotency`：选座、买入、sit-out、return、leave 等持久命令的精确重放。

Snapshot 与 Seat/Room 持久关系必须一致；牌局还通过 Poker Core 不变量、标准 52 张或短牌 36 张牌唯一性、actor/action sequence、筹码守恒验证。Snapshot payload 永不发送给浏览器或写入普通日志。

## 启动、恢复与就绪

Server 建立数据库连接后，扫描 CLOSING 房间、现存 Seat 和 Snapshot：

1. 读取 Room/Seat 与 Snapshot；
2. 严格反序列化并校验关系、牌与筹码；
3. 恢复 Runtime、当前手和原绝对 deadline；
4. deadline 已过则将唯一 timeout 排入该桌队列；
5. 恢复 CLOSING 的完成手/座位会话关闭流程；
6. 所有房间隔离处理完成后才标记 recovery complete。

`/health` 只说明进程事件循环可响应；`/ready` 还要求数据库可访问、31 个 migration 已完成、启动恢复结束且没有进入停机阶段。单个损坏房间会计入 degradedRooms，但不会阻止其他房间服务。

## 历史与回放投影

历史查询从 `GameSession` 或 `HandPlayerRecord.userId` 开始，先把所有权写进数据库条件，再组装 DTO。详情为 discriminated card projection：隐藏分支只含 `holeCards: null`；付费授权查询也带当前 viewer。回放不是浏览器重演原始数据库对象，而是服务器验证 Hand/Player/Action/Pot 的序列、盲注、全部已投入筹码入池、赢家金额和最终 stack 后产生的确定性领域事件。验证失败时拒绝回放，不用猜测补齐。

## PWA 边界

Vite PWA 以 prompt 模式注册。Workbox 预缓存构建产生的静态壳，并对 `/api`、`/socket.io`、`/health`、`/ready` 明确使用 NetworkOnly/deny；HTTP 客户端也设置 `cache: no-store`。离线状态由前端统一 store 驱动写操作禁用。Service Worker 发现更新后只显示提示；当前手存在或任一 HTTP/Socket 写仍 pending 时禁止激活 reload。

## Socket、身份和隐藏信息

HTTP 与 Socket 只使用 `wepoker_session` HttpOnly/SameSite Cookie。Socket 握手校验精确 Origin；每条入站事件、广播与开手参与者准备都会复核 Session。logout 会立即撤销 Session 并主动断开该 Session 的所有 Socket；自然过期由服务器定时断开。

每个 Socket 单独生成白名单投影：只给本人私牌、只给当前行动者 legal actions、只公开 showdown 允许的牌。Deck、remaining deck、future board、其他人的私牌、Session token、内部 cache 和 Snapshot 永不进入网络 DTO。

## 计时与并发

房主首次手动开始后的开手倒计时、行动计时、60 秒保位期限和 4 秒 Review 都保存绝对时间。Timer 只是触发器；真正执行时在单桌队列和 Snapshot 行锁下复核 handId、actor、Poker stateVersion、deadline。超过 deadline 的玩家行动即使 timer 回调尚未被事件循环调度也会拒绝。

数据库连接池由 `DATABASE_POOL_MAX` 控制，Docker 开发/测试为 10；标准 PostgreSQL `max_connections=100`。独立 Prisma clients 已验证真实 backend PID、Wallet/Seat/Close/Action/Settlement 锁竞争。

## 清理与停机

CLOSED 且无 Seat/Presence/Hand/Timer 的 Runtime，以及 OPEN 且完全空闲的 Runtime，可安全驱逐；活动手、timer、`PERSISTENCE_ERROR`、`RECOVERY_ERROR` 不会被普通清理误删。驱逐会取消 timer、清 action cache、释放 presence 和对象引用。

SIGINT/SIGTERM 先让 `/ready` 返回 503，拒绝新命令，dispose 所有控制器，等待队列完成，再关闭 Socket.IO、Runtime、Fastify 和数据库。进程级测试同时覆盖 graceful shutdown 与不会运行 finally hook 的强制终止。

## 部署边界

```text
开发：Browser → Vite :5173 → Server :3000 → postgres-dev :55432
测试：isolated test process             → postgres-test :55433
未来：Browser → HTTPS/WSS proxy → one app → PostgreSQL
```

Docker Desktop 使用 WSL 2 Linux 后端，但仓库继续位于 `.`。当前不包含 Redis、消息队列、多副本、跨区域、短信、支付或真钱后端。

## Step 6.5 组件边界

- Realtime 生命周期命令负责房主开始、一次性预操作、常驻托管、鱿鱼离桌确认、保位离桌、返回、待亮牌切换、行动加时和房间到期；全部进入原单桌串行队列。
- 结算从 `PLAYING` 进入持久 `POST_HAND_REVIEW`；4 秒展示结束后，满足条件时直接开下一手，不再插入第二个等待/倒计时阶段，否则进入等待房主或关闭流程。
- History 模块新增整手授权和模拟补牌两个独立事务服务；它们只读取完成历史，不接触 Poker Runtime 结算。
- Account 模块把手机号注册/登录/一次绑定与公共资料投影分离；完整号码不跨认证边界。服务端注册时从固定 16 项头像库随机分配头像，Profile 仅允许白名单切换；昵称或头像变更会在单桌队列中刷新活动座位投影并持久进入 Snapshot。
- CLOSED 软归档只影响列表查询，不改变 Room 所有权和历史外键。

## Step 7 运维架构

Admin 模块与现有 Fastify/Prisma 服务共用认证和领域 Service：查询只返回白名单投影，Adjustment 在 Wallet/Ledger/AuditLog 单事务内完成。AuditLog 追加写入；Recovery 管理提供严格 Revalidate/Retry，以及仅对持续 `RECOVERY_ERROR` 生效的备份后安全关闭，后者废止未完成手牌并按关系型后手关闭会话，不编辑损坏 payload。生产拓扑固定为单 Caddy、单 App、单 PostgreSQL 和一次性 Migration Job；当前暴击扩展使用 Protocol v9，仍不引入 Redis、消息队列或多实例 lease。

## 鱿鱼模式边界

鱿鱼规则位于 Table lifecycle/hand persistence 领域，不进入 Poker Core 的下注、分池或牌力算法。Poker Core 只提供已结算主池及赢家；Server 在本手完成事务中决定唯一主池赢家、授标、结算、自动补点和下一轮 10 秒提示。Room/Seat/Snapshot/Stack Ledger 是权威，Web 只显示标记并提交带确认的意图，不能指定结算对象或金额。

## 短牌模式边界

短牌模式把变体参数显式传入 Poker Core。Core 负责生成 6–A 的 36 张牌组、A-6-7-8-9 顺子、同花高于葫芦的比较，以及结算/快照不变量；所有调用默认仍是标准 52 张规则，避免旧牌局语义漂移。Server 根据 Room 模式选择牌组并把变体冻结进 Hand State，恢复时以 Snapshot v5 复核整副牌的数量和范围。

短牌的上下限规范化发生在权威 Hand Result 已完成之后、离桌清理之前的同一事务：Poker 输赢仍保存为零和记录；低于下限写 Hand 关联 BUY_IN，高于上限写 Hand 关联 CASH_OUT，再更新 Seat 与 GameSession 累计带入/带出。Web 只能配置上下限和显示规则，不能提交结算后的目标后手。
