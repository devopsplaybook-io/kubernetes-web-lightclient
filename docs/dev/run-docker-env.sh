#!/bin/bash

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

pm2 delete all || true

cd ${REPO_DIR}

./docs/dev/docker-build-images.sh

docker rm -f kubernetes-web-lightclient || true

SERVICE_VERSION=$(cat ${REPO_DIR}/package.json | jq -r '.version')

docker run -p 80:8080 -d --name kubernetes-web-lightclient didierhoarau/kubernetes-web-lightclient:${SERVICE_VERSION}

docker logs -f kubernetes-web-lightclient
