#!/bin/bash

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

pm2 delete all || true

# Server
cd "${REPO_DIR}/kubernetes-web-lightclient-server"
if [ ! -d node_modules ]; then
    npm ci
fi

# Web
cd "${REPO_DIR}/kubernetes-web-lightclient-web"
if [ ! -d node_modules ]; then
    npm ci
fi

# Start
cd "${REPO_DIR}"
pm2 start ecosystem.config.js --env development
