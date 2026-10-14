# Step 6 History, Replay, Paid Reveal, and Mobile PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete Step 6 experience: private history, deterministic replay, idempotent paid card reveals, profile and wallet views, a mobile-first table, and a safe installable PWA without weakening the Step 0–5 guarantees.

**Architecture:** Extend the existing append-only PostgreSQL history with frozen hand-time reveal settings and a purchase record. Build server-side authorization projections so hidden cards never cross the API boundary. Reconstruct replay events deterministically from committed hand/player/action/pot records with strict completeness checks. Keep HTTP resources route-local in the web app, retain authoritative Socket.IO table state, and coordinate PWA updates so an active hand is never reloaded.

**Tech Stack:** TypeScript, pnpm workspace, Fastify, Prisma/PostgreSQL, Zod, React, Zustand, Socket.IO, Vitest, Playwright, Vite PWA/Workbox, Lucide React, Docker Compose.

## Global Constraints

- Work only in `.` on the existing `main` checkout; do not create another project copy or worktree.
- Preserve all Step 0–5 invariants: integer chip accounting, PostgreSQL row locking, durable idempotency, server-authoritative actions, private hole cards, safe errors, and canonical reconnect state.
- Never send a hidden card to the browser, DOM, accessibility text, logs, Wallet metadata, cache storage, URL state, or realtime broadcast.
- Every money-changing path must be atomic and durable. A timeout reuses the same operation identifier and never performs an automatic paid retry.
- History is owner-scoped and cursor-paginated. A game or hand identifier is never sufficient authorization by itself.
- Replay is based only on committed records. Incomplete legacy records return `REPLAY_NOT_AVAILABLE`; they are never guessed.
- API and Socket.IO traffic are network-only/no-store. Service workers may cache only public static application assets.
- Use project-original React/CSS/SVG visuals and Lucide icons. Missing optional art may use an explicit placeholder recorded in `docs/asset-log.md`.
- Do not begin Step 7 or Step 8. After all Step 6 gates pass, stop for a stage report.

---

## Task 1: Preserve the Acceptance Baseline and Fix the Default E2E Entry Point

**Files:**
- Modify: `package.json`
- Modify: `scripts/run-e2e-docker.mjs`
- Test: `tests/contracts/root-scripts.test.ts`

- [x] Add a contract test proving the default root `test:e2e` command selects the maintained Docker-backed test environment.
- [x] Keep an explicitly named local-environment command for developers who intentionally provide a local PostgreSQL URL.
- [x] Make Docker cleanup deterministic on success, failure, and interruption.
- [x] Run the contract test and the existing five Step 5 Playwright scenarios.

