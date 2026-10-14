# Auth, Wallet, and Private Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real PostgreSQL-backed Step 3 server foundation for users, server sessions, virtual-point wallets and ledgers, private rooms, HTTP APIs, security controls, migrations, seed data, and database integration tests.

**Architecture:** Fastify routes validate inputs and delegate to focused auth, wallet, and room services. Services own transactions and stable domain errors; a shared Prisma lifecycle module owns database access. Raw session tokens live only in HttpOnly cookies, wallet changes use ledger-backed optimistic version updates, and room codes/random tokens are injected at service boundaries for deterministic tests.

**Tech Stack:** Node.js 24, TypeScript 6 strict, Fastify 5, Zod 4, Prisma/PostgreSQL 7.9.1, Argon2id, Vitest 4, pnpm 11.16 through Corepack.

## Global Constraints

- Work only in `.`; preserve commits through `95f2835e0aec511a1fa673cb7d3074d8789bdadf`.
- PostgreSQL/Prisma only; never substitute SQLite, in-memory persistence, or mocked Prisma for integration evidence.
- Implement only Step 3. Do not add Socket.IO table behavior, seating, buy-in, Table Stack, hand persistence, history, paid reveal, admin UI, or Step 4 code.
- Amounts are integers in `0..2_000_000_000`; every wallet change is transactional, ledger-backed, idempotent, and version checked.
- Passwords and optional room passwords use Argon2id. Raw passwords, cookies, session tokens, hashes, API keys, and database URLs never enter responses/logs/Git.
- Sessions use at least 32 cryptographic random bytes, store only SHA-256 token hashes, expire after exactly 14 days, and use the `wepoker_session` HttpOnly SameSite=Lax cookie.
- All HTTP inputs use Zod, all errors use one safe response envelope with requestId, and modifying requests enforce trusted Origin plus endpoint rate limits.
- Follow red-green-refactor for every business batch. A Step 3 completion commit is forbidden unless real project-isolated database migrations and integration tests pass.

---

### Task 1: Local PostgreSQL lifecycle and executable migration

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Modify: `apps/server/prisma.config.ts`
- Create: `apps/server/prisma/migrations/20260813075720_step3_foundation/migration.sql`
- Create: `apps/server/prisma/migrations/20260813090000_ledger_wallet_owner/migration.sql`
- Create: `apps/server/scripts/database-command.ts`
- Modify: `apps/server/package.json`
- Modify: `package.json`
- Modify: `.env.example`
- Create locally, never commit: `.env`, `.env.test`

**Interfaces:**
- Produces `db:dev:start/stop`, `db:test:start/stop`, `db:migrate`, `db:migrate:test`, `db:seed`, `db:validate`, and `db:studio` scripts.
- Produces Prisma enums/models `User`, `UserSession`, `Wallet`, `WalletLedgerEntry`, `Room`, `RoomMember`, and `RequestIdempotency` with explicit unique keys, indexes, and Restrict relations.

- [x] Write schema-contract tests that fail while models/enums/constraints are absent.
- [x] Start project-isolated development and test PostgreSQL instances from actual Prisma CLI output; store only ignored local URLs.
- [x] Implement the schema and generated SQL migrations, including database CHECK constraints for points, versions, sequences, room configuration, six-digit codes, and ledger ownership.
- [x] Validate schema, apply all migrations to an empty test database, inspect SQL constraints/indexes, and generate the client.

### Task 2: Configuration, database lifecycle, password/session primitives, and shared contracts

**Files:**
- Create: `apps/server/src/config/environment.ts`
- Create: `apps/server/src/db/client.ts`
- Create: `apps/server/src/security/passwords.ts`
- Create: `apps/server/src/security/sessions.ts`
- Create: `apps/server/src/http/api-error.ts`
- Modify: `packages/shared/src/index.ts`
- Test: focused `*.test.ts` beside each module.

**Interfaces:**
- Produces validated `Environment`, `PrismaClient` lifecycle, `hashPassword/verifyPassword`, `createSessionToken/hashSessionToken`, `ApiError`, and shared safe response DTOs.
- Environment validates NODE_ENV, PORT, CLIENT_ORIGIN, DATABASE_URL, cookie name/TTL, INITIAL_USER_POINTS, optional seed settings, and LOG_LEVEL.

- [x] Write failing validation, Argon2id hash/verify, random-token/hash separation, and API-envelope tests.
- [x] Add exact compatible dependencies and implement the minimal primitives without logging secrets.
- [x] Run focused tests, strict typecheck, and generated-client build.

### Task 3: Registration, login, logout, and authenticated identity

**Files:**
- Create: `apps/server/src/modules/auth/auth.schemas.ts`
- Create: `apps/server/src/modules/auth/auth.service.ts`
- Create: `apps/server/src/modules/auth/auth.routes.ts`
- Create: `apps/server/src/modules/sessions/session.service.ts`
- Create: `apps/server/src/http/authentication.ts`
- Test: unit and real-database integration tests.

**Interfaces:**
- Produces `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`.
- Registration transaction creates User, Wallet, INITIAL_GRANT ledger, and UserSession atomically; login creates a fresh session; logout revokes current session idempotently.

- [x] Write failing normalization/validation and transaction rollback tests, including `Alice` versus `alice`.
- [x] Implement registration with Argon2id, initial grant, hashed session token, and secure cookie settings.
- [x] Write and fail login enumeration-resistance, expired/revoked session, `/api/me`, cookie-clearing, and sensitive-field tests.
- [x] Implement authentication decoration/hooks and routes; run focused unit and database tests.

