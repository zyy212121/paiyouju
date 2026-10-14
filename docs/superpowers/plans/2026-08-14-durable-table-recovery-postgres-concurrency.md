# Durable Table Recovery and PostgreSQL Concurrency Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in dependency order. Steps use checkbox (`- [ ]`) syntax for tracking and every behavior change follows red-green-refactor.

**Goal:** Replace the Step 4 in-memory-only table boundary with standard Docker PostgreSQL, commit-before-broadcast snapshots, durable action receipts, process-restart recovery, exactly-once settlement, reliable acknowledgements, cleanup, and shutdown behavior while preserving a single active application instance.

**Architecture:** PostgreSQL becomes the last-committed authority for every table state transition through a versioned `TableSnapshot` row and revision lock. The per-room `SerializedQueue` remains the in-process ordering boundary, while database row locks, unique receipts, revision CAS, and one settlement transaction protect crash and multi-connection boundaries. Startup recovery validates private snapshot payloads before creating runtimes, restores deadlines without resetting them, and isolates invalid rooms as `RECOVERY_ERROR`.

**Tech Stack:** Windows PowerShell, Docker Desktop 4.86 / Engine 29.7, Docker Compose 5.3, PostgreSQL 17 Alpine, Node.js 24, pnpm 11.16, TypeScript 6 strict, Prisma 7.9, Fastify 5, Socket.IO 4.8, Zod 4, React 19, Zustand 5, Vitest 4, Playwright 1.62.

## Global Constraints

- Work only in `.` on `main`, starting at `948eb9cdd95bf49a1708c251a6c8e60b44d24e19`; preserve user changes and never edit the eight committed migrations.
- Use one active Fastify/Socket.IO application instance and one standard PostgreSQL database; do not add Redis, brokers, multiple application ownership, public rooms, payments, real money, history UI, replay UI, admin UI, final art, Caddy public deployment, or Step 6 work.
- Docker data must use named volumes, never a repository bind mount; secrets stay in ignored local environment files and only examples are committed.
- Development and test PostgreSQL are isolated, use pool size at least 10, and real multi-connection evidence requires distinct `pg_backend_pid()` values from independent connections.
- Every successful table transition follows Prepare → Validate → Database Commit → Runtime Update → Broadcast. A database failure leaves the prior runtime/state authoritative and produces no success broadcast.
- Snapshot schema version is exactly `1`; invalid/unsupported snapshots become `RECOVERY_ERROR` without reshuffling, cashing out, resetting, or exposing private payloads.
- Player `clientActionId` receipts and their resulting snapshot transition commit in one transaction; settlement is exactly once at database level.
- Existing Step 4 behavior, privacy projection, integer accounting invariants, Poker Core purity, absolute deadlines, and original/placeholder asset rules remain unchanged.
- No `.skip`, `.only`, `@ts-ignore`, arbitrary `any`, core-protocol `unknown`, retries hiding failures, fixed sleeps standing in for barriers, or production-visible fault controls.
- Final commit is exactly `feat: add durable table recovery and postgres concurrency`; do not push, tag, merge, or start Step 6.

---

### Task 1: Docker PostgreSQL development and test boundary

**Files:**
- Modify: `compose.yaml`, `.gitignore`, `.env.example`, `package.json`, `apps/server/package.json`
- Create: `.env.docker.example`, `apps/server/scripts/docker-database-command.ts`
- Create: `docs/docker-development.md`
- Test: `apps/server/src/config/environment.test.ts`, Docker/SQL acceptance commands

**Interfaces:**
- Produces services `postgres-dev` on `127.0.0.1:55432` and `postgres-test` on `127.0.0.1:55433`, independent named volumes, health checks, restart policies, UTF-8 databases, and `max_connections=100` or greater.
- Produces scripts `db:docker:up`, `db:docker:down`, `db:docker:status`, `db:docker:logs`, `db:docker:reset:dev`, `db:docker:reset:test`, `db:migrate:docker`, `db:migrate:test:docker`, `db:seed:docker`, and `db:seed:test:docker`.

