# No-Limit Hold'em Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, framework-independent No-Limit Texas Hold'em hand engine with exact legal actions, side-pot settlement, invariants, replayable events, and seeded simulation.

**Architecture:** Keep immutable serializable hand state in focused `hand`, `betting`, `pots`, `settlement`, `invariants`, and `simulation` modules. Public transitions accept a state and command and return a new state plus only the events produced by that transition; a fixed deck is injected once at hand creation. Settlement consumes the existing seven-card evaluator and never depends on applications, storage, clocks, or ambient randomness.

**Tech Stack:** TypeScript 6 strict mode, Vitest 4, fast-check 4, tsx, pnpm 11.16 through Corepack.

## Global Constraints

- Work only in `.`; preserve existing Step 0 and Step 1 behavior.
- Poker Core must not depend on React, Fastify, Socket.IO, Prisma, PostgreSQL, DOM, network, filesystem, timers, current time, or hidden mutable state.
- All chips, bets, versions, seats, and stack amounts are safe integers; no `any`, `@ts-ignore`, skipped tests, or `Math.random()`.
- Public raise amounts use `raiseTo`, meaning the player's final street commitment.
- Follow red-green-refactor for every rule batch and commit only after every final gate passes.
- This plan contains Step 2 only; no user, wallet, room, database, API, socket, UI, PWA, admin, or deployment implementation.

---

### Task 1: Domain model, validation, seating, and hand start

**Files:**
- Create: `packages/poker-core/src/engine/types.ts`
- Create: `packages/poker-core/src/engine/errors.ts`
- Create: `packages/poker-core/src/engine/seats.ts`
- Create: `packages/poker-core/src/engine/start-hand.ts`
- Test: `packages/poker-core/src/engine/start-hand.test.ts`

**Interfaces:**
- Consumes: `Card`, a caller-supplied 52-card deck, `TableConfig`, and 2-9 `SeatState` values.
- Produces: `startHand(input): ActionResult`, `getNextButtonSeat(seats, previousButtonSeat)`, `HandState`, `DomainEvent`, and stable `PokerRuleError` codes.

- [x] Write table-validation, heads-up, multiway, empty/sitting-out/zero-stack rotation, short-blind, fixed-deal, and immutability tests.
- [x] Run `corepack pnpm --filter @paiyouju/poker-core test -- src/engine/start-hand.test.ts` and confirm missing engine APIs fail.
- [x] Implement safe-integer validation, circular eligible-seat helpers, fixed deck dealing, blind debits, initial actor selection, serializable start events, and version 1 state.
- [x] Re-run the focused test until it passes, then run all Poker Core tests.

### Task 2: Legal actions and immutable betting transitions

**Files:**
- Create: `packages/poker-core/src/engine/legal-actions.ts`
- Create: `packages/poker-core/src/engine/apply-action.ts`
- Create: `packages/poker-core/src/engine/round.ts`
- Test: `packages/poker-core/src/engine/betting.test.ts`

**Interfaces:**
- Consumes: `HandState` and `PlayerAction` (`fold`, `check`, `call`, `bet`, `raiseTo`, `allIn`).
- Produces: `getLegalActions(state, playerId): LegalAction`, `applyPlayerAction(state, action): ActionResult`.

- [x] Write failures for turn enforcement, check/call, minimum bet, total-to raise, stack limits, fold-to-win, check-around, multi-raise, and actor skipping.
- [x] Run the focused betting tests and confirm they fail for missing behavior.
- [x] Implement exact legal-action projections, typed rule errors, chip debits, per-player action metadata, deterministic next-actor selection, and domain events.
- [x] Re-run focused and full Poker Core tests.

### Task 3: Short all-in raise rights and street progression

**Files:**
- Modify: `packages/poker-core/src/engine/legal-actions.ts`
- Modify: `packages/poker-core/src/engine/apply-action.ts`
- Modify: `packages/poker-core/src/engine/round.ts`
- Test: `packages/poker-core/src/engine/short-all-in.test.ts`
- Test: `packages/poker-core/src/engine/streets.test.ts`

**Interfaces:**
- Consumes: each player's `lastActedBetLevel` and `lastActedFullRaiseSize` plus the current bet level.
- Produces: independent raise rights, cumulative short-all-in reopening, automatic flop/turn/river/runout/showdown progression.

- [x] Write failures for one/two/three short all-ins, cumulative below/at threshold, unacted-player raises, closed-right calls, and below-minimum non-all-in rejection.
- [x] Confirm the focused tests fail.
- [x] Implement per-player reopening math; only a full raise updates `lastFullRaiseSize`; reset street commitments and action metadata on street advance.
- [x] Write and fail tests for every street, all-in runout, exact board counts, and no extra board on fold-to-win.
- [x] Implement deterministic board dealing and re-run all focused and Poker Core tests.

### Task 4: Matched pots, uncalled returns, showdown, and odd chips

