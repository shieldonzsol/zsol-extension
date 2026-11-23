import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "wxt";

import { manifestFor } from "./src/manifest";

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ mode }) => manifestFor(mode),
  srcDir: "src",
  publicDir: "public",
  imports: false,
  // Load .output/chrome-mv3-dev in your own browser.
  webExt: { disabled: true },
  vite: () => ({
    plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  }),
});
