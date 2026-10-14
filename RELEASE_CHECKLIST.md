# 0.1.0-rc.1 Release Checklist

- [x] HEAD 与评审 Commit 一致，工作区只含本次发布内容；Protocol 仍为 v5，Migration 为 append-only。
- [x] `pnpm install --frozen-lockfile`、Prisma validate、空库 Migration、升级 Migration、幂等 Seed 全部通过。
- [x] lint、typecheck、unit、PostgreSQL integration、Chromium/Firefox/WebKit、PWA 与 production build 全部通过。
- [x] 精确五张牌分布、1,000,000 手模拟、10 个附加 Seed 和至少 2,000 手真实 Server/Socket 场景全部通过且无 native retry 掩盖。
- [x] 100 用户负载、30 分钟浸泡、5 分钟空闲清理和 20–50 Socket 故障负载全部通过；无隐私、守恒、泄漏或重复结算错误。
- [x] Admin 授权、手机号掩码、Adjustment 事务/幂等/余额边界、AuditLog、Room/Recovery 安全操作通过。
- [x] CSRF/Origin/CORS/Cookie/Session、rate limit、Socket limit/payload/unknown event、安全头和日志脱敏通过。
- [x] `audit:dependencies` 无 blocking high/critical；许可证清单与 `THIRD_PARTY_NOTICES.md` 已复核。
- [x] 最终生产镜像以锁文件构建、非 root、无秘密/源码/备份；Compose config 与 Caddy validate 通过。
- [x] `.env.production` 的域名、HTTPS Origin、强数据库密码、版本和备份目录已人工核对且未提交。
- [x] Migration 前外部备份已创建并校验；恢复到全新库、Migration、`audit:data`、ready、登录、历史/Admin 和新 Hand 全部通过。
- [x] App/PostgreSQL/full Compose restart 不丢数据、不重复收费/结算；停机命令未使用 `-v`。
- [x] Release Evidence、Requirements Traceability、Known Limitations、Changelog 和进度文档与真实输出一致且不含私牌、完整手机号、Cookie、Secret 或 Dump。
- [x] Release Blocker 为 0、版本一致、工作区干净；创建唯一发布提交和 annotated `v0.1.0-rc.1` 本地 Tag。
- [x] 本次工作不自动部署、不 push、不发布镜像、不创建 GitHub Release；正式公网切换需要独立授权。
