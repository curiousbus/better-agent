# better-agent API server (Hono on Node) — also carries dist/migrate.mjs and
# the drizzle migrations folder for the k8s migrate Job.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -F server build
# Pruned production node_modules for the server app (workspace deps included).
RUN pnpm --filter=server deploy --prod /out \
  && cp -r apps/server/dist /out/dist \
  && cp -r packages/db/src/migrations /out/migrations

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/app/migrations
COPY --from=build /out .
EXPOSE 3000
CMD ["node", "dist/index.mjs"]
