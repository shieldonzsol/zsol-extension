import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "wxt";

import { manifest } from "./src/manifest";

export default defineConfig({
  manifestVersion: 3,
  manifest,
  // Explicit imports only: every name a file uses is imported where it is used.
  imports: false,
  // `pnpm dev` builds and watches; load .output/chrome-mv3-dev yourself in the browser you use.
  webExt: { disabled: true },
  vite: () => ({
    plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  }),
});
