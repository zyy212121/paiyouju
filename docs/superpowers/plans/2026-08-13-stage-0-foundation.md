# Stage 0 Foundation Implementation Plan

> **Status:** Completed on 2026-08-13. Steps use checkbox syntax for the retained implementation record.
>
> **Historical scope note:** This file records the Stage 0 boundary as it existed on that date. The project owner's later authorizations for run-it-twice, squid, and short-deck modes are governed by the current `AGENTS.md` and `docs/product-spec.md` and supersede the corresponding historical prohibition below.

**Goal:** Establish the complete, verifiable Stage 0 foundation for the private H5/PWA No-Limit Texas Hold'em platform without implementing gameplay or business features.

**Architecture:** Use a strict TypeScript pnpm monorepo with one React/Vite PWA, one Fastify server, and framework-independent shared and poker-core packages. PostgreSQL/Prisma provide the future persistence boundary, while Caddy and Fastify form the documented same-origin production path.

**Tech Stack:** Node.js 24 LTS, pnpm 11, TypeScript, React, Vite, Tailwind CSS, Zustand, Fastify, Socket.IO, Zod, PostgreSQL, Prisma, Vitest, Playwright, Docker Compose, and Caddy.

## Global Constraints

- The only project directory is `.` on native Windows and `.` from WSL.
- Product-facing copy uses `牌友局`; third-party poker trademarks and copyrighted assets are prohibited.
- The product is private, virtual-points entertainment for fewer than 500 total users and normally fewer than 100 concurrent users.
- Only 2–9 player private No-Limit Texas Hold'em cash-style tables are in scope.
- Real money, payments, cash conversion, rake, ante, straddle, run-it-twice, insurance, voice chat, tournaments, Omaha, Short Deck, and OFC are prohibited.
- All points and chips are safe-range integers; Wallet and Table Stack are distinct accounting domains.
- The server is authoritative; poker-core remains independent of React, Fastify, Socket.IO, Prisma, and PostgreSQL.
- Production shuffling must use a cryptographically secure random source and never `Math.random()`.
- New rules and bug fixes use test-driven development; stage gates are lint, typecheck, tests, relevant integration tests, and build.
- Stage 0 must not implement poker rules, authentication, wallet flows, rooms, seats, or WebSocket business events.

---

### Task 1: Repository policy and executable workspace

**Files:**
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.env.example`
- Create: `.npmrc`
- Create: `.node-version`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`

**Interfaces:**
- Consumes: Node.js `v24.16.0` and pnpm `11.16.0` detected on the host.
- Produces: root commands `dev`, `lint`, `typecheck`, `test`, `build`, and Prisma helpers shared by every workspace.

- [x] **Step 1: Record immutable repository rules in `AGENTS.md` and developer entry points in `README.md`.**
- [x] **Step 2: Define the four pnpm workspaces and strict shared TypeScript settings.**
- [x] **Step 3: Configure ESLint flat config for TypeScript, browser, and Node source files.**
- [x] **Step 4: Add environment examples without real credentials.**
- [x] **Step 5: Run `pnpm install` and require generation of `pnpm-lock.yaml`.**

### Task 2: Test-first shared contracts and poker-core boundary

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/tsconfig.build.json`
- Create: `packages/shared/src/index.test.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/poker-core/package.json`
- Create: `packages/poker-core/tsconfig.json`
- Create: `packages/poker-core/tsconfig.build.json`
- Create: `packages/poker-core/src/index.test.ts`
- Create: `packages/poker-core/src/index.ts`

**Interfaces:**
- Consumes: strict TypeScript base configuration and Vitest.
- Produces: `PRODUCT_NAME: "牌友局"`, `HealthResponseSchema`, `HealthResponse`, and a Stage 0 poker-core module boundary with no gameplay behavior.

- [x] **Step 1: Write shared tests asserting the product name and health-response validation.**
- [x] **Step 2: Run `pnpm --filter @paiyouju/shared test` and confirm failure because the implementation is absent.**
- [x] **Step 3: Implement the shared constant and Zod health schema.**
- [x] **Step 4: Run the shared tests and confirm they pass.**
- [x] **Step 5: Add a deliberately behavior-free poker-core scaffold test and module export.**

### Task 3: Test-first Fastify health service and minimal Prisma boundary

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/tsconfig.build.json`
- Create: `apps/server/src/app.test.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/realtime.ts`
- Create: `apps/server/prisma/schema.prisma`

**Interfaces:**
- Consumes: `HealthResponseSchema` and `PRODUCT_NAME` from `@paiyouju/shared`.
- Produces: `buildApp(options?): FastifyInstance`, `GET /health`, environment parsing, optional production static delivery, and a transport-only Socket.IO attachment with no domain events.

