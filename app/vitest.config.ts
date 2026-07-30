import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only the React hook test needs DOM globals; keep the rest of the suite on
    // the cheaper node environment.
    environmentMatchGlobs: [["tests/useBundleV2.test.ts", "jsdom"]],
    include: ["tests/**/*.test.ts"],
  },
});
