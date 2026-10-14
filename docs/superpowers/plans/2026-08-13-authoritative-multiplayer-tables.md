# Authoritative Multiplayer Tables Implementation Plan

> **For agentic workers:** This plan was executed task-by-task. Checked items record the completed Step 4 implementation and final verification.

**Goal:** Deliver Step 4 as a server-authoritative, cookie-authenticated Socket.IO poker table with audited Wallet/Table Stack transfers, completed-hand persistence, same-process reconnection, and a playable responsive H5 client.

**Architecture:** PostgreSQL owns seats, game sessions, transfer ledgers, completed hands, and durable operation idempotency; one in-process `TableRuntime` per room owns the current hand, presence, timers, action idempotency cache, and a per-table serialized command queue. Socket handlers validate shared Zod payloads and delegate to the runtime manager, while every recipient receives a separately generated privacy projection. React pages and Zustand stores consume only HTTP/Socket authority and never compute cards, winners, pots, legal actions, or final stacks.

**Tech Stack:** Node.js 24, TypeScript 6 strict, pnpm 11.16, Fastify 5, Socket.IO 4.8, Zod 4, Prisma/PostgreSQL 7.9, React 19, Zustand 5, Tailwind CSS 4, Vitest 4, Playwright 1.62.

## Global Constraints

- Work only in `.` on the existing clean `main` checkout whose HEAD is `cd7133c53e372d0e1258bc4c3990f6555079b085`.
- Implement Step 4 only. Do not add server-restart recovery, in-progress snapshots, persistent action-idempotency, Redis, paid reveal, history UI, admin UI, chat, payments, or Step 5 code.
- PostgreSQL/Prisma remains the only persistence layer; real integration evidence must use isolated `wepoker-test`, never SQLite or mocked Prisma.
- Wallet and Table Stack values are integer `number` values in `0..2_000_000_000`; every transfer is transactional, version checked, ledger backed, and durably idempotent.
- A room has at most one in-process runtime and all table writes run through its serialized queue; different rooms remain independent.
- The server alone derives cards, deck, board, pots, legal actions, timer, winners, stacks, actor, blinds, and settlement through Poker Core.
- Socket identity comes only from the existing `wepoker_session` HttpOnly cookie. Payload `userId`, stack, cards, winner, or pot values are never authoritative.
- Only a recipient's private hole cards and showdown-public cards may enter their projection; deck, remaining deck, future board, other private cards, cookies, tokens, passwords, and full runtimes never enter payloads or logs.
- Start countdown is 5 seconds. Turn timeout is room-configured 15/20/30/45/60 seconds; timeout uses the same serialized action path and checks hand/actor/version/deadline again.
- Production uses cryptographic shuffle and real time; deterministic decks/clocks/schedulers are dependency-injected only in tests and production must reject any test-deck configuration.
- Follow red-green-refactor for each task. Do not stage or commit until every Step 4 completion gate passes; final commit message is exactly `feat: add authoritative multiplayer tables`.
- Docker image/Compose remains `NOT RUN — Docker unavailable`; standard PostgreSQL multi-connection contention remains `NOT YET VERIFIED`.

---

