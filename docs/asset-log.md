# 视觉与媒体资产日志

本日志用于长期记录图片、图标、字体、音效及其他媒体资产的来源、许可证和占位状态。当前项目不限定具体美术风格，但界面应尽可能完整；素材缺失或下载失败时允许用明确标识的占位素材继续开发。

## 记录规则

每次新增或替换资产时记录：

- 资产路径与使用位置；
- 类型：原创、代码生成、开源第三方或占位；
- 作者/来源链接与许可证（原创也需注明）；
- 若为占位：缺失或下载失败原因、记录日期、受影响范围、替换条件；
- 替换后保留历史记录，并标记替换日期与新资产信息。

不得使用来源不明、许可证不兼容、第三方商标、专有图片/音效或受版权保护的扑克产品素材。占位素材也必须满足这些要求。

## 当前资产

| 资产 | 使用位置 | 类型 | 来源 / 许可证 | 占位状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `apps/web/public/icon.svg` | 浏览器图标、PWA manifest、Apple touch icon | 项目原创 SVG | Stage 0 由项目代码直接绘制；随本项目使用，不含第三方素材 | 否 | 抽象牌形开发图标，不使用第三方商标 |
| `apps/web/public/icon-180.png`、`icon-192.png`、`icon-512.png` | iOS 主屏幕与 PWA manifest | 原创 SVG 的机械派生 PNG | 2026-08-13 使用 ImageMagick 7.1.1 从 `icon.svg` 生成；许可证状态同原 SVG | 否 | 分别为 180×180、192×192、512×512；未引入外部素材 |
| Stage 0 首页背景与装饰 | `apps/web/src/App.tsx`、`apps/web/src/styles.css` | CSS 代码生成 | 项目原创 CSS；无外部二进制素材 | 否 | 当前不设最终美术风格 |
| Step 4 牌桌、卡牌、筹码/座位标记、连接指示和基础动画 | `apps/web/src/components`、`apps/web/src/styles.css` | 项目原创 HTML/CSS 代码生成 | 2026-08-13 由项目代码直接绘制；花色使用系统 Unicode 字形；无外部下载、第三方商标或专有素材 | 否 | 满足可操作 H5；未来若采用委托美术，替换前须补充来源与许可证 |
| Step 5 恢复与可靠性阶段 | 无新增素材文件 | 不适用 | 2026-08-14 未新增、未下载任何美术素材；没有素材缺失或下载失败 | 否 | 无需占位图；继续复用现有原创 HTML/CSS 牌桌 |
| `apps/web/public/icon-maskable.svg` | PWA manifest maskable 图标 | 项目原创 SVG | 2026-08-20 由项目代码直接绘制；随本项目使用，不含第三方素材 | 否 | full-bleed 安全区构图，不复用透明圆角普通图标 |
| Step 6 导航与操作图标 | Web 页面和移动底栏 | 开源第三方图标组件 | Lucide Contributors，ISC License，`lucide-react@1.32.0`；通过 `corepack pnpm --filter @paiyouju/web add lucide-react` 安装 | 否 | 使用 Home、History、WalletCards、UserRound、LogOut 等通用线性图标；不使用第三方扑克产品商标 |
| Step 6 牌桌、历史、回放与 PWA 视觉 | `apps/web/src/components`、`apps/web/src/pages`、`apps/web/src/styles` | 项目原创 HTML/CSS/SVG 代码生成 | 2026-08-20 由项目代码直接实现；无外部图片、字体或音效下载 | 否 | 没有素材缺失或下载失败；当前无音效，不需要占位素材 |
| Step 6.5 的 16 张需求参考图 | `.\学习素材`（仅本地参考） | 非分发参考，不是产品资产 | 用户提供；文件名作为需求说明；版权/再分发许可未授予，因此目录被 Git 忽略 | 否 | 16/16 已读取并映射；原图、品牌、广告、网址、头像、字体、牌背和桌面纹理不复制、不发布、不进入 Build/PWA/Docker |
| Step 6.5 全屏牌桌、卡牌运动、赢家反馈 | `apps/web/src/features/table/mobile`、`apps/web/src/styles/table.css` | 项目原创 HTML/CSS/SVG 代码生成 | 2026-08-24 由项目代码直接实现；花色为系统 Unicode；无外部位图 | 否 | 当前美术非最终版但状态完整；未来替换需补来源/许可证 |
| Step 6.5 牌桌提示音 | `apps/web/src/features/table/mobile/useTableSound.ts` | 项目原创 Web Audio 代码生成 | 2026-08-24 使用浏览器 Oscillator/Gain 实时生成；无下载文件、无第三方采样 | 否 | 发牌、公共牌、筹码、菜单和赢家短音；可关闭/可降级 |
| Step 6.5 功能占位视觉 | 保险 | 项目原创 HTML/CSS 文字占位 | 2026-08-24 由项目代码生成；不含外部素材 | 是 | 聊天占位已于 2026-08-29 替换为真实文字聊天；发两次已于 2026-08-30 实现；“精彩对局”已于 2026-08-25 删除，钻石购买占位于 2026-08-27 删除 |
| 房间文字聊天与头像气泡 | `ChatDrawer`、`PlayerChatBubble`、`table.css` | 项目原创 React/CSS 与系统 Unicode Emoji | 2026-08-29 由项目代码直接实现；Send/MessageCircle 复用已登记的 Lucide ISC 图标；无外部图片、字体或音频 | 否 | 气泡、箭头、分段替换和输入界面均由代码绘制；没有素材缺失或下载失败。语音聊天受不可变产品边界永久禁止，不属于缺失素材 |
| “现有 UI 问题”5 张复现图 | `.\现有ui问题`（仅本地缺陷证据） | 非分发参考，不是产品资产 | 用户提供；图片名为问题描述；版权/再分发许可未授予，因此目录被 Git 与 Docker 忽略 | 否 | 5/5 已读取，尺寸与修复映射记录在 `docs/ui-issue-matrix.md`；图片本身不提交、不进入 Build/PWA/Docker |
| 本轮排行榜、抽屉手势、竖向加注与牌面修复 | Web HTML/CSS/Unicode/Lucide | 项目代码生成 | 2026-08-24；无外部下载，无新增位图 | 否 | 当前美术非最终版但功能完整；没有缺失或下载失败素材，因此未新增占位图 |
| 登录卡片紧凑布局与 Origin 提示 | `apps/web/src/pages/AuthPage.tsx` | 项目原创 HTML/CSS | 2026-08-24；仅删除冗余行并调整现有 CSS utility | 否 | 无新增或缺失素材，不需要占位图 |
| 本轮逐张翻牌、亮牌高亮、密码眼睛与抽屉固定布局 | Web HTML/CSS/Unicode/Lucide | 项目代码生成与既有 ISC 图标库 | 2026-08-24；未下载图片、字体或音效，无下载失败 | 否 | 牌背/翻面与高亮均由 CSS 生成，Eye/EyeOff 复用已记录的 `lucide-react`；不需要占位图 |
| 本轮头像座位、筹码投入与自动行动按钮 | `PlayerSeat`、`HeroHand`、`PokerChip`、`ActionPanel` 与 `table.css` | 项目原创 HTML/CSS/Unicode/Lucide | 2026-08-24；头像使用昵称首字和确定性色彩，筹码/牌背/状态由代码绘制；未下载图片、字体或音效 | 否 | 参与、弃牌、站起、公开牌和按下态均有完整代码视觉；没有素材缺失或下载失败，不需要占位图 |
| 房间倒计时、加时提示、本人头像与待亮牌状态 | `CreateRoomPage`、`TurnUrgencyOverlay`、`HeroHand`、`PlayingCard`、`table.css` | 项目原创 HTML/CSS/Web Audio 与既有 Lucide ISC 图标 | 2026-08-25；全部由代码生成，未下载图片、字体或音频 | 否 | 加时脉冲、紧凑“10”、头像/牌面状态和提示音均无外部素材；没有下载失败，不需要占位图 |
| Step 7 管理后台与运维界面 | `apps/web/src/features/admin` | 项目原创 React/CSS 与既有 Lucide ISC 图标 | 2026-08-25；无外部图片、字体或音效下载 | 否 | 管理页复用现有设计系统；不建立第二套品牌或图标库 |
| Step 7 音效回归 | `useTableSound.ts` | 项目原创 Web Audio 代码生成 | 2026-08-25；复用现有 Oscillator/Gain 信号链，无采样、无下载 | 否 | 用户手势解锁、音量/静音、后台、重连与 PWA 均只做回归；没有缺失素材或占位音效 |
| 钻石费率、逐张动态展示与归档交互 | Lobby、Wallet、牌桌菜单、`HeroHand` | 项目原创 React/CSS 与既有 Lucide ISC 图标 | 2026-08-27；Diamond/Eye/Archive 复用仓库现有 `lucide-react`，未下载图片、字体或音频 | 否 | 本轮无素材缺失或下载失败；头像、牌框、半透明 Eye 和确认层均由代码生成，不需要占位图 |
| 围观历史、行动状态、10 档补点与防息屏 | `PlayerSeat`、`SeatRing`、`BuyInModal`、`useScreenWakeLock` | 项目原创 React/CSS 与浏览器标准 API | 2026-08-28；未下载或新增图片、字体、图标、音频 | 否 | 本轮没有素材缺失；全下/动作文字、牌背、筹码和倒计时沿用代码绘制资产，不需要占位图 |
| 可听牌桌音效与全押公共牌节奏 | `useTableSound.ts`、`useCommunityRunoutPresentation.ts` | 项目原创 Web Audio 与 React 计时 | 2026-08-27；Oscillator/Gain 在浏览器实时生成，无采样、下载或第三方素材 | 否 | 修复首次进入被错误初始化为 0 音量，增加 Safari AudioContext 兼容和更清晰包络；公共牌节奏不需要音频占位文件 |
| 男/女行动语音与坐下/站起 WAV（12 个） | `apps/web/public/audio/table/voices/{male,female}`、`apps/web/public/audio/table/sfx` | 项目所有者提供的正式音频 | 2026-08-28 由项目所有者直接放入仓库并明确指示用于本项目，按其自有或已获授权素材登记；未提供外部下载 URL 或第三方品牌 | 否 | 男/女各 5 个：call、raise、check、fold、allin；坐/站各 1 个。移动前验证 RIFF/WAVE；若所有者授权状态改变，发布前必须替换或移除 |
| 鱿鱼标记、新轮动画与提示音 | `SquidBadge.tsx`、`table.css`、`useTableSound.ts` | 项目原创 SVG/CSS/Web Audio | 2026-08-30 由项目代码直接绘制和实时生成；无外部图片、字体、采样或下载 | 否 | 标记尺寸按 Dealer/盲注标记体系约束；提示音为三段 Oscillator/Gain 包络。没有素材缺失或下载失败，不需要占位素材 |
| 发两次协商、双排公共牌与逐副结果 | `RunoutChoiceOverlay.tsx`、`DoubleRunoutBoard.tsx`、`table.css`、`useTableSound.ts` | 项目原创 React/CSS/Web Audio | 2026-08-30 由项目代码直接绘制并复用既有原创卡牌和浏览器振荡器提示音；无外部下载 | 否 | 5 秒协商、320px 紧凑双排牌面、逐街翻牌及逐副结果均为代码资产；没有素材缺失或下载失败，不需要占位素材 |
| 机器人房间模式行为同步 | 无新增媒体资产 | 不适用 | 2026-08-30 仅调整测试机器人协议行为、报告与自动化测试；无图片、图标、字体或音频变更 | 否 | 普通局发两次及鱿鱼离桌分支均复用现有产品能力；没有素材缺失或下载失败，不需要占位素材 |
| `apps/web/public/avatars/cartoon-avatar-sheet.webp` | 注册随机头像、个人资料头像选择器、本人及其他玩家牌桌头像 | 项目原创生成位图 | 2026-08-31 使用 OpenAI 内置图像生成能力按本项目专用提示生成，随后使用 ImageMagick 转为 512×512 WebP；不含第三方商标、文字、现有角色或外部下载素材，随本项目使用 | 否 | 4×4 等分精灵图，共 16 个原创卡通头像；CSS 圆形裁切安全，48px 仍可辨识。原始生成提示要求“exactly 16、strict uniform grid、original friendly adult/animal characters、no text/logos/cards/chips/watermarks/copyrighted characters”。没有下载失败，也不需要占位图 |
| 2026-08-31 动作语音替换与胜利 WAV（11 个） | `apps/web/public/audio/table/voices/{male,female}`、`apps/web/public/audio/table/sfx/win.wav` | 项目所有者提供的正式音频 | 项目所有者放入根目录 `音效/` 并明确要求用于本项目，按其自有或已获授权素材登记；10 个 `*_boy/*_girl` 按动作复制替换现有男女声，`win.wav` 新增为本人派奖音效 | 否 | 复制前后逐文件 SHA-256 相同，11 个文件均验证为长度自洽的 RIFF/WAVE。胜利音只在当前登录玩家属于任一主池、边池、平分池或发两次分支的赢家时播放；没有外部下载、失败或占位素材 |
| `fashoupai.wav`、`fapai.wav`、`daojishi.wav`、`youyu.wav` | `apps/web/public/audio/table/sfx` | 项目所有者提供的正式音频 | 2026-08-31 由项目所有者放入根目录 `音效/` 并明确指定底牌动画、公共牌、最后三秒和鱿鱼新轮用途，按其自有或已获授权素材登记 | 否 | 复制后 SHA-256 与源文件逐一相同，均为长度自洽的 PCM RIFF/WAVE；持续时间约 0.84/0.24/1.02/5.91 秒。没有外部下载、失败或占位素材 |
| `chipfly.wav` 与筹码归置动画 | `apps/web/public/audio/table/sfx/chipfly.wav`、`ChipAwardAnimation.tsx`、`table.css` | 项目所有者提供的正式音频 + 项目原创 CSS | 2026-08-31 由项目所有者放入根目录 `音效/` 并明确指定结算筹码归置用途，按其自有或已获授权素材登记；飞行筹码由项目代码绘制 | 否 | 源/目标 SHA-256 均为 `0D07F48B8F3AD5709BA164DBE0B817EEFEA4DF5B2C56B5551D286D06B7AC9422`；主池、边池、平分和正数纯退回均按收款座位生成动画，整批只播放一次采样。没有下载失败或占位素材 |

## 未解决占位项

没有素材下载失败。文字聊天与普通模式发两次已使用项目原创代码完成；保险仍按需求使用项目原创代码占位，“精彩对局”、桌面皮肤入口和钻石购买入口不再显示。这些不是缺图造成的功能缺失，替换条件见上表。若未来最终美术素材缺失或下载失败，继续使用当前原创牌桌并在本表新增逐项记录。
