# Privacy Audit

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: Scenario Runner privacy assertions over every HTTP response, Socket event, typed Ack, table state, hand detail, replay and error; browser participant payload checks; PWA cache inspection
- Seed: 20260826, 2026082606, 2026082612 and deterministic privacy fixtures
- Result: PASS — privacy violations 0 in 2,000-hand scenario, 100-user load and 30-minute soak; hidden opponent cards, unselected show cards, remaining deck, future board, Snapshot payload, full phone, foreign fee authorization, Cookie and Session token were absent
- Known Limitation: evidence intentionally omits actual private card values, identifiers, phone numbers and tokens

“偷偷看” and “发发看” grants remained buyer-specific after restart/restore. The Scenario Runner reports only counts, seeds and redacted failure context and has no database/server-internal access.
