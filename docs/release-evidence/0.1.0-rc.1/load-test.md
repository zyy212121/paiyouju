# 100-user Load Test

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, Intel Core i9-14900HX, 15.63 GiB RAM
- Command: `corepack pnpm test:load -- --seed=2026082606 --json=... --markdown=...`
- Seed: 2026082606
- Result: PASS — 100 users, 100 sockets, 20 rooms/tables, 100 hands, 674 HTTP requests, 1,000 Socket commands; Ack p50 24.997 ms, p95 239.244 ms, p99 330.170 ms, max 355.283 ms; errors/disconnects/timeouts/privacy/invariants/negative Wallets 0; DB connections 1; data audit 28/28
- Known Limitation: this is an isolated local single-App measurement; internet latency and lower-end phone rendering are not represented

RSS start/peak/end: 158,076,928 / 406,659,072 / 406,659,072 bytes. Maximum sampled event-loop delay: 43.909 ms. Both release latency targets were met on the first formal run.
