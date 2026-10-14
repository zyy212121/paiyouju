# 30-minute Soak Test

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, Intel Core i9-14900HX, 15.63 GiB RAM
- Command: `corepack pnpm test:soak -- --duration-ms=1800000 --cleanup-wait-ms=300000 --seed=2026082612 --json=... --markdown=...`
- Seed: 2026082612
- Result: PASS — 100 users/sockets, 20 rooms, 8,666 completed hands, 49,966 actions, 29 intentional reconnects; 0 server/illegal/privacy/invariant/negative-Wallet errors; after five-minute cleanup runtime/socket/timer/action-cache = 0/0/0/0, DB connections 1, data audit 28/28
- Known Limitation: one bounded ACK timeout coincided with the intentional reconnect workload and was authoritatively resynchronized; it caused no illegal action, duplicate transition, data error or hard failure

Configured workload 1,800,000 ms; cleanup 300,000 ms; total elapsed 2,400,073 ms. RSS start/peak/end: 192,757,760 / 549,646,336 / 163,848,192 bytes, so cleanup ended below the starting RSS. Hard failures: none.
