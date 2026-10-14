# Backup and Restore

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: server `backup:create`, `backup:verify`, `backup:restore --database <new> --confirm-new-database`, Migration verification, `/ready`, `audit:data`, restored-data E2E
- Seed: feature data 2026082620; restored active table fixture; clean production-like browser data
- Result: PASS — formal dump 275,540 bytes, SHA-256 `2a75a39cbb1f8a4fe87994c4b895787b3a781ff27b137ee8390043209a82b2b2`; restored to a new volume/database with PostgreSQL 17.10, Protocol v5, 18 migrations, 34 users, 58 hands, 137 Wallet Ledger rows, active Snapshot recovery, 28/28 audit and a new completed hand
- Known Limitation: logical backup is not point-in-time recovery or multi-region disaster recovery

The clean-clone exercise independently produced a 131,102-byte dump with SHA-256 `0cb83921d54620ccc0578171478592c0161686581f1301ac277ecd75d4be79db`, restored it to a new database, and passed 28/28 audit with 6 users, 4 hands, 17 Wallet Ledger rows and 2 AuditLog rows. Dumps/manifests remain outside Git.
