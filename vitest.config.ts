import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/queries.ts"],
      thresholds: {
        statements: 35,
        branches: 40,
        functions: 30,
        lines: 35
      }
    }
  }
});
