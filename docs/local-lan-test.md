# 局域网手机测试

## 前置条件

在 `.` 中准备好：

- Docker Desktop 已启动；
- Node.js 24.x 和 Corepack 可用；
- `.env.docker`、`.env.docker.dev` 已存在，数据库密码与 URL 一致；
- 电脑和手机连接同一个 Wi-Fi 或同一个局域网。

如果环境文件不存在，先复制 `.env.docker.example`，再生成两个本机专用文件。不要把真实密码提交到 Git。

## 启动

推荐直接双击项目根目录的：

```text
.\start-test-ui.cmd
```

图形面板提供五个独立勾选项：

- 1号探针是管理员房间文件 Log 总开关。关闭时本次运行不写 `SNAPSHOT`、`COMMAND` 或任何动态探针行，但不会删除以前生成的日志文件；
- 2号探针当前是动态连接诊断，记录订阅、断线、Session 失效、状态同步、开手倒计时和取消原因；
- 3–5号探针是可勾选的预留空位，当前勾选不会传递设置，也不会产生记录。

点击“按当前选择启动测试”后，会打开一个始终可见的新 PowerShell 窗口并执行 LAN 启动。探针选择只在 Server 启动时读取；若检测到旧测试仍在运行，面板会要求先回旧窗口按 `Ctrl+C`。正常停止始终在运行窗口按 `Ctrl+C`；只有运行窗口失去响应时才使用面板的“强制停止（备用）”。

不使用图形面板时，仍可在 PowerShell 执行：

```powershell
Set-Location .
corepack pnpm dev:lan
```

脚本会先检查 `3000/5173`：若本项目的健康测试环境已经运行，会直接复用并重新显示手机地址，不会启动第二套进程；若端口被其他或残缺进程占用，会在执行 Docker、Migration 前立即报告 PID。端口可用时，脚本再依次启动 PostgreSQL、构建 workspace packages、应用开发 Migration 和 Seed，然后启动仅监听 `127.0.0.1` 的 Server 与绑定 `0.0.0.0` 的 Vite，并把 `CLIENT_ORIGIN` 设置为检测到的局域网地址。只有经 Vite 代理的 `/health` 返回 200 后，终端才会显示 `LAN test environment started`。Server/Vite 输出同时显示在当前窗口并保存到被 Git 忽略的 `test-results/lan-runtime/<时间>-server.log` 和 `-web.log`；启动成功时会打印两条完整日志路径。

父/子启动脚本固定按 UTF-8 读取 Node/Vite 输出并关闭 ANSI 颜色，避免 Windows PowerShell 5.1 把 `➜` 和颜色控制符显示成乱码。退出时若子进程已经自然结束，清理逻辑会直接视为已停止，不再输出“没有找到进程”的假警告。

手机浏览器打开脚本输出的地址，例如：

```text
http://192.168.1.20:5173
```

手机必须使用该局域网地址，不要使用 `localhost` 或 `127.0.0.1`。

## 防火墙与多网卡

如果手机打不开页面，可在 Windows Private 网络使用管理员 PowerShell 执行：

```powershell
Set-Location .
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-lan-test.ps1 -OpenFirewall
```

如果电脑同时连接 VPN、虚拟网卡和 Wi-Fi，可手工指定地址：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-lan-test.ps1 -LanAddress 192.168.1.20
```

停止脚本时按 `Ctrl+C`，前端和后端会被清理；数据库默认保留运行。若希望退出时同时停止 PostgreSQL：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-lan-test.ps1 -StopDatabaseOnExit
```

通过 `corepack pnpm dev:lan` 启动时，`Ctrl+C` 后 Windows 可能显示“终止批处理操作吗 (Y/N)?”。这是 `corepack.cmd` 的批处理确认，不是牌友局报错或乱码；输入 `Y` 即可完成退出。

如果另一窗口再次执行 `corepack pnpm dev:lan` 并显示 `an existing healthy test environment is already running`，环境已经可用，直接打开其输出的网址即可。需要真正重启时，先在最初保持运行的启动窗口按 `Ctrl+C`，再执行启动命令。

## 端口

- Web/Vite：`5173`
- Server：`3000`，仅由 Vite 代理访问
- PostgreSQL dev：`55432`
- PostgreSQL test：`55433`

修改端口示例：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-lan-test.ps1 -WebPort 5174 -ServerPort 3001
```

不要把 3000 或 PostgreSQL 端口直接暴露给手机；手机只需要访问 Vite 的局域网地址。
