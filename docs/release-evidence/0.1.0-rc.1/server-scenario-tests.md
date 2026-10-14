# Real Server / Socket Scenario Tests

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: `corepack pnpm test:system-scenarios -- --seed=20260826 --json=... --markdown=...`; normal HTTP + Session/CSRF + Socket.IO v5 only
- Seed: master 20260826 with per-client derived seeds; feature protocols 2026082620
- Result: PASS — 100 clients/sockets, 20 rooms, 2,000 hands, 11,358 actions; 2p 400, 3p 400, 5p 500, 6p 350, 9p 350; all-in 1,748, side-pot 1,464, short-all-in 1,321, rebuys 3,519; illegal/server/privacy/invariant/ACK-timeout errors all 0; data audit 28/28
- Known Limitation: the runner validates legal protocol behavior, not poker strategy

Feature protocols S9–S16 all PASS. Recorded purchases/events: paid reveal 1, hypothetical runout 2, action extension 1, preactions 2, reserved-away 2. For BB=2, each fixed fee was 1 point and duplicate operation cost was 0.
