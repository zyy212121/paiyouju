# Migration Matrix

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: `corepack pnpm --filter @wepoker/server test:integration`; clean Production Compose Migration Job; completed `_prisma_migrations` query
- Seed: fixed Step 3, Step 4, Step 5, Step 6, Step 6.5 and Step 7 fixtures
- Result: PASS — Empty→Latest and all six historical fixtures→Latest; 18 completed migrations; no pending migration
- Known Limitation: migration validation targets PostgreSQL 17.10 only

The original 17 migrations were not edited. Step 8 appends `20260826010000_step8_action_time_constraint_fix`; the clean clone applied all 18 migrations to a new volume, and both formal and clean backup restores retained count 18.
