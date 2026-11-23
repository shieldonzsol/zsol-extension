import path from "node:path";

import { build } from "vite";

export const ZSOL_PAGE_DIR = path.resolve(".output/e2e");

export default async function globalSetup() {
  await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    build: {
      outDir: ZSOL_PAGE_DIR,
      emptyOutDir: true,
      minify: false,
      lib: { entry: "tests/e2e/zsol-page.ts", formats: ["es"], fileName: () => "zsol-page.js" },
    },
  });
}
