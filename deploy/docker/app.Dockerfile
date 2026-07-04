# better-agent web/admin — a pure client SPA (TanStack Start, prerendered shell,
# not_found_handling = single-page-application). Built to static assets in
# .output/public and served by Caddy with a SPA fallback — NO SSR node server.
# Build with: --build-arg APP=web|admin --build-arg VITE_SERVER_URL=https://api.<domain>
FROM node:22-alpine AS build
ARG APP=web
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -F ${APP} build
# The prerendered shell is the SPA entry; unmatched routes fall back to it so
# client-side routing works (same as the Workers single-page-application mode).
RUN cp apps/${APP}/.output/public/_shell.html apps/${APP}/.output/public/index.html

FROM caddy:2.8-alpine
ARG APP=web
COPY --from=build /repo/apps/${APP}/.output/public /srv
# Static file server with SPA fallback on :3000 (the outer Caddy reverse-proxies
# to this container).
RUN printf ':3000 {\n\troot * /srv\n\ttry_files {path} /index.html\n\tfile_server\n}\n' > /etc/caddy/Caddyfile
EXPOSE 3000