**Files:**
- Create: `packages/poker-core/src/engine/pots.ts`
- Create: `packages/poker-core/src/engine/settlement.ts`
- Test: `packages/poker-core/src/engine/pots.test.ts`
- Test: `packages/poker-core/src/engine/settlement.test.ts`

**Interfaces:**
- Consumes: completed commitments, fold flags, board, hole cards, and button seat.
- Produces: `buildPots(players)`, `settleHand(state)`, `Pot`, `PotAward`, `SettlementResult`, explicit uncalled returns.

- [x] Write failures for 2/3/4/9 player levels, folded contributors, and removal of unmatched single-contributor top slices.
- [x] Implement contribution-level slicing with separate contributors and eligible players; return unmatched excess explicitly.
- [x] Write failures for distinct main/side winners, board ties, folded/ineligible exclusions, two/three-way odd chips, and per-pot distribution.
- [x] Implement independent seven-card comparison for each pot, clockwise odd-chip order left of button, stack updates, visibility, awards, and conservation checks.
- [x] Re-run focused and full Poker Core tests.

### Task 5: Invariants, determinism, serialization, and properties

**Files:**
- Create: `packages/poker-core/src/engine/invariants.ts`
- Test: `packages/poker-core/src/engine/invariants.test.ts`
- Test: `packages/poker-core/src/engine/engine-properties.test.ts`
- Modify: `packages/poker-core/src/index.ts`

**Interfaces:**
- Consumes: any `HandState` and optional preceding state.
- Produces: `assertHandStateInvariants(state, previousState?)`, all documented engine exports.

- [x] Write failures for negative/overflow commitments, duplicate cards, invalid board/street, invalid actor, current-bet mismatch, version regression, incomplete finish, and chip loss.
- [x] Implement contextual `STATE_INVARIANT_VIOLATION` errors and run focused tests.
- [x] Add fast-check properties for pot conservation, transition immutability, deterministic state/events, monotonic versions, and JSON round trips.
- [x] Run property tests and all Poker Core tests.

### Task 6: Seeded bot and 100,000-hand simulator

**Files:**
- Create: `packages/poker-core/src/simulation/seeded-random.ts`
- Create: `packages/poker-core/src/simulation/bot.ts`
- Create: `packages/poker-core/src/simulation/simulate.ts`
- Create: `packages/poker-core/scripts/simulate.ts`
- Test: `packages/poker-core/src/simulation/simulation.test.ts`
- Modify: `packages/poker-core/package.json`

**Interfaces:**
- Consumes: `--hands=<positive integer>`, `--seed=<integer>`, and legal actions only.
- Produces: deterministic bot commands, random 2-9 seat hands, termination/invariant validation, and summary `{hands, seed, completed, failed, invariantFailures, elapsedTime}`.

- [x] Write failures proving seed reproducibility, legal-action-only bot selection, short-all-in/side-pot reachability, and summary/error diagnostics.
- [x] Implement a deterministic integer PRNG, legal-action bot, randomized valid configurations/stacks/seats, bounded action loop, and reproducible diagnostics.
- [x] Add `simulate` script and run 100, 1,000, then 10,000 hands; turn every discovered failure into a red regression test before fixing.
- [x] Run exactly 100,000 hands with a recorded seed while retaining core uniqueness, actor, pot, termination, and chip checks.

### Task 7: Documentation, audit, final verification, and commit

**Files:**
- Modify: `docs/poker-rules.md`
- Modify: `docs/architecture.md`
- Modify: `docs/PROGRESS.md`
- Modify: `packages/poker-core/README.md`
- Create: `docs/short-all-in-rules.md`
- Create: `docs/side-pot-algorithm.md`

**Interfaces:**
- Produces: an exact public-API/rules/simulation reference and recorded verification evidence.

- [x] Document state machine, blinds, heads-up, total-to amounts, full/short raise rules, round closure, runout, pot slices, uncalled returns, odd chips, events, invariants, and simulator command without unresolved rule placeholders.
- [x] Search core source/tests for `TODO|FIXME|HACK|\.skip|\.only|Math\.random|@ts-ignore|eslint-disable|\bany\b|console\.log` and review every match.
- [x] Run Poker Core tests, focused property/short-all-in/side-pot tests, full five-card distribution, lint, typecheck, full tests, build, 100,000 hands, and `git diff --check`.
- [ ] Review the staged diff, update `docs/PROGRESS.md` with exact counts/results/seed/limitations, then commit exactly `feat: implement no limit holdem engine` and record `git rev-parse HEAD`.

## Self-review

- Spec coverage: all attachment sections map to Tasks 1-7; prohibited Step 3 work is excluded.
- Placeholder scan: no implementation placeholder remains; the checklist markers are execution tracking, not missing design.
- Type consistency: creation, legal-action query, transition, pot, settlement, invariant, and simulation APIs use the same `HandState` and domain type family throughout.
