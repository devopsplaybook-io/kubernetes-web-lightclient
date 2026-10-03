module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2020",
        },
      },
    ],
  },
  coverageProvider: "v8",
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 75,
      lines: 80,
    },
    // Security-relevant modules: everything that builds input for kubectl
    // or interprets kubectl output must stay well covered.
    "./src/kubectl/**": {
      statements: 90,
      branches: 85,
      functions: 85,
      lines: 90,
    },
    "./src/cache/KubeResourceRoutes.ts": {
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90,
    },
  },
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
  moduleNameMapper: {
    // uuid v14+ is ESM-only, provide a CJS mock for Jest
    "^uuid$": "<rootDir>/src/test-utils/uuid-mock.ts",
  },
};
