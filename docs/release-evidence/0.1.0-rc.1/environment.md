# 0.1.0-rc.1 Release Environment

- Date: 2026-08-26 (Asia/Shanghai)
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607` (tested candidate; the final release commit adds evidence/checklist state)
- Docker Version: Client/Server 29.7.2; Docker Compose 5.3.1
- PostgreSQL Version: 17.10 (`postgres:17-alpine`, pinned digest)
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Microsoft Windows 11 家庭版 中文版 10.0.26200, 64-bit; Docker Desktop Linux containers
- Command: `node --version`; `corepack pnpm --version`; `docker version`; `docker compose version`; `/api/admin/system`; completed `_prisma_migrations` count
- Seed: N/A
- Result: PASS — application `0.1.0-rc.1`, Realtime Protocol v5 and 18 append-only migrations agree across build, system API, restored database and runtime
- Known Limitation: local hardware was Intel Core i9-14900HX with 15.63 GiB RAM; results are not a public DNS/ACME or physical mobile-device claim

No Cookie, Secret, full phone number, private card, database dump or full runtime log is stored here.
