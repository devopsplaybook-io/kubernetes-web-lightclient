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
        DEV_MODE: "true",
        DATA_DIR: "../docs/dev/data",
        OPENTELEMETRY_COLLECTOR_HTTP: "http://localhost:4318/v1/traces",
        OPENTELEMETRY_COLLECTOR_AWS: true,
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
