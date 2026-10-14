# Stage 1 Poker Core Implementation Plan

> **Status:** Completed and verified on 2026-08-13. Each task retained a visible red-to-green test cycle.

**Goal:** Implement deterministic, framework-independent cards, deck shuffling, five-card evaluation, seven-card best-hand selection, comparison, winner selection, property checks, and exhaustive five-card distribution verification.

**Architecture:** Keep domain code in focused files under `packages/poker-core/src`; cards use canonical ASCII codes, evaluation uses explicit category/tiebreak tuples, and seven-card evaluation enumerates all 21 five-card combinations. Randomness enters through `RandomIntSource`; only `apps/server` adapts Node `crypto.randomInt` for production.

**Tech Stack:** TypeScript 6 strict mode, Vitest 4, fast-check 4, Node.js 24 crypto adapter, pnpm workspace.

## Global Constraints

- Work only in `.`; do not create a second project copy.
- Do not implement betting, pots, rooms, accounts, databases, WebSocket table events, or table UI.
- `poker-core` must not depend on React, Fastify, Socket.IO, Prisma, PostgreSQL, Node crypto, or ambient mutable random state.
- Production dealing/shuffling must never use `Math.random()`.
- Five-card inputs contain exactly 5 unique cards; seven-card inputs exactly 7 unique cards; violations throw a domain error.
- Comparison returns negative for weaker left, zero for a tie, and positive for stronger left.
- Every behavior group follows red test -> minimal implementation -> green test -> refactor -> related suite.

---

### Task 1: Canonical cards and standard deck

**Files:**
- Create: `packages/poker-core/src/errors.ts`
- Create: `packages/poker-core/src/card.ts`
- Create: `packages/poker-core/src/deck.ts`
- Test: `packages/poker-core/src/card.test.ts`

**Interfaces:**
- Produces: `Suit`, `Rank`, `Card`, `SUITS`, `RANKS`, `parseCard(code)`, `serializeCard(card)`, `cardsEqual(left, right)`, `createStandardDeck()`.
- Canonical code grammar is `[2-9TJQKA][cdhs]`; parsing is intentionally case-sensitive.

- [x] **Step 1:** Write tests for every canonical rank/suit, round trips, invalid strings, equality, 52-card counts, and uniqueness.
- [x] **Step 2:** Run `pnpm --filter @paiyouju/poker-core test -- card.test.ts` and confirm imports/behavior fail.
- [x] **Step 3:** Implement readonly card values, strict lookup-based parsing/serialization, domain errors, and suit-major/rank-minor deck creation.
- [x] **Step 4:** Re-run the directed test and confirm green.

### Task 2: Injectable unbiased shuffle and production adapter

**Files:**
- Create: `packages/poker-core/src/random.ts`
- Create: `packages/poker-core/src/shuffle.ts`
- Test: `packages/poker-core/src/shuffle.test.ts`
- Create: `apps/server/src/crypto-random.ts`
- Test: `apps/server/src/crypto-random.test.ts`

**Interfaces:**
- Produces: `RandomIntSource { nextInt(exclusiveMax: number): number }`, `shuffleCards(cards, source)` and `cryptoRandomIntSource`.
- `shuffleCards` clones its input and performs integer-only Fisher-Yates; the source contract is validated on every draw.

- [x] **Step 1:** Write deterministic shuffle tests for exact output, reproducibility, immutability, permutation preservation, and invalid random-source values.
- [x] **Step 2:** Run the directed shuffle test and confirm red.
- [x] **Step 3:** Implement copy-returning Fisher-Yates with bounds validation and no floating-point/modulo conversion.
- [x] **Step 4:** Write and run a failing server adapter contract test, then implement it with `node:crypto` `randomInt`.
- [x] **Step 5:** Run both related suites and search production code for `Math.random`.

### Task 3: Strict five-card evaluator and comparator

**Files:**
- Create: `packages/poker-core/src/hand-types.ts`
- Create: `packages/poker-core/src/validation.ts`
- Create: `packages/poker-core/src/evaluate-five.ts`
- Create: `packages/poker-core/src/compare.ts`
- Test: `packages/poker-core/src/evaluate-five.test.ts`
- Test: `packages/poker-core/src/compare.test.ts`

