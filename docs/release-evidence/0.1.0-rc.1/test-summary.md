# Test Summary

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: `corepack pnpm test`; server `test:integration`; all focused protocol/recovery/concurrency/settlement/cleanup gates; browser/PWA/production-like commands
- Seed: deterministic fixtures plus the seeds recorded in the simulation and scenario evidence
- Result: PASS — Unit 121 files/575 tests; PostgreSQL Integration 23/192; Chromium 23/23; Firefox 23/23; WebKit 23/23; PWA 1/1; clean Production-like 6/6; restored-data 1/1
- Known Limitation: WebKit is Safari automation, not a physical iPhone Safari test

Focused results: Protocol 28; typed Ack 5; Realtime 2 files/35; Snapshot 5 unit + 4 integration; Recovery 7; true-process Recovery 13; PostgreSQL concurrency 17; settlement exactly-once 6; runtime cleanup 8. No test uses retry, `.skip` or `.only` to obtain these results.
