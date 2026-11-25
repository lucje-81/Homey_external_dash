# Homey Web Dashboard proxy
# The frontend (frontend/) is a fork of Web Dashboard by Stefan Schweiger (GPL-3.0); see frontend/UPSTREAM.md.

FROM node:22-alpine
RUN apk add --no-cache su-exec
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data PUBLIC_DIR=/app/public
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js docker-entrypoint.sh ./
COPY frontend/ ./public/
RUN mkdir -p /data && chown node:node /data
# Starts as root only to fix the ownership of /data, then runs as "node" (see docker-entrypoint.sh).
ENTRYPOINT ["/app/docker-entrypoint.sh"]
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
# --no-deprecation: http-proxy uses util._extend, which only prints a warning
CMD ["node", "--no-deprecation", "server.js"]
