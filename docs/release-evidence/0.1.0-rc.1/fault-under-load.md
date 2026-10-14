# Fault Under Load

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: `corepack pnpm test:fault-under-load -- --seed=2026082619 --json=... --markdown=...`
- Seed: 2026082619
- Result: PASS — 20 users/sockets, 4 rooms, 32 post-recovery hands across graceful App restart, abrupt App kill, PostgreSQL restart and Caddy restart; each recovered 20 connections with Snapshot/idempotency/Wallet/Table Stack preservation; final data audit 28/28
- Known Limitation: local Docker Desktop outage timings are not a multi-region availability measurement

Observed downtime: graceful App 28,104 ms; abrupt App 5,220 ms; PostgreSQL 9,731 ms; Caddy 7,324 ms. PostgreSQL outage safely rejected writes while unavailable. No old event replay, duplicate settlement, duplicate fee or lost balance was observed.
