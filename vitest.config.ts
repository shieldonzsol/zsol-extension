import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  // WXT's plugin gives tests the extension's aliases and an in-memory `browser` API.
  plugins: [WxtVitest()],
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Half the cores at most, so tests never take over the machine.
    maxWorkers: "50%",
  },
});