### Task 1: Step 4 relational model and executable migration

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260813_step4_authoritative_tables/migration.sql`
- Modify: `apps/server/src/db/schema-contract.test.ts`
- Modify: `apps/server/src/integration/database-constraints.integration.test.ts`
- Modify: `apps/server/src/integration/database.ts`
- Modify: `apps/server/package.json`, `package.json`

**Interfaces:**
- Produces Prisma enums `TableSeatPlayStatus`, `GameSessionStatus`, and `TableStackLedgerType`.
- Produces models `TableSeat`, `GameSession`, `TableStackLedgerEntry`, `HandRecord`, `HandPlayerRecord`, `HandActionRecord`, and `HandPotRecord` with Restrict history relations and cascade-free auditing.
- Produces `db:seed:test` and cleanup order aware of all Step 4 relations.

- [x] Add failing schema-contract assertions for all seven models, enums, composite unique keys, history relations, and checked fields; run the focused unit test and confirm failure because Step 4 models are absent.
- [x] Extend the Prisma schema with focused relations: current `TableSeat` points one-to-one to an ACTIVE `GameSession`; historical records point to Room/User/GameSession with Restrict; Wallet ledger links optionally to GameSession/Hand without cascade.
- [x] Write versioned SQL creating enums, tables, indexes, foreign keys, and CHECK constraints for seat range, stack/amount bounds, sequence, sign rules, result equations, finished timestamps, and stable card/array fields.
- [x] Add failing real-DB constraints tests for duplicate seat/user/session, ledger equations/signs, hand uniqueness, history survival after seat deletion, and paired Wallet/Table ledger references; apply migration to an empty test database and make them pass.
- [x] Add a test-environment seed command honoring `.env.test`; prove Step 3 + Step 4 migrations apply from empty and seed is idempotent.

### Task 2: Durable seat, buy-in, top-up, cash-out, and room-closing accounting

**Files:**
- Create: `apps/server/src/modules/tables/table.schemas.ts`
- Create: `apps/server/src/modules/tables/table-accounting.service.ts`
- Create: `apps/server/src/modules/tables/table-accounting.integration.test.ts`
- Modify: `apps/server/src/modules/rooms/room.service.ts`
- Modify: `apps/server/src/modules/rooms/room.routes.ts`

**Interfaces:**
- Produces `createTableAccountingService(database)` with `takeSeat`, `buyIn`, `requestLeave`, `cashOut`, `setSitOut`, `returnToPlay`, `closeIdleRoom`, `getSeats`, and `auditSystemPoints`.
- Consumes operation inputs `{roomId, userId, operationId, expectedStateVersion, ...}` and returns authoritative seat/session/wallet/ledger results; payload fingerprints make replays exact and conflicts stable.

- [x] Write failing Zod tests for seat index, integer buy-in, UUID/high-entropy operation IDs, state version, and action shape; use stable error codes from the spec.
- [x] Write failing real-DB tests for atomic initial seat/buy-in, occupied seat, double seat, membership/open-room checks, range/balance checks, exact replay, changed-payload conflict, paired ledgers, and Wallet+Table Stack conservation.
- [x] Implement initial buy-in as one transaction that locks Room/Wallet, creates GameSession/Seat, updates Wallet with CAS, appends Wallet BUY_IN and positive Table Stack BUY_IN entries, and returns an exact idempotent replay.
- [x] Add failing tests for top-up between hands/SIT_OUT, maximum buy-in, rejection during an active hand, and totalBuyIn; implement top-up using the same atomic transfer path.
- [x] Add failing tests for immediate leave, LEAVE_AFTER_HAND, zero-stack close, exactly-once cash-out, old-socket rejection, GameSession closure, Seat deletion, paired CASH_OUT entries, and conservation; implement cash-out as one transaction.
- [x] Add failing tests for immediate/deferred SIT_OUT and RETURN restrictions; implement persisted play status transitions without changing Wallet or stack.
- [x] Change room close semantics with regression tests: empty room closes immediately, idle occupied room enters CLOSING and safely cashes out all seats before CLOSED, active hand remains CLOSING, and any transfer failure prevents CLOSED.

### Task 3: Runtime primitives, per-table queue, clock, scheduler, and deck provider

**Files:**
- Create: `apps/server/src/modules/tables/runtime/types.ts`
- Create: `apps/server/src/modules/tables/runtime/serialized-queue.ts`
- Create: `apps/server/src/modules/tables/runtime/serialized-queue.test.ts`
- Create: `apps/server/src/modules/tables/runtime/clock.ts`
- Create: `apps/server/src/modules/tables/runtime/testing.ts`
- Create: `apps/server/src/modules/tables/runtime/deck-provider.ts`
- Create: `apps/server/src/modules/tables/runtime/table-runtime.ts`
- Create: `apps/server/src/modules/tables/runtime/table-runtime-manager.ts`
- Create: `apps/server/src/modules/tables/runtime/table-runtime-manager.test.ts`
- Modify: `apps/server/src/config/environment.ts` and tests

**Interfaces:**
- Produces `Clock`, `Scheduler`, `DeckProvider`, `SerializedQueue`, `TableRuntime`, and `TableRuntimeManager`.
- `TableRuntime` stores room config, persisted seats, current `HandState`, table `stateVersion`, separate `presenceVersion`, socket presence sets, countdown/deadline handles, processed action results, last button, hand number, and runtime status `IDLE|START_COUNTDOWN|PLAYING|PAUSED|CLOSING|PERSISTENCE_ERROR|CLOSED`.

- [x] Write failing queue tests proving same-table order, different-table concurrency, failure recovery, and timer/action serialization; implement a per-instance promise tail that does not poison subsequent commands.
- [x] Write failing manager tests proving one runtime per room under concurrent calls, distinct rooms remain distinct, and only closed/empty/no-presence runtimes are eligible for explicit cleanup; implement manager creation and cleanup.
- [x] Define fake clock/scheduler/deck utilities that advance deterministically without real waits; test cancellation, boundary execution, and obsolete timer no-op behavior.
- [x] Implement production deck provider from `createStandardDeck`, `shuffleCards`, and Node cryptographic integer source; validate environment so production cannot enable deterministic decks.
- [x] Implement runtime state/presence/version mutation helpers and test that business mutations increase `stateVersion`, presence only increases `presenceVersion`, and versions never decrease.

### Task 4: Shared realtime protocol and privacy-safe projections

**Files:**
- Modify: `packages/shared/src/index.ts` and tests
- Create: `packages/shared/src/realtime.ts`
- Create: `packages/shared/src/realtime.test.ts`
- Create: `apps/server/src/modules/tables/runtime/project-table-state.ts`
- Create: `apps/server/src/modules/tables/runtime/project-table-state.test.ts`

**Interfaces:**
- Produces protocol version `1`, strict Zod schemas and inferred types for `table:subscribe`, `table:request-state`, `seat:take`, `stack:buy-in`, `seat:sit-out`, `seat:return`, `seat:leave`, and `action:submit`.
- Produces `TableStateProjection`, `RealtimeError`, and `projectTableStateForUser(runtime,userId)`.

- [x] Write failing shared-schema tests for strict payloads, required operation/client IDs, integer raise-to semantics, forbidden unknown authority fields, state projection, and safe error envelopes.
- [x] Implement exact event-name constants, client/server Socket.IO event maps, action discriminated unions, and DTOs without importing Server/Poker Core internals into Web.
- [x] Write failing fixed-deck projection tests: each player sees only their cards, spectators see none, non-actors get no legal actions, fold-to-win remains private, showdown reveals only eligible cards, admin gets no bypass, and serialized payloads contain no deck/future cards.
- [x] Implement recipient-specific projection from explicit allow-listed fields only; never spread or serialize runtime/HandState and never include `deck`.
- [x] Add logger regression tests proving cookies, tokens, full runtime, full deck, and private cards are absent from structured logs.

### Task 5: Hand lifecycle, actions, timers, settlement persistence, and conservation

**Files:**
- Create: `apps/server/src/modules/tables/hand-persistence.service.ts`
- Create: `apps/server/src/modules/tables/hand-persistence.integration.test.ts`
- Create: `apps/server/src/modules/tables/runtime/hand-controller.ts`
- Create: `apps/server/src/modules/tables/runtime/hand-controller.test.ts`
- Create: `apps/server/src/modules/tables/runtime/timer-race.test.ts`
- Modify: `apps/server/src/modules/tables/runtime/table-runtime.ts`

**Interfaces:**
- Produces `startCountdown`, `cancelCountdown`, `startHand`, `submitAction`, `handleTimeout`, `finishHand`, and `scheduleNextHand` commands executed only inside the table queue.
- Produces `persistCompletedHand(input)` that atomically writes Hand/Player/Action/Pot history, final TableSeat stacks/versions, HAND_RESULT table ledgers, deferred statuses/leaves, disconnect sit-outs, and closing-room cash-outs.

- [x] Write failing fake-time tests for the 5-second start countdown, cancellation when eligibility drops below two, pause/closing cancellation, next-hand scheduling only after persistence, and correct Button movement.
- [x] Integrate `startHand`, injected shuffled/fixed deck, UUID hand ID, increasing room hand number, invariants, and action deadline; do not duplicate blind/action/pot logic in Server.
- [x] Write failing action tests for actor/hand/version checks, legal fold/check/call/bet/raiseTo/allIn mapping, exact runtime action idempotency replay/conflict, stale-state refresh, and two tabs executing only once.
- [x] Implement action processing through `applyPlayerAction`, `getLegalActions`, and `assertHandStateInvariants`; record automatic flag and request identifiers separately from Poker Core domain events.
- [x] Write failing timer-race tests for user-first check, timeout-first fold, exact-boundary action, old-hand timeout, and old-actor timeout; implement absolute deadlines and revalidation inside the queue.
- [x] Write failing real-DB persistence tests for complete Hand/Player/Action/Pot rows, stable card codes, HAND_RESULT equations, Table Stack conservation, unchanged Wallet totals, unique sequences, and total rollback on injected constraint failure.
- [x] Implement completed-hand transaction and set runtime to `PERSISTENCE_ERROR` without broadcasting success or starting another hand when persistence fails.
- [x] Process deferred sit-out, leave, disconnected players, room CLOSING, and next countdown only after transaction commit.

### Task 6: Cookie-authenticated Socket.IO transport and table commands

**Files:**
- Replace: `apps/server/src/realtime.ts`
- Create: `apps/server/src/realtime/socket-authentication.ts`
- Create: `apps/server/src/realtime/socket-errors.ts`
- Create: `apps/server/src/realtime/table-handlers.ts`
- Create: `apps/server/src/realtime/realtime.integration.test.ts`
- Create: `apps/server/src/realtime/hidden-information.integration.test.ts`
- Create: `apps/server/src/realtime/multiplayer.integration.test.ts`
- Modify: `apps/server/src/index.ts`, `apps/server/src/app.ts`
- Modify: `apps/server/package.json`

**Interfaces:**
- Produces `attachRealtimeTransport(server,{database,environment,runtimes,...})` and typed Socket.IO acknowledgements/events.
- Authenticated socket context contains only verified `userId`, session ID, and safe profile; subscribe joins the room and attaches presence, then all state broadcasts are individually projected.

- [x] Add `socket.io-client` at the matching pinned Socket.IO version and write failing integration tests for missing/expired session rejection, exact Origin rejection, safe auth error, member subscribe, and outsider denial.
- [x] Implement handshake cookie parsing through the existing session service, exact Origin validation, safe context decoration, structured connection/disconnection logs, and cleanup without cash-out/fold.
- [x] Write failing tests for every strict command payload and acknowledgement error code; implement handlers as thin validation/delegation layers with UUID request IDs.
- [x] Implement subscribe/request-state and recipient-by-recipient broadcasts to every active socket for each user; reconnect finds persisted seat/current runtime and does not reset hand/deadline/version.
- [x] Run dedicated hidden-information integration tests with known cards and serialized-payload searches.
- [x] Add three-player A=100/B=300/C=700 real Socket all-in/side-pot test validating refunds, eligibility, winners, stacks, persistence, and conservation.
- [x] Add nine-player Socket test validating nine unique seats, Button/SB/BB/action order, per-user private cards, completion, and conservation without nine Chromium processes.
- [x] Add room pause/resume/closing Socket tests and same-process refresh/multiple-socket tests.

### Task 7: Responsive authenticated H5 application

**Files:**
- Modify: `apps/web/package.json`, `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/styles.css`, `apps/web/vite.config.ts`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/stores/auth-store.ts`, `room-store.ts`, `table-store.ts`
- Create: `apps/web/src/realtime/table-socket.ts`
- Create: `apps/web/src/components/AppShell.tsx`, `ProtectedRoute.tsx`, `PlayingCard.tsx`, `SeatRing.tsx`, `ActionBar.tsx`, `ConnectionBadge.tsx`
- Create: `apps/web/src/pages/LoginPage.tsx`, `RegisterPage.tsx`, `LobbyPage.tsx`, `CreateRoomPage.tsx`, `JoinRoomPage.tsx`, `RoomPage.tsx`, `TablePage.tsx`
- Create/modify focused `*.test.tsx` files.
- Modify: `docs/asset-log.md`

