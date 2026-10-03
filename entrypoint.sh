#!/bin/sh

if [ -z "${APPLICATION_TITLE}" ]; then
  APPLICATION_TITLE="Kubernetes Web"
fi

node -e '
const fs = require("fs");
const title = process.argv[1];
const patches = [
  { file: "/opt/app/kubernetes-web-lightclient/web/manifest.webmanifest", keys: ["name", "short_name"] },
  { file: "/opt/app/kubernetes-web-lightclient/web/config.json", keys: ["appTitle"] },
];
for (const patch of patches) {
  try {
    const data = JSON.parse(fs.readFileSync(patch.file, "utf8"));
    for (const key of patch.keys) {
      if (key in data) {
        data[key] = title;
      }
    }
    fs.writeFileSync(patch.file, JSON.stringify(data, null, 2) + "\n");
    console.log(`Patched ${patch.file} (title: ${title})`);
  } catch (error) {
    console.error(`Warning: failed to patch ${patch.file}: ${error.message}`);
  }
}
' "$APPLICATION_TITLE"

exec node dist/App.js