- [x] Capture Docker client/server/Compose/Linux/hello-world evidence and demonstrate the current one-service Compose cannot supply isolated dev/test services.
- [x] Add strict environment tests proving Docker dev/test configurations use pool size at least 10 and retain production rejection of test-only settings.
- [x] Implement the two official `postgres:17-alpine` services with named volumes and health checks; keep production Compose separate and secret-free.
- [x] Implement PowerShell-safe database lifecycle scripts that refuse unsafe reset targets and invoke Prisma using ignored Docker env files.
- [x] Start both services, query exact version/max_connections/database/user, apply all committed migrations to empty test PostgreSQL, and run seed twice.
- [x] Add a two-client `pg_backend_pid()` test and record at least two distinct backend PIDs before calling this boundary complete.

### Task 2: Fully typed realtime protocol and reliable acknowledgements

**Files:**
- Modify: `packages/shared/src/realtime.ts`, `packages/shared/src/realtime.test.ts`, `packages/shared/src/index.ts`
- Modify: `apps/server/src/realtime.ts` and realtime integration tests
- Modify: `apps/web/src/realtime/table-socket.ts`, `apps/web/src/stores/table-store.ts`, `apps/web/src/pages/TablePage.tsx`
- Create: `apps/web/src/realtime/table-socket.test.ts`

**Interfaces:**
- Produces Zod-backed `TableEvent`, `ProjectedAction`, `CommandDataByEvent`, `CommandAcknowledgement<T>`, typed `ClientToServerEvents`, `ServerToClientEvents`, `InterServerEvents`, and `SocketData` with no core payload `unknown`.
- Produces `emitCommandWithAck(event,payload,{timeoutMs=10_000})`, rejecting with stable `REALTIME_DISCONNECTED`, `REALTIME_TIMEOUT`, or `REALTIME_COMMAND_REJECTED` client errors.

- [x] Add failing protocol round-trip tests for every state/event/error/ack discriminant and a source contract that rejects core-protocol `unknown`.
- [x] Replace loose action history, event, and ack data with explicit discriminated unions and strict schemas; validate outbound server payloads in tests.
- [x] Add failing Web tests for disconnected-before-send, disconnect-after-send, timeout cleanup, single settle, rejection details, and action-result uncertainty resync.
- [x] Implement the shared ack envelope `{ok,requestId,stateVersion,data|error,latestState?}` across every Socket command and migrate Server/Web call sites without assertions.
- [x] Implement one pending-command registry that clears timers and rejects all affected promises on disconnect; never automatically retry a poker action with a new ID.
- [x] Add reconnect/resubscribe UI states, clear stale legal actions until canonical state arrives, and preserve reusable operation IDs only until a durable result is known.

### Task 3: Step 5 relational model, snapshot codec, and repositories

**Files:**
- Modify: `apps/server/prisma/schema.prisma`, `apps/server/src/db/schema-contract.test.ts`, integration cleanup/constraint tests
- Create: `apps/server/prisma/migrations/20260814_step5_durable_table_recovery/migration.sql`
- Create: `apps/server/src/modules/tables/snapshot/snapshot-schema.ts`, `snapshot-codec.ts`, `snapshot-repository.ts`
- Create: `apps/server/src/modules/tables/idempotency/action-receipt-repository.ts`
- Test: focused schema, codec, repository, corruption, and standard-PostgreSQL integration tests

**Interfaces:**
- Produces `TableSnapshot` with unique room, schema/state/revision, runtime/recovery status, optional hand/deadlines, JSONB payload, safe recovery error, and timestamps.
- Produces `TableActionReceipt` unique by `(roomId,userId,clientActionId)`, with fingerprint, hand/action/resulting version/result code.
- Adds durable `Room.nextHandNumber` and runtime status `RECOVERY_ERROR`.
- Produces `TABLE_SNAPSHOT_SCHEMA_VERSION = 1`, `serializeTableSnapshot(runtime)`, `validateTableSnapshot(record,relations)`, and `deserializeTableSnapshot(record,relations)`.