**Interfaces:**
- Produces: ordered `HandCategory`, `HandEvaluation { category, tiebreak, bestFive, displayName }`, `evaluateFiveCards(cards)`, `compareHandStrength(left, right)`.
- `tiebreak` follows category-specific descending numeric ranks; wheel straight uses `[5]`.
- `bestFive` sorts by hand role first (made ranks/tiebreak order), then canonical suit order only as a deterministic tie selector; suits never alter hand strength.

- [x] **Step 1:** Write category, royal-display, wheel, invalid-input, stable-order, and every required kicker comparison test.
- [x] **Step 2:** Run the directed evaluator/comparator tests and confirm red.
- [x] **Step 3:** Implement duplicate/length validation, rank grouping, straight detection, category classification, stable best-five ordering, and lexicographic comparison.
- [x] **Step 4:** Re-run directed tests and confirm green; refactor shared rank comparison without changing assertions.

### Task 4: Seven-card best hand and winner selection

**Files:**
- Create: `packages/poker-core/src/combinations.ts`
- Create: `packages/poker-core/src/evaluate-seven.ts`
- Create: `packages/poker-core/src/winners.ts`
- Test: `packages/poker-core/src/evaluate-seven.test.ts`
- Test: `packages/poker-core/src/winners.test.ts`

**Interfaces:**
- Produces: `evaluateSevenCards(cards)` and `determineWinners(entries)` preserving input winner order.
- Seven-card selection evaluates all 21 combinations; exact ties choose the lexicographically greatest serialized, sorted `bestFive` signature for deterministic output only.

- [x] **Step 1:** Write failing tests for board-only, one/two hole-card-equivalent inputs, competing straights/flushes/full houses/two-pairs, input-order stability, invalid input, and tied winners.
- [x] **Step 2:** Run the directed suites and confirm red.
- [x] **Step 3:** Implement 5-of-N combination generation, best-result selection, deterministic exact-tie selection, and winner filtering.
- [x] **Step 4:** Re-run directed suites and confirm green.

### Task 5: Properties and exhaustive distribution command

**Files:**
- Modify: `packages/poker-core/package.json`
- Create: `packages/poker-core/src/properties.test.ts`
- Create: `packages/poker-core/src/verify-five-card-distribution.ts`
- Modify: `packages/poker-core/src/index.ts`

**Interfaces:**
- Produces: package script `verify:five-card-distribution`, public exports, and fast-check seed/replay output on failure.
- Exhaustive verification enumerates all `2,598,960` index combinations and asserts the nine exact category counts.

- [x] **Step 1:** Add exact `fast-check` dependency and scripts; write order-invariance, antisymmetry, identity, transitivity, and shuffle-permutation properties.
- [x] **Step 2:** Run property tests and confirm any missing exports fail, then expose only intended public APIs.
- [x] **Step 3:** Implement the standalone exhaustive verifier with nonzero failure exit and exact expected distribution.
- [x] **Step 4:** Run all poker-core tests and the full exhaustive verifier to completion.

### Task 6: Documentation, full gate, and Stage 1 commit

**Files:**
- Create: `packages/poker-core/README.md`
- Modify: `docs/poker-rules.md`
- Modify: `docs/architecture.md`
- Modify: `docs/PROGRESS.md`
- Modify: this plan checklist

**Interfaces:**
- Documents encoding, numeric rank values, wheel, categories, tiebreaks, stable best-five ordering, comparison semantics, random adapters, and actual exhaustive counts.

- [x] **Step 1:** Document public contracts and verified design decisions without claiming unrun checks.
- [x] **Step 2:** Run directed unit tests, all poker-core tests, properties, exhaustive verification, root lint/typecheck/test/build, `git diff --check`, and `git status`.
- [x] **Step 3:** Update `docs/PROGRESS.md` with exact test/count evidence, limitations, and Stage 2 boundary.
- [x] **Step 4:** Re-run affected gates after documentation/status edits.
- [x] **Step 5:** Stage only reviewed Stage 1 changes and commit `feat: add cards deck and hand evaluator`.
