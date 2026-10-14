# Security Audit

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: full unit/integration/browser security suites; code scan; production image inspection; `corepack pnpm audit:dependencies`
- Seed: deterministic security fixtures
- Result: PASS — authorization/IDOR, Admin role enforcement, masked phones, Session/Cookie, CSRF/Origin, CORS, rate limits, Socket limits, payload limits, unknown events, security headers, safe errors and log redaction all pass; production-reachable High/Critical = 0
- Known Limitation: public DNS, public ACME and an external penetration test remain outside this local RC audit

Production output never returns Prisma/SQL/stack/file paths. The runtime image runs as UID 1000 `node`, contains no environment files, keys, dumps, TypeScript source, Scenario Runner, integration helpers or development CLIs.
