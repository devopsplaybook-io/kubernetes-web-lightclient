#!/bin/bash

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

pm2 delete all || true


# Environment Variables
if [ -f "${REPO_DIR}/docs/dev/env.sh" ]; then
    . ${REPO_DIR}/docs/dev/env.sh
fi


# Server
cd "${REPO_DIR}/kubernetes-web-lightclient-server"
if [ ! -f package-lock.json ]; then
    rm -fr node_modules
    npm install
fi
if [ ! -d node_modules ]; then
    npm ci
fi

# Web
cd "${REPO_DIR}/kubernetes-web-lightclient-web"
if [ ! -f package-lock.json ]; then
    rm -fr node_modules
    npm install
fi
if [ ! -d node_modules ]; then
    npm ci
fi

# Start
cd "${REPO_DIR}"
pm2 start ecosystem.config.js --env development
pm2 logs
# pm2 logs kubernetes-web-lightclient-server
