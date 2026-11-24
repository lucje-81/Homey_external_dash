# Homey Web Dashboard proxy
# The frontend is Web Dashboard by Stefan Schweiger (GPL-3.0), fetched at a fixed commit and patched for proxy mode.

FROM node:22-alpine AS frontend
RUN apk add --no-cache git
ARG WEB_DASHBOARD_REPO=https://github.com/stefan-schweiger/dev.schweiger.dashboard.git
ARG WEB_DASHBOARD_COMMIT=64ea56bcf75d67b9296a5d5c8ff7de03581b9d99
WORKDIR /src
RUN git init -q . \
 && git remote add origin "$WEB_DASHBOARD_REPO" \
 && git fetch -q --depth 1 origin "$WEB_DASHBOARD_COMMIT" \
 && git checkout -q FETCH_HEAD
COPY patches/ /patches/
RUN for patch in /patches/*.patch; do git apply --verbose "$patch"; done

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data PUBLIC_DIR=/app/public
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY --from=frontend /src/assets/web ./public
COPY --from=frontend /src/LICENSE ./public/LICENSE-web-dashboard.txt
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
# --no-deprecation: http-proxy uses util._extend, which only prints a warning
CMD ["node", "--no-deprecation", "server.js"]