- [x] Add failing schema-contract and standard-PostgreSQL constraint tests for every new column, enum, check, unique, index, and foreign key.
- [x] Add the new Prisma models/relations and one append-only Step 5 migration without editing history; generate the client and apply from empty Docker test DB.
- [x] Add failing codec tests for every runtime state plus JSON round-trip, all 52-card uniqueness, Poker Core invariants, accounting totals, seat/session/room linkage, hand/version/deadline checks, and forbidden secret/object fields.
- [x] Implement strict Zod JSON schemas and conversion of Dates/cards/HandState without class, timer, socket, Prisma, logger, credential, or connection objects.
- [x] Add failing repository tests for create/update revision CAS, row lock behavior, conflict reread, recovery-error marking, exact receipt replay/conflict, and transaction rollback.
- [x] Implement repository APIs accepting Prisma transaction clients so Snapshot, Receipt, Hand Number, Seat, Ledger, and settlement writes can share one transaction.

### Task 4: Commit-before-broadcast table transitions

**Files:**
- Modify: `apps/server/src/modules/tables/runtime/table-runtime.ts`, `types.ts`, `hand-controller.ts`, hydration/projection tests
- Modify: `apps/server/src/modules/tables/hand-persistence.service.ts`, `table-accounting.service.ts`, `apps/server/src/realtime.ts`
- Create: `apps/server/src/modules/tables/persistence/table-transition.service.ts`
- Test: start/action/timeout/accounting failure-injection and ordering tests

**Interfaces:**
- Produces `prepareStart`, `commitStart`, `commitPlayerAction`, `commitTimeout`, and `commitDurableSeatTransition` APIs that clone the last committed runtime, lock Snapshot, validate revision, persist, then return an immutable committed transition.
- Runtime only swaps to the returned committed state after transaction success; broadcasts receive only committed Runtime state.

- [x] Write failure tests proving start/action/timeout/seat mutation database errors leave runtime, actor, street, stack, deadline, revision, and broadcasts unchanged.
- [x] Allocate `Room.nextHandNumber`, create the shuffled Hand, and write the initial Snapshot in one locked transaction before setting timers or broadcasting.
- [x] Persist every player action with its receipt and candidate Snapshot in one transaction, including exact replay/conflict behavior after a newly constructed Runtime.
- [x] Persist deterministic timeout commands through the same candidate transition; duplicate callbacks become validated no-ops.
- [x] Refactor durable seat and room transitions so their database commit includes the corresponding latest Snapshot representation before runtime/broadcast update.
- [x] Replace in-place candidate mutations with explicit clones/returned committed objects and prove action/timeout races still accept exactly one transition.

### Task 5: Exactly-once settlement and room-closing recovery

**Files:**
- Modify: `apps/server/src/modules/tables/hand-persistence.service.ts`, `table-accounting.service.ts`, `runtime/hand-controller.ts`
- Create: `apps/server/src/modules/tables/persistence/settlement.service.ts`
- Test: `settlement-exactly-once.integration.test.ts`, closing recovery/fault tests

**Interfaces:**
- Produces `settleHandExactlyOnce(input,expectedSnapshotRevision)` returning `committed|alreadyCommitted` plus canonical post-settlement Snapshot.
- Produces deterministic close key `room-close-cashout:<roomId>:<gameSessionId>` and `resumeClosingRoom(roomId)`.

- [x] Add two-client failing tests that concurrently settle one hand and assert one HandRecord/result set, one stack delta, no repeated cash-out, and one post-hand Snapshot.
- [x] Commit Hand/Player/Action/Pot, HAND_RESULT, Seat updates, deferred status/leave, closing cash-outs, Room status, Receipt, and cleared-hand Snapshot atomically.
- [x] Distinguish an exact already-committed Hand from receipt/payload conflict, relation corruption, and unknown database failures.
- [x] Add fault tests before settlement commit and after commit-before-runtime/broadcast; recovery must respectively resume the old active hand or expose the single committed result.
- [x] Add partial CLOSING recovery tests using deterministic cash-out keys and finish CLOSED only after every remaining Seat is removed.
- [x] Prove Wallet remains unchanged by hand results, paired transfers remain exact, and all table stacks conserve through duplicate calls and crashes.