## Task 2: Add the Step 6 Database Model and Append-Only Migration

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260820090000_step6_history_paid_reveal/migration.sql`
- Modify: `apps/server/prisma/constraint-inventory.json`
- Modify: `apps/server/src/db/constraints.integration.test.ts`
- Modify: `apps/server/src/db/migrations.integration.test.ts`

- [x] Add frozen `paidCardRevealEnabled` and `paidCardRevealCost` fields to each completed hand with safe legacy defaults.
- [x] Add `PaidCardReveal` with buyer, target hand participant, room, hand, operation identifier, price, Wallet ledger reference, timestamps, uniqueness, composite foreign keys, and integer/check constraints.
- [x] Add stable cursor indexes for user game history, user hand history, Wallet entries, and paid reveal lookup.
- [x] Add database negative tests for cross-user, cross-room, cross-hand, duplicate-operation, mismatched-ledger, and invalid-cost writes.
- [x] Apply all migrations to an empty Docker PostgreSQL database and validate Prisma/schema constraint inventory parity.

## Task 3: Define Shared Step 6 Contracts and Privacy Types

**Files:**
- Create: `packages/shared/src/history.ts`
- Create: `packages/shared/src/profile.ts`
- Modify: `packages/shared/src/http.ts`
- Modify: `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/history.test.ts`

- [x] Define opaque stable cursors and bounded list query schemas.
- [x] Define game summaries/details, hand summaries/details, replay steps, profile, Wallet history, and paid-reveal request/response schemas.
- [x] Model card visibility as a discriminated union: `HIDDEN` always has `holeCards: null`; only `OWN`, `PUBLIC_SHOWDOWN`, and `PURCHASED` may contain cards.
- [x] Add stable public error codes, including not found/forbidden, insufficient funds, reveal unavailable, idempotency conflict, and replay unavailable.
- [x] Add parse tests proving hidden branches cannot carry card values and all money/count fields remain bounded integers.

## Task 4: Persist Frozen Reveal Configuration with Completed Hands

**Files:**
- Modify: `apps/server/src/modules/tables/runtime/table-runtime.ts`
- Modify: `apps/server/src/modules/tables/runtime/hand-controller.ts`
- Modify: `apps/server/src/modules/tables/hand-persistence.service.ts`
- Modify: `apps/server/src/modules/tables/table-transition.service.ts`
- Test: related runtime and persistence unit/integration tests

- [x] Capture reveal enabled/cost at the hand-start authority boundary and carry it through the runtime completion input.
- [x] Write the frozen values in the same completed-hand transaction as players, actions, pots, stack ledgers, receipts, and snapshots.
- [x] Prove later Room changes cannot alter a completed hand’s reveal rules.
- [x] Prove a rolled-back settlement cannot leave a history row or revealable hand.

## Task 5: Implement Owner-Scoped History and Profile/Wallet Queries

**Files:**
- Create: `apps/server/src/modules/history/history.service.ts`
- Create: `apps/server/src/modules/history/history.routes.ts`
- Create: `apps/server/src/modules/history/history.projection.ts`
- Create: `apps/server/src/modules/profile/profile.service.ts`
- Create: `apps/server/src/modules/profile/profile.routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/modules/history/history.integration.test.ts`
- Test: `apps/server/src/modules/profile/profile.integration.test.ts`

- [x] List only the authenticated user’s game sessions with stable `(startedAt,id)` cursor ordering.
- [x] Return game details and hand lists only when the authenticated user participated.
- [x] Return hand details with server-side card projection; unrelated hidden cards must be absent before serialization.
- [x] Compute current-session results separately from finalized cash-out results and label them accurately.
- [x] Add profile read/update with normalized nickname rules and conflict handling.
- [x] Add Wallet summary and cursor ledger history with safe, non-secret metadata projection.
- [x] Cover cross-user IDOR attempts, malformed/foreign cursors, pagination stability, logout/session revocation, and no-store headers.

## Task 6: Build Deterministic Replay from Committed History

**Files:**
- Create: `apps/server/src/modules/history/replay-builder.ts`
- Create: `apps/server/src/modules/history/replay-builder.test.ts`
- Modify: `apps/server/src/modules/history/history.service.ts`
- Modify: `apps/server/src/modules/history/history.routes.ts`

- [x] Validate record completeness, sequence continuity, player/seat uniqueness, legal board length, pot totals, final stacks, and winner/odd-chip references.
- [x] Reconstruct blind posts, ordered player actions, street/board transitions, folds, all-in runout, uncalled returns, side pots, odd chips, showdown visibility, awards, and final state without randomness.
- [x] Build replay from the same authorized card projection used by hand detail; hidden cards remain null in every step.
- [x] Return `REPLAY_NOT_AVAILABLE` for legacy or inconsistent data rather than synthesizing an uncertain timeline.
- [x] Add deterministic fixtures for fold, showdown, side pots, odd chips, short all-in, uncalled return, and all-in runout; final replay state must equal committed history.

## Task 7: Implement Atomic and Durable Paid Card Reveal

**Files:**
- Create: `apps/server/src/modules/history/paid-card-reveal.service.ts`
- Modify: `apps/server/src/modules/history/history.routes.ts`
- Modify: `apps/server/src/modules/wallet/wallet.service.ts`
- Test: `apps/server/src/modules/history/paid-card-reveal.integration.test.ts`
- Test: `apps/server/src/modules/history/paid-card-reveal.concurrency.integration.test.ts`

- [x] Validate that the buyer participated, the hand is completed, reveal was frozen enabled with positive cost, the target is another participant, cards exist, and cards are not already public.
- [x] Lock the buyer Wallet and durable operation key, recheck authorization inside the transaction, debit exactly once, create the Wallet ledger entry and reveal record atomically, and return the same authorized response on replay.
- [x] Reject reused operation identifiers with different payloads and ensure concurrent same-key requests return one exact result and one debit.
- [x] Never include card codes in Wallet metadata, request logs, structured errors, audit fields, or broadcasts.
- [x] Cover insufficient balance, self/public/disabled/legacy target, unauthorized hand, rollback, timeout replay, and multiple buyers independently.

## Task 8: Add Web Data Modules and Routes

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/games.ts`
- Create: `apps/web/src/api/hands.ts`
- Create: `apps/web/src/api/profile.ts`
- Create: `apps/web/src/api/wallet.ts`
- Create: `apps/web/src/pages/GamesPage.tsx`
- Create: `apps/web/src/pages/GameSessionPage.tsx`
- Create: `apps/web/src/pages/HandsPage.tsx`
- Create: `apps/web/src/pages/HandDetailPage.tsx`
- Create: `apps/web/src/pages/ReplayPage.tsx`
- Create: `apps/web/src/pages/ProfilePage.tsx`
- Create: `apps/web/src/pages/WalletPage.tsx`

