# PWA Audit

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: `corepack pnpm test:e2e:pwa`; `corepack pnpm build`; production manifest/service-worker inspection
- Seed: N/A
- Result: PASS — PWA 1/1; manifest, icons/maskable/apple-touch, standalone/theme/safe-area, service worker, update prompt, offline/reconnect banner and audio update contract pass; build precaches 30 entries (726.37–726.41 KiB)
- Known Limitation: background execution and install UX remain browser/platform controlled

Cache Storage excludes `/api/*`, `/socket.io/*`, Wallet, hole cards, hand details, replay private data, paid reveal, hypothetical runout, Admin, Session and phone data. An active hand is never automatically reloaded for an update.
