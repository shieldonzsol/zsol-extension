import { defineConfig } from "@playwright/test";

// End-to-end tests load the production build (`pnpm build` first) into Chromium, headless.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
});
