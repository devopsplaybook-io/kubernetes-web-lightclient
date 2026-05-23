module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.spec.json",
        diagnostics: false,
      },
    ],
  },
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
  moduleNameMapper: {
    // uuid v14+ is ESM-only, provide a CJS mock for Jest
    "^uuid$": "<rootDir>/src/test-utils/uuid-mock.ts",
  },
};