- [x] Install Lucide React and use it for common interface icons.
- [x] Make every API request `cache: "no-store"`, add PATCH support and abort/timeout handling, and map public error codes to stable Chinese messages.
- [x] Add authenticated routes for games, game details, hands, hand details, replay, profile, and Wallet.
- [x] Keep history/replay/reveal resources route-local; clear them on route exit, logout, and identity change.
- [x] Add accessible loading, empty, error, filter, and cursor “load more” states without leaking identifiers or card data into storage/URLs.

## Task 9: Implement History, Replay, Paid Reveal, Profile, and Wallet UI

**Files:**
- Create/modify files under `apps/web/src/features/history/`, `replay/`, `paid-reveal/`, `profile/`, and `wallet/`
- Test: corresponding Vitest component and reducer tests

- [x] Render game and hand summaries with accurate active/final result wording, timestamps, blinds, participation, pot/win indicators, and stable pagination.
- [x] Render card visibility exclusively from the discriminated server projection; a hidden-card component accepts no card code prop and exposes only “隐藏底牌” to accessibility APIs.
- [x] Implement pure replay reducer plus previous/next/reset/play/pause/speed controls, timer cleanup, reduced-motion behavior, and no optimistic server mutation.
- [x] Implement paid-reveal confirmation showing target, current balance, exact cost, and irreversible debit; preserve one operation identifier across an uncertain timeout and refresh only buyer-local history/Wallet state after success.
- [x] Implement profile nickname editing with server-confirmed state and Wallet summary/ledger with localized signed amounts and cursor pagination.