**Interfaces:**
- Produces routes `/login`, `/register`, `/`, `/rooms/create`, `/rooms/join`, `/rooms/:roomId`, `/tables/:roomId` using cookie credentials.
- Zustand stores accept only authoritative HTTP/Socket results; socket instance remains outside serializable state and lower state versions are ignored.

- [x] Add pinned `react-router-dom` and `socket.io-client`; write failing route/auth tests for login/register, `/api/me` restoration, protected redirect/return, logout, and stable server errors.
- [x] Implement typed HTTP client, auth store, route shell, Login/Register pages, and session restoration without reading tokens.
- [x] Write failing lobby/room tests for Wallet balance, member-only room list, complete room create/join forms, 2–9 seats, take-seat/buy-in/top-up/sit-out/return/leave, and owner controls.
- [x] Implement lobby, room stores/pages, server-confirmed mutations only, and clear loading/error/empty/closing states.
- [x] Write failing table tests for recipient cards, board/pots/street/log/network/deadline, server legal-action buttons, raise-to input/slider/half-pot/two-thirds/pot/all-in controls, stale-state replacement, and disconnected write disabling.
- [x] Implement responsive table components for 375x812, 390x844, and desktop using HTML/CSS/original SVG only; add subtle non-blocking deal/board/actor/winner transitions.
- [x] Record all code-drawn cards/chips/table/iconography as project-original in `docs/asset-log.md`; if any asset is missing, use and log an explicit project-owned placeholder.

