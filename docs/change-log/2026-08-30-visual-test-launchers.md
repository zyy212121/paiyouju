# 可视化测试启动器与房间日志总开关

## 变更边界

- 基线提交：`428349b`（可回退连接探针）。
- 新增两个 Windows WinForms 面板及根目录双击入口，不替用户启动 Docker，也不在安装、构建或测试期间启动 Server、Web 或机器人。
- 1号探针对应 `ADMIN_ROOM_FILE_LOG_ENABLED`，是管理员房间文件 Log 总开关；关闭时 `SNAPSHOT`、`COMMAND`、`CONNECTION_PROBE` 均不写入。
- 2号探针对应 `ADMIN_ROOM_CONNECTION_PROBES_ENABLED`，当前只控制连接、订阅、Session、状态同步和开手门槛诊断；1号关闭时2号即使勾选也不写入。
- 3–5号只存在于 UI，保持可勾选但不设置环境变量、不进入 Server、不产生日志。
- 机器人面板只设置既有 `WEPOKER_BOT_COUNT/ROOM_CODE/ROOM_PASSWORD`，不改变机器人策略、频率、账号租约或房间发现规则。密码通过继承的进程环境传递，不拼入 PowerShell 命令或窗口标题。

## 文件清单

- `start-test-ui.cmd`
- `start-bots-ui.cmd`
- `scripts/start-lan-test-ui.ps1`
- `scripts/start-random-bots-ui.ps1`
- `package.json`
- `.env.example`
- `.env.production.example`
- `apps/server/src/config/environment.ts`
- `apps/server/src/config/environment.test.ts`
- `apps/server/src/modules/tables/room-file-diagnostic-log.ts`
- `apps/server/src/modules/tables/room-file-diagnostic-log.test.ts`
- `apps/server/src/realtime.ts`
- `tools/system-test-runner/src/visual-launcher.test.ts`
- `docs/local-lan-test.md`
- `docs/random-test-bots.md`
- `docs/operations.md`
- `docs/table-diagnostic-trace.md`
- `docs/PROGRESS.md`

## 验证记录

- 两个 PowerShell 5.1 脚本均为 UTF-8 BOM，Parser error 为 0，`ValidateOnly` 分别返回 `LAN_TEST_UI_OK` 与 `BOT_TEST_UI_OK`，没有显示窗口或启动运行进程。
- 1号关闭回归覆盖 Command、Snapshot 和 Connection Probe，并确认不会查询房间元数据；配置回归覆盖 development/test 默认开启、production 默认关闭及显式覆盖。
- 启动器回归确认1–5号控件、双击入口、机器人三个既有参数均存在，机器人子进程命令正文不包含密码变量。
- 最终 Lint 零警告、`git diff --check`、workspace TypeScript、Production Build、139 files / 664 tests 全部通过。
- 验证期间没有启动 Docker、PostgreSQL、Server、Web 或机器人，也没有占用 3000/5173。

## 使用与回退

运行时停用全部房间文件 Log：在测试面板取消勾选1号探针并重新启动测试。只停用动态连接诊断：保留1号、取消2号并重新启动。停用只阻止新行写入，不删除以前生成的日志文件。

如需撤销本次代码、保留底池修复和上一版连接探针：

```powershell
Set-Location D:\wepoker
$launcherCommit = git log --grep="feat: add visual test launchers and probe controls" -1 --format=%H
git revert $launcherCommit
```

`git revert` 生成可审计反向提交；不得使用 `git reset --hard`。回退代码不会删除既有 `room-logs` 或机器人报告。
