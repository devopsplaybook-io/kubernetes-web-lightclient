const fs = require("fs");
let devEnv = {};
if (fs.existsSync("./env-dev.js")) {
  devEnv = require("./env-dev");
}

module.exports = {
  apps: [
    {
      name: "kubernetes-web-lightclient-proxy",
      cwd: "kubernetes-web-lightclient-proxy",
      script: "npm",
      args: "run start",
      autorestart: false,
      ignore_watch: ["node_modules"],
    },
    {
      name: "kubernetes-web-lightclient-server",
      cwd: "kubernetes-web-lightclient-server",
      script: "npm",
      args: "run dev",
      autorestart: false,
      env_development: {
        ...devEnv,
        DEV_MODE: "true",
        DATA_DIR: "../docs/dev/data",
      },
    },
    {
      name: "kubernetes-web-lightclient-web",
      cwd: "kubernetes-web-lightclient-web",
      script: "npm",
      args: "run dev",
      autorestart: false,
      env_development: {
        DEV_MODE: "true",
      },
    },
  ],
};
