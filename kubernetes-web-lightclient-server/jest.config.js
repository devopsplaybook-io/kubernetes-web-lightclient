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
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
  moduleNameMapper: {
    // uuid v14+ is ESM-only, provide a CJS mock for Jest
    "^uuid$": "<rootDir>/src/test-utils/uuid-mock.ts",
  },
};