### Task 4: Wallet mutation, ledger, idempotency, and read APIs

**Files:**
- Create: `apps/server/src/modules/wallet/wallet.service.ts`
- Create: `apps/server/src/modules/wallet/wallet.schemas.ts`
- Create: `apps/server/src/modules/wallet/wallet.routes.ts`
- Test: wallet unit and real-database integration tests.

**Interfaces:**
- Produces `getWallet(userId)`, `listLedger(userId, pagination)`, and internal `applyWalletMutation(input)`.
- Produces authenticated `GET /api/wallet` and `GET /api/wallet/ledger`; no public mutation route exists.

- [x] Write failures for positive/negative changes, safe integer bounds, insufficient balance, MAX_POINTS, ledger sequence/version, and transaction rollback.
- [x] Implement finite optimistic CAS retries plus unique idempotency records inside Prisma transactions.
- [x] Write failures for same-key replay, payload conflict, concurrent requests, stable cursor pagination, and cross-user isolation.
- [x] Implement idempotency request fingerprints, original-result replay, and stable newest-first pagination; run focused and concurrent integration tests.

### Task 5: Private room creation, membership, permissions, and lifecycle

**Files:**
- Create: `apps/server/src/modules/rooms/room.schemas.ts`
- Create: `apps/server/src/modules/rooms/room-code.ts`
- Create: `apps/server/src/modules/rooms/room.service.ts`
- Create: `apps/server/src/modules/rooms/room.routes.ts`
- Test: room unit and real-database integration tests.

**Interfaces:**
- Produces room-code generator injection, transactional owner membership, idempotent join, owner authorization, member projections, and create-request idempotency.
- Produces all seven required `/api/rooms` endpoints without public room discovery.

- [x] Write failing room configuration and code-format/collision/exhaustion tests.
- [x] Implement safe configuration parsing, cryptographic six-digit code generation, optional Argon2id password hashes, and create transaction.
- [x] Write failures for join privacy, password verification, duplicate membership, closed-room denial, member reads/lists, owner-only pause/resume/close, and idempotent close/create.
- [x] Implement routes/services and run focused plus database integration tests.

### Task 6: HTTP safety controls and application composition

**Files:**
- Create: `apps/server/src/http/error-handler.ts`
- Create: `apps/server/src/http/origin-guard.ts`
- Create: `apps/server/src/http/rate-limit.ts`
- Create: `apps/server/src/http/request-context.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`
- Test: HTTP/security unit and integration tests.

**Interfaces:**
- Produces one success/error envelope, requestId propagation, safe Zod/Prisma/domain error mapping, trusted-origin enforcement, endpoint limits, CORS response headers, body-size limit, and redacted structured logging.

- [x] Write failing requestId, envelope, unknown-error secrecy, origin, CORS, body-size, cookie, rate-limit, and redaction tests.
- [x] Compose dependencies and all routes through `buildApp`; route handlers contain no complex database transactions.
- [x] Run all HTTP/security tests and a built-server smoke flow through health, auth, wallet, and rooms.

### Task 7: Idempotent development seed

**Files:**
- Create: `apps/server/prisma/seed.ts`
- Modify: `apps/server/prisma.config.ts`
- Test: `apps/server/src/integration/seed.integration.test.ts`

**Interfaces:**
- Produces idempotent `admin`, `alice`, `bob`, `charlie`, and `david` accounts with configured initial points; only admin receives ADMIN.

- [x] Write a failing integration test for first/second seed runs, one initial ledger per user, unchanged balances/passwords, and production refusal.
- [x] Implement seed via the same auth/wallet invariants, using `DEV_SEED_PASSWORD` and configured admin identity.
- [x] Apply seed twice against development data and verify no duplicate points, ledgers, users, or password resets.

### Task 8: Documentation, complete verification, and commit

**Files:**
- Modify: `README.md`, `.env.example`, `docs/architecture.md`, `docs/data-model.md`, `docs/security.md`, `docs/development-roadmap.md`, `docs/PROGRESS.md`
- Create: `docs/http-api.md`, `docs/local-database.md`

**Interfaces:**
- Produces reproducible local setup, migration/seed/API examples, model/transaction/security rationale, test evidence, and the explicit standard PostgreSQL multi-connection retest limitation.

- [x] Document exact local database commands, ignored environment setup, migration, seed, sessions/cookies, wallet ledger/idempotency, room privacy/permissions, API envelopes, and all limitations.
- [x] Search for forbidden markers and secret-bearing files; inspect every password/token/DATABASE_URL match and run `git diff --check`.
- [x] From an empty test database apply migrations, run seed twice, execute server unit/integration/security tests, Poker Core regression, lint, typecheck, full tests, build, E2E, and built-server smoke flow.
- [x] If every completion gate passes, stage only Step 3 files, commit exactly `feat: add auth wallet and private rooms`, record hash, and stop before Step 4.

## Self-review

- Spec coverage: Tasks 1–8 cover every model, API, transaction, security control, migration, seed, integration test, documentation requirement, and final command; Step 4 capabilities are explicitly excluded.
- Placeholder scan: the plan contains no deferred implementation or unspecified error-handling step.
- Type consistency: auth, wallet, room, HTTP, Prisma, seed, and shared DTO boundaries use the same User/Session/Wallet/Room identifiers and safe response contracts throughout.