### Task 6: Startup recovery, deadlines, readiness, cleanup, and shutdown

**Files:**
- Create: `apps/server/src/modules/tables/recovery/recovery-service.ts`, `deadline-recovery.ts`
- Create: `apps/server/src/modules/health/readiness.ts`
- Create: `apps/server/src/shutdown/graceful-shutdown.ts`
- Create: `apps/server/src/testing/fault-injection.ts`
- Modify: `apps/server/src/app.ts`, `index.ts`, Runtime Manager/Controller/Realtime/config files
- Test: recovery R1–R12 component integration, readiness, cleanup, and shutdown tests

**Interfaces:**
- Produces `recoverTables()` that loads OPEN-with-seats, CLOSING, and Snapshot rooms independently, validates each, builds runtimes, restores timers/closing, and reports degraded count.
- Produces `/ready` 503 until database/recovery/runtime initialization completes, then 200 with safe counts; `/health` remains liveness-only.
- Produces bounded `shutdown()` and `TableRuntimeManager.evictEligible()/close()`.

- [x] Add failing recovery tests for R1–R12, including unsupported/corrupt snapshot isolation, legacy no-snapshot rooms, future/expired deadlines, pending leave/sit-out, and CLOSING.
- [x] Implement startup recovery before readiness, with empty Presence; reset START_COUNTDOWN to IDLE but preserve active hand IDs, cards, board, deck, pots, actor, actions, versions, stacks, and deadlines.
- [x] Restore future deadline remaining time and enqueue already-expired deterministic timeout only after deserialization; never mutate during validation.
- [x] Add readiness tests for startup 503, healthy 200, safe degradedRooms, database outage, and absence of secrets/private state.
- [x] Wire production cleanup for CLOSED/empty/no-seat runtimes, optional idle snapshot-backed eviction, timer/cache/presence disposal, and no active-hand accidental eviction.
- [x] Wire SIGINT/SIGTERM shutdown to mark unready, reject new writes, drain bounded queues/transactions, cancel timers, close Socket/HTTP/DB, and never fold/cash-out/reset active hands.
- [x] Implement test-only injected fault hooks that production configuration rejects and that are never enabled by an HTTP/Socket payload.

### Task 7: Standard PostgreSQL multi-connection correctness

**Files:**
- Create: `apps/server/src/integration/postgres-concurrency.integration.test.ts`
- Modify: Wallet/table accounting/snapshot/settlement repositories only when red tests expose locking issues
- Add: `test:postgres-concurrency`, `test:action-idempotency`, `test:settlement-exactly-once`

**Interfaces:**
- Uses two or more separately constructed database clients against Docker test PostgreSQL.
- Produces recorded backend PID evidence and deterministic barriers for row-lock assertions.

- [x] Add a PID test that holds concurrent queries long enough for the pool and independent clients to expose at least two distinct PostgreSQL backends.
- [x] Add Wallet concurrent debit 80/80 from 100, distinct credits, and identical idempotency-key tests with exact balance/version/sequence/ledger assertions.
- [x] Add same-seat and same-user/different-seat races, asserting only one Seat/GameSession/buy-in and stable loser errors.
- [x] Add close-vs-buy-in race proving either complete buy-in then deterministic cash-out or clean rejection, never orphan Stack or debit.
- [x] Add duplicate settlement and duplicate action races proving one Hand result, one Receipt, and one state-version transition.
- [x] Add a transaction barrier test proving Client B cannot cross `SELECT ... FOR UPDATE` before Client A commits, without timing sleeps.
- [x] Run the complete concurrency suite repeatedly and fix lock ordering/deadlocks at the root rather than adding retries.

### Task 8: Real child-process restart and client recovery

