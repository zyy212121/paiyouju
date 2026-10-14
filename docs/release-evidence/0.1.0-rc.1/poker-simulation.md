# Poker Simulation

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: Poker Core five-card exhaustive distribution; `simulate --hands=1000000 --seed=20260826`; ten `10000`-hand fixed-seed runs
- Seed: 20260826; additional 20260827–20260836
- Result: PASS — exact enumeration 2,598,960 in 6.679 s; million run completed 1,000,000, failed 0, invariant failures 0, side-pot hands 819,042, short-all-in hands 230,007, elapsed 1,003,193.0681 ms, native retries 0; all ten additional seeds completed 10,000 with 0 failures/invariants/retries
- Known Limitation: simulation is a rules/state-machine audit and not a strategy or probability-strength engine

Exact distribution: High Card 1,302,540; One Pair 1,098,240; Two Pair 123,552; Three of a Kind 54,912; Straight 10,200; Flush 5,108; Full House 3,744; Four of a Kind 624; Straight Flush 40.
