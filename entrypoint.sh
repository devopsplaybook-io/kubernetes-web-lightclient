#!/bin/sh

if [ "${APPLICATION_TITLE}" == "" ]; then
  APPLICATION_TITLE="Kubernetes Web"
fi

sed -i "s/APPLICATION_TITLE/$APPLICATION_TITLE/g" /opt/app/kubernetes-web-lightclient/web/manifest.webmanifest
sed -i "s/APPLICATION_TITLE/$APPLICATION_TITLE/g" /opt/app/kubernetes-web-lightclient/web/config.json

node dist/App.js