## Task 10: Rebuild the Table and Navigation for 2–9 Player Mobile Layouts

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx`
- Refactor/create files under `apps/web/src/features/table/` and `apps/web/src/components/cards/`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/table.css`
- Create: `apps/web/src/styles/accessibility.css`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/pages/TablePage.tsx`

- [x] Split cards, card back, suit symbols, player seats, board, pots, chip indicators, action panel, bet control, timer, hand info, log, and last-hand summary into focused original components.
- [x] Use discrete 2–9 seat templates, rotate the authenticated player to the visual bottom without changing authoritative seat indexes, and prevent overlap/clipping at long nicknames and 2,000,000,000 stacks.
- [x] Preserve server legal-action authority, Raise To semantics, integer/clamped inputs, pending-command disabling, offline disabling, canonical resync, and private recipient projection.
- [x] Add at least 44px touch targets, safe-area insets, focus-visible states, non-color status labels, accessible dialogs, and responsive navigation.
- [x] Keep existing Step 5 table tests passing and add component/layout tests for 2, 6, and 9 seats.

## Task 11: Make PWA Installation, Offline State, and Updates Safe

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/index.html` or repository `apps/web/index.html`
- Create: `apps/web/src/pwa/PwaCoordinator.tsx`
- Create: `apps/web/src/pwa/PwaBanner.tsx`
- Create: `apps/web/src/stores/network-store.ts`
- Create: `apps/web/public/icon-maskable-512.png`
- Modify: `docs/asset-log.md`
- Test: PWA unit/config contract tests

- [x] Change service worker registration from automatic activation/reload to explicit prompt.
- [x] Never reload while a table hand or command is active; apply an update only after the user confirms in a safe state.
- [x] Show install/offline/reconnected/update banners and force canonical resource refresh after reconnect.
- [x] Explicitly deny `/api`, `/socket.io`, health, history, Wallet, replay, and reveal traffic from navigation fallback and runtime caches; cache only same-origin public static assets.
- [x] Create an opaque full-bleed original maskable icon and document its provenance; verify the fresh production bundle contains `manifest.webmanifest` and `sw.js`.

## Task 12: Complete Step 6 Browser, Privacy, Concurrency, and Regression Gates

**Files:**
- Modify: `apps/web/playwright.config.ts`
- Create: Step 6 specs under `apps/web/e2e/`
- Modify/create server load/concurrency test helpers only where required by Step 6

- [x] E1: two-user completed-hand history and server/DOM hidden-card assertions.
- [x] E2: deterministic fold/showdown/side-pot/odd-chip/uncalled/all-in replay controls and final-state equality.
- [x] E3: paid reveal confirmation, one debit, buyer-only cards, no broadcast/other-user DOM/cache leakage.
- [x] E4: disabled/public/self/insufficient/timeout/retry/concurrent reveal cases.
- [x] E5: game session lifecycle and active-versus-final result wording.
- [x] E6: profile update and Wallet ledger pagination/localization.
- [x] E7: Chromium mobile viewports `375x812`, `390x844`, and `430x932`, including 2/6/9-seat bounds and touch targets.
- [x] E8: production PWA registration/update/offline and complete Cache Storage URL inspection proving no private/API/socket resources.
- [x] Preserve all existing Step 0–5 unit, integration, recovery, process-recovery, simulation, build, lint, typecheck, and Playwright gates.

## Task 13: Update Documentation, Review, and Create the Step 6 Commit

**Files:**
- Modify: `README.md`
- Modify: `docs/product-spec.md`
- Modify: `docs/architecture.md`
- Modify: `docs/data-model.md`
- Modify: `docs/http-api.md`
- Modify: `docs/security.md`
- Modify: `docs/operations.md`
- Modify: `docs/asset-log.md`
- Modify: `docs/PROGRESS.md`
- Modify: this plan file

- [x] Document exact authorization, visibility, replay completeness, paid-reveal atomicity/idempotency, Wallet privacy, PWA cache/update, offline, and mobile constraints.
- [x] Record every acceptance command and exact PASS/FAIL evidence, including any environment startup note and fresh production PWA artifacts.
- [x] Run a focused privacy/security review and a general code review; independently reproduce and fix every confirmed issue.
- [x] Run the final clean gate from tracked source, inspect `git diff --check`, status, migration history, ignored artifacts, and generated Prisma client consistency.
- [x] Mark every completed checkbox, commit exactly `feat: add history replay paid reveals and mobile pwa`, and stop for a Step 6 stage report without starting Step 7 or Step 8.