**Files:**
- Create: `apps/server/src/recovery/recovery-process.integration.test.ts`
- Create: `apps/server/scripts/recovery-test-child.ts`
- Modify: E2E helpers/config and Web recovery states/tests
- Add: `test:recovery`, `test:recovery:process`, `test:runtime-cleanup`, `test:realtime`, `test:protocol`, `test:ack`, `test:snapshots`

**Interfaces:**
- Starts the built Server as a true child process on an isolated port against Docker test PostgreSQL, waits for `/ready`, force-terminates without hooks, starts a new process, reconnects clients, and completes the same hand.

- [x] Build a process harness that captures safe logs, kills the process abruptly on Windows, closes all sockets/processes in `finally`, and verifies no orphan process remains.
- [x] Implement process R1 Preflop and R2 Flop restart, preserving cards/blinds/pot/actions/actor/stacks/version and completing the hand.
- [x] Implement process R3/R4 deadline recovery and prove remaining time is not reset and expired timeout runs exactly once.
- [x] Implement R5/R6/R7 fault windows around action/settlement commit and broadcast, verifying durable receipt and exactly-once settlement semantics.
- [x] Implement R8/R9/R10 deferred leave/sit-out/closing restarts and R11/R12 corrupt/legacy behavior.
- [x] Extend Web tests for restarting/reconnecting/recovery-error/timeout/uncertain result and canonical resync without automatic poker-action replay.
- [x] Replace fragile nine-player assumptions with fake time and explicit state/event barriers, then run nine-player, timeout race, settlement, receipt race, cleanup, and Flop restart independently 10 times each.

### Task 9: Documentation, full acceptance, review, and final commit

**Files:**
- Modify: `README.md`, `.env.example`, all Step 5-affected existing docs, `docs/PROGRESS.md`
- Create: `docs/table-snapshots.md`, `docs/recovery.md`, `docs/postgres-concurrency.md`, `docs/operations.md`
- Verify: entire repository and Docker build

**Interfaces:**
- Documents Windows `.` + Docker Desktop/WSL2 backend workflow, exact PostgreSQL evidence, snapshots, recovery, operations, single-instance boundary, and all residual limitations.

- [x] Document exact commands for Docker up/health/config/migrate/seed/concurrency/recovery/down/volume reset, without secrets or claiming public deployment.
- [x] Document schema/version/revision, commit-before-broadcast, receipts, hand numbers, deadlines, settlement, CLOSING, readiness, cleanup, graceful/abrupt recovery, and recovery-error policy.
- [x] Run frozen install, all focused scripts, full unit/integration/realtime/recovery/process/E2E suites, lint, typecheck, build, 10,000-hand seed, Dockerfile build, Compose configs, migration/seed twice, and `git diff --check`.
- [x] Search forbidden markers and sensitive terms; inspect every match and verify `.env`, database volumes, generated clients, build/test artifacts, private cards, decks, and credentials are untracked/unlogged.
- [x] Perform an independent review of money conservation, snapshot validation, commit ordering, receipts, settlement, deadline races, recovery, cleanup, shutdown, migration safety, and hidden information; fix all Critical/Important findings with regression tests.
- [x] Update `docs/PROGRESS.md` with only observed versions/PIDs/counts/results, prepare the exact Step 5 commit, record its hash in the completion report, and stop before Step 6.

## Self-review

- Spec coverage: Tasks 1–9 cover all 45 sections, R1–R12, Docker/standard PostgreSQL, migration integrity, protocol/Ack cleanup, snapshots, receipts, hand numbering, transition ordering, settlement, closing, startup/deadline recovery, readiness, cleanup, shutdown, fault injection, child-process crashes, Web reliability, stability repetition, documentation, and final commands.
- Placeholder scan: no deferred implementation placeholder remains; every checkbox names a concrete artifact, behavior, and evidence path.
- Type consistency: durable mutations use `operationId`; actions use `clientActionId`; public correlation uses `requestId`; table optimistic ordering uses `stateVersion`; database snapshot concurrency uses `snapshotRevision`; Snapshot schema uses fixed version `1`.
