# Performance Audit

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, Intel Core i9-14900HX, 15.63 GiB RAM
- Command: `corepack pnpm build`; render-boundary unit tests; `EXPLAIN ANALYZE` for 13 backend query paths; load and soak commands
- Seed: 2026082606 and 2026082612 for runtime measurements
- Result: PASS — main Web JS 347.57 kB (gzip 105.46 kB), CSS 80.29 kB, Admin 12.08 kB, Replay 8.81 kB; route-level lazy loading active; 13 query plans completed in approximately 0.05–0.92 ms on restored data with bounded stable cursors and no release-blocking N+1/unbounded query
- Known Limitation: local small-table plans legitimately choose sequential scans; bundle and internet performance can vary on low-end devices/networks

History, replay and Admin routes are split. Lucide is imported per icon; no second icon library, large Base64 asset or duplicate sound asset was found. The timer boundary tests prevent the per-second countdown from rerendering the entire table.
