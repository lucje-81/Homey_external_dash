#!/bin/sh
# Docker creates a bind-mounted ./data as root; give it to the unprivileged user, then drop root.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R node:node "${DATA_DIR:-/data}"
  exec su-exec node "$@"
fi
exec "$@"
