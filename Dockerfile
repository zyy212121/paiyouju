ARG APP_VERSION=0.1.0-rc.1

FROM node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a AS build
ARG APP_VERSION
LABEL org.opencontainers.image.version=$APP_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/poker-core/package.json packages/poker-core/package.json
RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages
RUN pnpm build
RUN pnpm deploy --filter @paiyouju/server --prod --legacy /release/server \
  && rm -rf /release/server/dist/integration

FROM build AS migration
ENV NODE_ENV=production
WORKDIR /workspace/apps/server
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a AS runtime
ARG APP_VERSION
LABEL org.opencontainers.image.version=$APP_VERSION
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app/apps/server
COPY --from=build /release/server ./
COPY --from=build /workspace/apps/web/dist /app/apps/web/dist

EXPOSE 3000
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
