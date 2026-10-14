# Browser Matrix

- Date: 2026-08-26
- Git Commit: `f2765ddb57ab6be7c1a41880e28d8132c0074607`
- Docker Version: 29.7.2 / Compose 5.3.1
- PostgreSQL Version: 17.10
- Node Version: v24.16.0
- pnpm Version: 11.16.0
- OS: Windows 11 10.0.26200, native PowerShell; Linux containers
- Command: `corepack pnpm test:e2e`; `corepack pnpm test:e2e:browsers`; clean `test:e2e:production-like`; restored `test:e2e:restored-data`
- Seed: deterministic database fixtures; browser-created accounts use isolated test data
- Result: PASS — Chromium 23/23, Firefox 23/23, WebKit 23/23, clean Production-like 6/6, restored-data 1/1; retries 0; failures 0
- Known Limitation: real iPhone Safari and Android Chrome still require physical-device acceptance before public launch

Viewport audit: 844×390 mobile landscape, 768×1024 tablet portrait, 1366×768 desktop and 1920×1080 desktop; login controls remained visible with no horizontal overflow. Core mobile table coverage also runs in the standard browser suite.
