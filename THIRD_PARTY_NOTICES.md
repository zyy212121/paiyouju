# Third-Party Notices

本项目自身为 `UNLICENSED` 私有软件。分发生产镜像前，部署者必须保留各依赖的上游许可证与通知；本文件是主要运行时组件摘要，不取代 `pnpm licenses list --prod` 的发布证据。

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| Node.js 24 | JavaScript runtime | MIT（含第三方通知） |
| PostgreSQL 17 | 数据库 | PostgreSQL License |
| Caddy 2 | HTTPS/反向代理 | Apache-2.0 |
| React / React DOM | Web UI | MIT |
| React Router | 路由 | MIT |
| Vite / TypeScript | 构建与类型系统 | MIT / Apache-2.0 |
| Fastify 与官方 plugins | HTTP server | MIT |
| Socket.IO | realtime transport | MIT |
| Prisma Client/CLI | ORM/Migration | Apache-2.0 |
| Zod | schema validation | MIT |
| pg | PostgreSQL driver | MIT |
| argon2 | password hashing binding | MIT |
| Lucide React | UI icons | ISC |
| Tailwind CSS | CSS tooling | MIT |
| Workbox / vite-plugin-pwa | service worker/PWA | MIT |

Web Audio 提示音、牌面、筹码、头像占位和管理界面均为项目代码生成，不含下载采样、专有图片或第三方扑克品牌素材。完整资产记录见 `docs/asset-log.md`。

## 0.1.0-rc.1 许可证清单

2026-08-26 使用 `pnpm licenses list --prod --json` 对冻结锁文件执行了最终清点。按许可证分组的包记录数为：Apache-2.0 20、BlueOak-1.0.0 5、BSD-2-Clause 1、BSD-3-Clause 4、EPL-2.0 1、ISC 26、MIT 187、MIT and ISC 1、Unlicense 2。EPL-2.0 项为 Prisma Studio/CLI 依赖 `elkjs`；Studio/CLI 不属于生产启动入口，最终镜像边界检查同时验证其不可导入、不可执行。分发者仍应随制品保存依赖原始许可证文本；本节只记录审计摘要。

## Prisma 配置链路 advisory

`pnpm audit` 在冻结锁文件上报告 1 个 High、0 个 Critical：`deepmerge-ts@7.1.5` 的 GHSA-ggr8-5vv4-36mx / npm advisory 1145093（递归对象图合并可导致栈耗尽）。路径仅为 `prisma -> @prisma/config -> deepmerge-ts`；应用 HTTP、Socket、牌局、Wallet 与恢复运行时不会把不可信对象交给 Prisma 配置解析器。`audit:dependencies` 仅对 advisory 1145093 建立精确 allowlist，并在出现其他 Moderate/High/Critical 时非零退出。当前 Prisma 7.9.1 依赖链尚未提供兼容的已修复版本，因此没有脱离上游兼容范围强制覆盖传递依赖。

## `pg@9` 兼容警告审计

仓库直接依赖固定为 `pg@8.23.0`，数据库适配层为 `@prisma/adapter-pg@7.9.1`。Step 7 全量 PostgreSQL 回归曾触发 `client.query()` busy-client 弃用警告；`--trace-deprecation` 将调用链定位为 `pg Client.query -> @prisma/adapter-pg PgTransaction.performIO -> Prisma Client interpreter`，实际触发点是发发看事务中一个同时展开多条 relation 的 Prisma `include`，不是项目直接调用 `pg.Client.query()`。

已先增加捕获该 warning 的 PostgreSQL 回归，再把同一 Hand 行锁事务内的 Hand、参与者、个人购买和唯一模拟结果读取改为显式顺序查询。修复后该回归和整份 History Integration 在 `--trace-deprecation` 下均不再产生警告，事务、唯一结果和逐用户独立扣费语义保持不变。没有为追逐未来主版本而盲升 `pg@9`；后续只在 Prisma 适配器明确兼容时按正常依赖升级流程处理。
