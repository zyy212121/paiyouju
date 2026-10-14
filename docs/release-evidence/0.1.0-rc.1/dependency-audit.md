# Dependency and License Audit

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: `corepack pnpm audit --json`; `corepack pnpm audit:dependencies`; production image CLI/import inspection; license inventory
- Seed: N/A
- Result: PASS — raw audit High 1, Critical 0, Moderate 0; exact allowlist contains only npm advisory 1145093 / GHSA-ggr8-5vv4-36mx in `deepmerge-ts@7.1.5` through Prisma configuration/CLI; blocking production-reachable findings 0; Prisma/tsx/vitest/Playwright CLIs absent from runtime image
- Known Limitation: the allowlisted advisory remains in the build/migration tooling path until a compatible Prisma toolchain removes it; it is not reachable from production request handling

License counts recorded in `THIRD_PARTY_NOTICES.md`: Apache-2.0 20, BlueOak-1.0.0 5, BSD-2-Clause 1, BSD-3-Clause 4, EPL-2.0 1, ISC 26, MIT 187, MIT/ISC 1 and Unlicense 2. No automatic dependency upgrade was merged.
