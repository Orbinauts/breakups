import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "breakups",
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "scripts/**/*.test.ts"],
    passWithNoTests: true,
  },
});