- [x] **Step 1: Write an injection test requiring HTTP 200 and `{ status: "ok", service: "牌友局 server" }`.**
- [x] **Step 2: Run `pnpm --filter @paiyouju/server test` and confirm failure because `buildApp` is absent.**
- [x] **Step 3: Implement the smallest Fastify app and configuration needed for the test.**
- [x] **Step 4: Add production static-file registration and a Socket.IO transport boundary without business handlers.**
- [x] **Step 5: Add a provider-only Prisma schema and run `pnpm db:generate`.**
- [x] **Step 6: Re-run the server integration test and confirm it passes.**

### Task 4: Test-first React PWA landing page

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/App.test.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/e2e/home.spec.ts`
- Create: `apps/web/public/icon.svg`

**Interfaces:**
- Consumes: `PRODUCT_NAME` from `@paiyouju/shared`.
- Produces: a responsive installable PWA shell whose only page displays `牌友局开发环境`, plus Vitest and Playwright checks.

- [x] **Step 1: Write the component test for the required heading.**
- [x] **Step 2: Run `pnpm --filter @paiyouju/web test` and confirm failure because `App` is absent.**
- [x] **Step 3: Implement the minimal React landing page and Tailwind stylesheet.**
- [x] **Step 4: Configure Vite PWA metadata and an original SVG development icon.**
- [x] **Step 5: Add a Playwright smoke test for the heading.**
- [x] **Step 6: Re-run the web unit test and confirm it passes.**

### Task 5: Development and deployment scaffolding

**Files:**
- Create: `compose.yaml`
- Create: `compose.prod.yaml`
- Create: `Dockerfile`
- Create: `Caddyfile`
- Create: `.dockerignore`
- Create: `docs/windows-development.md`

**Interfaces:**
- Consumes: built Web assets, built server, `DATABASE_URL`, and PostgreSQL environment settings.
- Produces: local PostgreSQL startup and the documented production path `browser -> Caddy -> Fastify/Socket.IO`.

- [x] **Step 1: Add PostgreSQL 17 Compose service with a health check and persistent named volume.**
- [x] **Step 2: Add a production container build and Caddy reverse proxy for HTTPS/WSS termination.**
- [x] **Step 3: Document PowerShell and WSL commands, Prisma workflow, tests, and Docker-unavailable fallback.**
- [x] **Step 4: Validate configuration text statically when Docker is unavailable and record that limitation.**

### Task 6: Durable product and architecture documentation

**Files:**
- Create: `docs/product-spec.md`
- Create: `docs/architecture.md`
- Create: `docs/poker-rules.md`
- Create: `docs/data-model.md`
- Create: `docs/realtime-protocol.md`
- Create: `docs/security.md`
- Create: `docs/development-roadmap.md`
- Create: `docs/PROGRESS.md`

**Interfaces:**
- Consumes: every immutable requirement in the Stage 0 specification.
- Produces: the decision record future stages must implement and test without reopening settled product rules.

- [x] **Step 1: Record product boundaries, room/seat lifecycle, history, privacy, and complete first-version scope.**
- [x] **Step 2: Record server-authoritative architecture, package boundaries, serialization, idempotency, and deployment topology.**
- [x] **Step 3: Record Hold'em, heads-up, short-all-in reopening, side-pot, odd-chip, timeout, disconnect, and reveal rules.**
- [x] **Step 4: Record conceptual aggregates and accounting invariants while keeping the Stage 0 Prisma schema table-free.**
- [x] **Step 5: Record realtime envelopes, version conflict behavior, reconnect snapshots, and connection labels.**
- [x] **Step 6: Record security controls and a staged roadmap whose next stage is Card / Deck / Hand Evaluator.**

### Task 7: Stage gate and handoff

**Files:**
- Modify: `docs/PROGRESS.md`
- Modify: this plan checklist

**Interfaces:**
- Consumes: the complete Stage 0 repository.
- Produces: reproducible command evidence and, only when Git identity exists, commit `chore: initialize wepoker platform`.

- [x] **Step 1: Run `pnpm install` and confirm the lockfile is current.**
- [x] **Step 2: Run `pnpm lint` and resolve every error without weakening rules.**
- [x] **Step 3: Run `pnpm typecheck` and resolve every strict-mode error.**
- [x] **Step 4: Run `pnpm test` and confirm unit and integration tests pass.**
- [x] **Step 5: Run `pnpm build` and confirm all packages and applications build.**
- [x] **Step 6: Update `docs/PROGRESS.md` with versions, results, blockers, and the exact next stage.**
- [x] **Step 7: Inspect Git status and commit only if an existing Git identity is available.**