### Task 8: Browser E2E and complete multiplayer acceptance

**Files:**
- Modify: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/helpers.ts`
- Create: `apps/web/e2e/two-player-fold.spec.ts`
- Create: `apps/web/e2e/two-player-showdown.spec.ts`
- Create: `apps/web/e2e/reconnect.spec.ts`
- Create: `apps/web/e2e/buy-in-cash-out.spec.ts`
- Create: `apps/web/e2e/mobile.spec.ts`
- Create: `apps/server/scripts/start-e2e-environment.ts`

**Interfaces:**
- Produces deterministic test-only environment startup with isolated test DB, fixed deck injection in the server process (never an HTTP/Socket payload), and two independent browser contexts/cookies.

- [x] Build E2E setup that starts migrated/seeded test DB, built Server and Web on fixed local ports, and tears down child processes without deleting user development data.
- [x] Implement two-browser Fold-to-Win flow and assert synchronized stacks, unchanged per-hand Wallet totals, persisted result, and next-hand countdown.
- [x] Implement deterministic two-browser Showdown through every street and assert board, revealed cards, winner, HandRecord, and conservation.
- [x] Implement Flop refresh/reconnect and assert unchanged hole cards/board/pot/stack/actor/deadline, nondecreasing version, and continued completion.
- [x] Implement idle buy-in/cash-out flow and assert Wallet/Table Stack inverse transfer, released seat, closed session, and paired ledgers through visible UI/API evidence.
- [x] Implement 375x812 mobile flow through auth, lobby, create/join, seat selection, and action controls; assert no unusable horizontal overflow.

### Task 9: Documentation, exhaustive verification, review, and final commit

**Files:**
- Modify: `README.md`, `.env.example`, `docs/architecture.md`, `docs/data-model.md`, `docs/http-api.md`, `docs/realtime-protocol.md`, `docs/security.md`, `docs/local-database.md`, `docs/PROGRESS.md`, `docs/asset-log.md`, `docs/development-roadmap.md`
- Create: `docs/table-runtime.md`, `docs/table-accounting.md`

**Interfaces:**
- Produces reproducible two-browser setup, protocol/accounting/runtime/security design, exact evidence, known Step 5 limitations, and the requested final Git commit.

- [x] Document Socket cookie auth, event schemas, projection/privacy, versions, action cache, queue, presence, seat/session lifecycle, transfers, automatic start/timer, disconnect/reconnect, completed-hand persistence, Room CLOSING, H5 controls, assets, and all explicit limitations.
- [x] From empty `wepoker-test`, apply Step 3+4 migrations; run test seed twice; inspect key unique/check/foreign-key constraints and history retention.
- [x] Run frozen install, schema validation, Poker Core, Server unit, DB integration, realtime, hidden-information, timer-race, seat/accounting, three-player side-pot, nine-player, full workspace tests, lint, typecheck, build, all Playwright E2E, fixed 10,000-hand simulation, and built-server smoke.
- [x] Search `TODO|FIXME|HACK|.skip|.only|Math.random|@ts-ignore|eslint-disable|console.log|password|token|holeCards|deck|remainingDeck|DATABASE_URL`; inspect every match for secret/private-card/deck leakage and verify ignored/generated artifacts remain untracked.
- [x] Perform independent code review focused on money conservation, double cash-out, timer races, hidden information, queue/reconnect behavior, and migration safety; fix every Critical/Important issue with red-green regression evidence.
- [x] Run final fresh verification, `git diff --check`, inspect staged scope, commit exactly `feat: add authoritative multiplayer tables`, record the hash, and stop before Step 5 without push or tag.

## Self-review

- Spec coverage: Tasks 1–9 map every Step 4 model, transfer, lifecycle, queue, Socket event, projection, timer race, Poker Core integration, completed-hand transaction, reconnect behavior, responsive page, multiplayer scenario, security scan, documentation item, and final command. Step 5 snapshot/restart recovery and persistent action idempotency are explicitly excluded.
- Placeholder scan: the plan contains no deferred implementation instruction; every checkbox names a concrete behavior, file boundary, and verification target.
- Type consistency: durable operations consistently use `operationId`; player actions use `clientActionId`; runtime business state uses `stateVersion`; presence uses `presenceVersion`; `raiseTo` always means the final total street commitment; all identity comes from authenticated context.
