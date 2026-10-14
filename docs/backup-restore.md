# 备份与恢复

备份默认写到项目相邻的 `../paiyouju-backups`，各系统规则一致。可用 `WEPOKER_BACKUP_DIR` 指向其他外部目录；相对路径以仓库根目录为基准，脚本拒绝仓库内部目录。

```powershell
corepack pnpm backup:create
corepack pnpm backup:list
corepack pnpm backup:verify
corepack pnpm backup:restore -- --database wepoker_restore_20260825 --confirm-new-database
corepack pnpm backup:prune
```

每份备份由 `pg_dump --format=custom` dump 和 Manifest JSON 组成。Manifest v1 记录创建时间、应用版本、创建时的 Realtime Protocol 版本、PostgreSQL 版本、数据库名、已完成 Migration 数、文件名和 SHA-256，不含密码。当前新备份写 Protocol v9；校验器继续接受既有 Protocol v5/v6/v7/v8 Manifest，确保历史正式备份仍可恢复。创建先写 `.partial`，完成后原子改名并立即校验。

恢复前必须校验 SHA-256。目标数据库名必须是合法的新标识符、不得等于来源且不得已存在；脚本创建恢复锁，以 `pg_restore --exit-on-error --no-owner --no-privileges` 恢复并核对 Migration 数。恢复失败不会覆盖来源数据库。完成后必须运行 `audit:data`、启动 App 指向恢复库、检查 `/ready`、登录、Wallet/History/Replay/四类钻石费用/管理员审计，并完成一手新牌；不能只以 pg_restore 退出 0 判定成功。

保留策略：每日 7 份、每周 4 份、每次 Migration 前额外一份、至少一份异机副本。本阶段不上传云。`backup:prune` 只删除可验证 Manifest/dump 对；未知文件、损坏证据和带 `.restore-lock` 的演练文件保持不动。

## 0.1.0-rc.1 最终演练

2026-08-26 的正式演练生成 275,540-byte custom dump，SHA-256 为 `2a75a39cbb1f8a4fe87994c4b895787b3a781ff27b137ee8390043209a82b2b2`。它被恢复到全新 PostgreSQL Volume/数据库；PostgreSQL 17.10、Protocol v5、18 条 Migration、34 User、58 Hand、137 Wallet Ledger、活动 Snapshot、费用授权和 AuditLog 均保留，`audit:data` 28/28、恢复数据浏览器 1/1、新 Hand 完成全部 PASS。

Clean Clone 又独立生成 131,102-byte dump，SHA-256 `0cb83921d54620ccc0578171478592c0161686581f1301ac277ecd75d4be79db`，恢复到新库后 18 Migration、6 User、4 Hand、17 Wallet Ledger、2 AuditLog 和 28/28 Audit PASS。两次 dump/manifest 均保留在项目外且未提交。详细无敏感摘要见 `docs/release-evidence/0.1.0-rc.1/backup-restore.md`。
