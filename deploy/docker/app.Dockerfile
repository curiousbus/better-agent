# better-agent web/admin (TanStack Start + nitro, node-server preset).
# Build with: --build-arg APP=web|admin --build-arg VITE_SERVER_URL=https://api.<domain>
FROM node:22-alpine AS build
ARG APP=web
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN NITRO_PRESET=node-server pnpm -F ${APP} build

FROM node:22-alpine
ARG APP=web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /repo/apps/${APP}/.output .
EXPOSE 3000
CMD ["node", "server/index.mjs"]
