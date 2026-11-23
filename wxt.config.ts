import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { defineConfig } from "wxt";

import { manifestFor } from "./src/manifest";

const CAPTCHA_STUB = fileURLToPath(new URL("./src/stubs/empty-captcha.ts", import.meta.url));

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
    // Privy's CAPTCHA widgets load scripts from the network; CAPTCHA is off for this app.
    resolve: {
      alias: {
        "@marsidev/react-turnstile": CAPTCHA_STUB,
        "@hcaptcha/react-hcaptcha": CAPTCHA_STUB,
      },
    },
  }),
});
